// exp2_dialogue.js
//
// Defines exactly one global, window.Exp2Dialogue, with no side effects at
// load time. js_includes/*.js load in an arbitrary order relative to each
// other (os.listdir order), and before data_includes/main.js, so this file
// must not touch the DOM or reference anything outside itself until one of
// its exported functions is actually called.
//
// Exp2Dialogue.mount(container, options) builds a two-character dialogue
// stage inside `container`, revealing each turn's words in sync with a
// single <audio> element's real playback position (never a setTimeout
// schedule, which drifts under load). The stage sets a state class on its
// own root element (exp2-listening / exp2-answering / exp2-done) and is
// otherwise unaware of anything else on the page — the rating slider and
// continue button are gated purely in CSS off that state class.
//
// Exp2Dialogue.watchSlider(input) and Exp2Dialogue.fillDuration(split) are
// small standalone helpers used by the rest of the experiment; see
// global_exp2.css for the CSS half of both.

(function (global) {
  'use strict';

  var STATE = { IDLE: 'idle', LISTENING: 'listening', ANSWERING: 'answering', DONE: 'done' };
  var STATE_CLASSES = ['exp2-listening', 'exp2-answering', 'exp2-done'];

  // A word is revealed this many ms of *audio content time* before its
  // estimated onset. Trailing the audio reads as lag; leading it reads as
  // natural anticipation, the way real captions/subtitles feel synced even
  // though they can't literally predict speech.
  var LEAD_MS = 90;

  // A turn's text is only on screen while that turn is being spoken: the
  // question clears the moment the answer begins, and the answer clears just
  // after the recording ends. Otherwise a participant can sit re-reading the
  // pair and judge it as written material, which is the thing this experiment
  // exists to avoid — the whole point of syncing text to audio is that they
  // judge what they *heard*.
  //
  // The answer gets a short grace period so the last word does not vanish on
  // the same frame as the final syllable; the question does not, because
  // aStart is by definition the first answer word's onset.
  var CLEAR_BUFFER_MS = 400;

  // One initial listen plus one replay. Enforced here rather than by disabling
  // the button alone, so a stray double-click cannot buy a third.
  var MAX_PLAYS = 2;

  // A beat between pressing the button and the first syllable. Playback used
  // to begin in the same instant as the click, which reads as being ambushed:
  // the participant is still moving their eyes back to the devils when the
  // exchange has already started. Half a second is enough to settle and short
  // enough that nobody reads it as a fault -- and the pause is not empty, the
  // listening devil's dots come on for the length of it. Divided by the speed
  // factor at use, like CLEAR_BUFFER_MS, so a sped-up headless run does not
  // spend real seconds here.
  var PREROLL_MS = 500;

  // How long playback may make no progress before the stage stops believing in
  // it. Wall-clock, and generous: the stimuli are preloaded before the trial,
  // so five seconds of a recording not advancing is not a slow connection, it
  // is a recording that has stopped.
  var STALL_MS = 5000;

  // The unpacked audio archive: filename -> blob: URL, or null until one is
  // loaded. `zipPromise` makes loadAudioZip idempotent -- the preload screen
  // and a defensive call from a trial must not fetch 21 MB twice.
  var zipEntries = null;
  var zipPromise = null;

  /**
   * Read a zip in the browser, without a library.
   *
   * Only what this archive actually contains: no zip64 (the archives are ~20 MB
   * with a few hundred entries, far under every 32-bit limit), no encryption,
   * no multi-disk. Stored and deflated entries both, because which one a zip
   * gets is a property of how it was built rather than a decision anybody made
   * on purpose -- ours are deflated today and would still work stored.
   *
   * Deflate is undone by DecompressionStream('deflate-raw'), which is native.
   * If a browser lacks it the error says so plainly rather than leaving a
   * participant on a screen that never advances.
   */
  function unpackZip(buffer, onUnpack) {
    var dv = new DataView(buffer);
    var u8 = new Uint8Array(buffer);
    var n = u8.length;

    // End of central directory: scan back from the end. The trailing comment
    // may be up to 65535 bytes, which bounds how far back it can be.
    var eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('the audio archive is not a zip file');

    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var decoder = new TextDecoder();
    var jobs = [];
    var map = {};

    for (var e = 0; e < count; e++) {
      if (dv.getUint32(off, true) !== 0x02014b50) {
        throw new Error('the audio archive is damaged (bad directory entry ' + e + ')');
      }
      var method = dv.getUint16(off + 10, true);
      var compSize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true);
      var extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true);
      var localOff = dv.getUint32(off + 42, true);
      var name = decoder.decode(u8.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;

      // Directory entries, and the metadata folder macOS adds to a zip built
      // in the Finder. Neither is a recording.
      if (name.charAt(name.length - 1) === '/') continue;
      if (name.indexOf('__MACOSX/') === 0) continue;
      // Only the basename is kept, so an archive that was built with a folder
      // inside it still resolves -- PCIbex's own PreloadZip does the same.
      var base = name.replace(/^.*\//, '');
      if (base.charAt(0) === '.') continue;

      // The local header repeats the name and extra fields, and its extra
      // length can differ from the central directory's. Read it; do not assume.
      var lhNameLen = dv.getUint16(localOff + 26, true);
      var lhExtraLen = dv.getUint16(localOff + 28, true);
      var start = localOff + 30 + lhNameLen + lhExtraLen;
      jobs.push({ name: base, method: method, bytes: u8.subarray(start, start + compSize) });
    }

    // In batches rather than one at a time: each entry costs a
    // DecompressionStream round trip, and 296 of them in series took a full
    // minute in a browser (0.3s for the same work in node, where the inflate
    // is synchronous). Sixteen at a time is most of the speedup without
    // holding all 296 decompressed buffers at once.
    var BATCH = 16;
    var step = function (i) {
      if (i >= jobs.length) return Promise.resolve();
      var slice = jobs.slice(i, i + BATCH);
      return Promise.all(slice.map(function (job) {
        return inflate(job).then(function (bytes) {
          map[job.name] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        });
      })).then(function () {
        if (onUnpack) onUnpack(Math.min(i + BATCH, jobs.length), jobs.length);
        return step(i + BATCH);
      });
    };
    return step(0).then(function () {
      if (!Object.keys(map).length) throw new Error('the audio archive is empty');
      zipEntries = map;
      return map;
    });
  }

  function inflate(job) {
    if (job.method === 0) return Promise.resolve(job.bytes);
    if (job.method !== 8) {
      return Promise.reject(new Error(job.name + ': unsupported compression in the archive'));
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error(
        'this browser cannot read the audio archive — please use an up-to-date ' +
        'Chrome, Firefox, Edge or Safari'));
    }
    var stream = new Blob([job.bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  var STALL_TICK_MS = 500;

  // Minimum/maximum for window.EXP2_SPEED. Default (no override, or 1) must
  // always be real-time — this is strictly a headless-testing affordance.
  var MIN_SPEED = 1;
  var MAX_SPEED = 20;

  // THE clock. Every millisecond this experiment logs is a difference of two
  // readings of this function, and that is the point: it used to be two clocks
  // -- Date.now() for the trial's start, performance.now() inside watchSlider --
  // whose readings looked interchangeable (both milliseconds) but have
  // different origins, so subtracting one from the other silently produced
  // nonsense. Anything that needs a timestamp calls Exp2Dialogue.now().
  //
  // performance.now() rather than Date.now(): monotonic, so a clock adjustment
  // mid-session cannot produce a negative response time.
  function nowMs() {
    return global.performance ? global.performance.now() : Date.now();
  }

  // One scroll intent at a time.
  //
  // keepInView() and resetScroll() both keep working for a short while after
  // they are called -- the first because the element it is chasing may not
  // have printed yet, the second because the trial's content prints after its
  // first command runs. Left independent they fight: a keepInView poll from
  // the trial just finished would scroll the *next* trial down a moment after
  // it opened at the top. Every call takes a new number here and stops as soon
  // as it is no longer the current one, so the most recent intent always wins.
  var scrollGen = 0;
  function newScrollIntent() { return ++scrollGen; }

  function clampSpeed(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 1;
    if (n < MIN_SPEED) return MIN_SPEED;
    if (n > MAX_SPEED) return MAX_SPEED;
    return n;
  }

  function currentSpeed() {
    var raw = global.EXP2_SPEED;
    return raw === undefined || raw === null ? 1 : clampSpeed(raw);
  }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function splitWords(text) {
    return String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  }

  // Weight a word by its (punctuation-stripped) length so longer words get
  // proportionally more of the turn's time span than short ones — uniform
  // per-word timing visibly lags on long words and rushes short ones.
  function wordWeight(word) {
    var bare = word.replace(/^[^0-9A-Za-zÀ-ÖØ-öø-ÿ']+|[^0-9A-Za-zÀ-ÖØ-öø-ÿ']+$/g, '');
    var len = bare.length || word.length || 1;
    return Math.max(1, len);
  }

  // Distributes `text`'s words across [start, end] (ms, in audio content
  // time), weighted by word length, each nudged `LEAD_MS` earlier and
  // clamped back into the turn's own span so a turn never bleeds into the
  // next one's territory (this is what keeps an answer word from ever
  // appearing before aStart).
  function layoutWords(text, start, end) {
    var words = splitWords(text);
    var n = words.length;
    if (!n) return [];
    var weights = words.map(wordWeight);
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var span = Math.max(0, end - start);
    var t = start;
    return words.map(function (w, i) {
      var dur = total > 0 ? (span * weights[i]) / total : span / n;
      var onset = t;
      t += dur;
      var revealAt = onset - LEAD_MS;
      if (revealAt < start) revealAt = start;
      if (revealAt > end) revealAt = end;
      return { text: w, onset: onset, revealAt: revealAt };
    });
  }

  function el(tag, className) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function setChildText(bubbleEl, timings) {
    bubbleEl.textContent = '';
    return timings.map(function (t, i) {
      var span = el('span', 'exp2-word');
      span.textContent = t.text;
      bubbleEl.appendChild(span);
      if (i < timings.length - 1) bubbleEl.appendChild(document.createTextNode(' '));
      return span;
    });
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function Stage(container, options) {
    var opts = options || {};
    var question = opts.question || '';
    var answer = opts.answer || '';
    var qStart = Number(opts.qStart) || 0;
    var qEnd = Number(opts.qEnd) || 0;
    var aStart = Number(opts.aStart) || 0;
    var aEnd = Number(opts.aEnd) || 0;
    var totalMs = Number(opts.totalMs) || Math.max(qEnd, aEnd);
    var audioUrl = opts.audioUrl;
    var allowReplay = opts.allowReplay === undefined ? true : !!opts.allowReplay;
    // One label for every state of the button. See updateReplayButton().
    var playLabel = opts.playLabel || 'Riproduci';

    var state = STATE.IDLE;
    // Playback never starts on its own: the participant reads the context and
    // the request first, then presses the button when ready. Trials that begin
    // talking the instant they appear are heard over the tail of whatever the
    // participant was still reading.
    var playsUsed = 0;
    var replayed = 0;
    var rafId = null;
    var clearTimer = null;
    var prerollTimer = null;
    var endTimer = null;
    var watchdogId = null;
    var lastCt = -1;
    var lastProgressAt = 0;
    var abandoned = 0;
    // When the participant first pressed the play button, on the shared clock.
    // Absolute, not relative to anything the stage knows: the stage has no idea
    // when its trial began, so main.js does the subtraction against its own
    // reading of the same clock.
    var firstPressAt = null;
    var startWallTime = null;
    var resolveRun = null;
    var settled = false;
    var motionReduced = reducedMotion();
    var qWords, aWords, qSpans, aSpans;
    var qBlockShown = false, aBlockShown = false;

    container.classList.add('exp2-stage');
    STATE_CLASSES.forEach(function (c) { container.classList.remove(c); });
    clearChildren(container);

    // CSS transition/animation durations are real wall-clock time and don't
    // automatically compress the way audio.currentTime does under a faster
    // playbackRate, so expose 1/speed as a custom property the stylesheet
    // scales its own durations by (see calc(...* var(--exp2-anim-scale,1))
    // in global_exp2.css). The reveal timing itself needs no such scaling:
    // it's driven off audio.currentTime, which already advances faster on
    // its own once playbackRate is set, in real content-ms.
    container.style.setProperty('--exp2-anim-scale', String(1 / currentSpeed()));

    var scene = el('div', 'exp2-scene');

    var leftSpeaker = el('div', 'exp2-speaker exp2-speaker--left');
    var leftBubbleWrap = el('div', 'exp2-bubble-wrap exp2-bubble-wrap--left');
    var leftBubble = el('div', 'exp2-bubble exp2-bubble--left');
    leftBubble.setAttribute('aria-live', 'polite');
    var leftThinking = el('div', 'exp2-thinking');
    leftThinking.appendChild(el('span', 'exp2-dot'));
    leftThinking.appendChild(el('span', 'exp2-dot'));
    leftThinking.appendChild(el('span', 'exp2-dot'));
    leftBubbleWrap.appendChild(leftBubble);
    leftBubbleWrap.appendChild(leftThinking);
    var leftPortrait = el('div', 'exp2-portrait exp2-portrait--left');
    leftSpeaker.appendChild(leftBubbleWrap);
    leftSpeaker.appendChild(leftPortrait);

    var rightSpeaker = el('div', 'exp2-speaker exp2-speaker--right');
    var rightBubbleWrap = el('div', 'exp2-bubble-wrap exp2-bubble-wrap--right');
    var rightBubble = el('div', 'exp2-bubble exp2-bubble--right');
    rightBubble.setAttribute('aria-live', 'polite');
    var rightThinking = el('div', 'exp2-thinking');
    rightThinking.appendChild(el('span', 'exp2-dot'));
    rightThinking.appendChild(el('span', 'exp2-dot'));
    rightThinking.appendChild(el('span', 'exp2-dot'));
    rightBubbleWrap.appendChild(rightBubble);
    rightBubbleWrap.appendChild(rightThinking);
    var rightPortrait = el('div', 'exp2-portrait exp2-portrait--right');
    rightSpeaker.appendChild(rightBubbleWrap);
    rightSpeaker.appendChild(rightPortrait);

    scene.appendChild(leftSpeaker);
    scene.appendChild(rightSpeaker);
    container.appendChild(scene);

    // Appended after the scene, so it sits centred beneath both devils rather
    // than beside either one — it belongs to the exchange, not to a speaker.
    var replayBtn = el('button', 'exp2-replay');
    replayBtn.type = 'button';
    replayBtn.textContent = playLabel;
    container.appendChild(replayBtn);

    var audio = new Audio();
    if (audioUrl) audio.src = audioUrl;
    audio.preload = 'auto';

    if (!motionReduced) {
      qWords = layoutWords(question, qStart, qEnd);
      aWords = layoutWords(answer, aStart, aEnd);
      qSpans = setChildText(leftBubble, qWords);
      aSpans = setChildText(rightBubble, aWords);
    } else {
      qWords = [];
      aWords = [];
      leftBubble.textContent = question;
      rightBubble.textContent = answer;
    }

    function setState(next) {
      if (state === next) return;
      state = next;
      // Only the two "someone is talking" classes are toggled here.
      // `exp2-done` is latched by finish() and deliberately not cleared on the
      // way back to LISTENING for a replay: it is what reveals the rating
      // slider, which must not disappear and reappear under the participant.
      container.classList.remove('exp2-listening', 'exp2-answering');
      if (next === STATE.LISTENING) container.classList.add('exp2-listening');
      else if (next === STATE.ANSWERING) container.classList.add('exp2-answering');
      try {
        container.dispatchEvent(new CustomEvent('exp2:state', { detail: { state: next }, bubbles: true }));
      } catch (e) { /* CustomEvent unsupported: state class is still authoritative */ }
    }

    function applyReveal(ms) {
      leftSpeaker.classList.toggle('exp2-speaker--active', ms >= qStart && ms < qEnd);
      rightSpeaker.classList.toggle('exp2-speaker--active', ms >= aStart && ms < aEnd);

      // Each bubble lives only for its own turn. `qLive` ends where the answer
      // begins; `aLive` outlasts the recording by CLEAR_BUFFER_MS and then
      // everything is bare again, so nothing is left on screen to re-read
      // while the rating is being given.
      var qLive = ms >= qStart && ms < aStart;
      var aLive = ms >= aStart && ms < aEnd + CLEAR_BUFFER_MS;

      if (motionReduced) {
        // Whole-turn reveal: no per-word animation, but the same lifetime.
        if (question) leftBubble.classList.toggle('exp2-bubble--shown', qLive);
        if (answer) rightBubble.classList.toggle('exp2-bubble--shown', aLive);
      } else {
        for (var i = 0; i < qSpans.length; i++) {
          qSpans[i].classList.toggle('exp2-word--shown', qLive && ms >= qWords[i].revealAt);
        }
        for (var j = 0; j < aSpans.length; j++) {
          aSpans[j].classList.toggle('exp2-word--shown', aLive && ms >= aWords[j].revealAt);
        }
        leftBubble.classList.toggle(
          'exp2-bubble--shown', qLive && qWords.length > 0 && ms >= qWords[0].revealAt);
        rightBubble.classList.toggle(
          'exp2-bubble--shown', aLive && aWords.length > 0 && ms >= aWords[0].revealAt);
      }
      qBlockShown = leftBubble.classList.contains('exp2-bubble--shown');
      aBlockShown = rightBubble.classList.contains('exp2-bubble--shown');

      leftThinking.classList.toggle('exp2-thinking--active', ms < qStart);
      rightThinking.classList.toggle('exp2-thinking--active', ms >= qEnd && ms < aStart);

      if (ms >= aStart) setState(STATE.ANSWERING);
      else setState(STATE.LISTENING);
    }

    function tick() {
      if (settled) return;
      var ms = audio.currentTime * 1000;
      applyReveal(ms);
      if (audio.ended || ms >= totalMs) {
        scheduleClear();
        return;
      }
      rafId = global.requestAnimationFrame(tick);
    }

    // The recordings end exactly on the answer's last word (total_ms ==
    // a_end_ms for every item), so `audio.currentTime` has nothing left to run
    // and the final words would blink out on the same frame as the last
    // syllable. Hold them for CLEAR_BUFFER_MS of wall time, then clear.
    // Divided by the speed factor so a sped-up headless run does not spend
    // real seconds waiting here.
    function scheduleClear() {
      if (clearTimer || settled) return;
      clearTimer = global.setTimeout(function () {
        clearTimer = null;
        finish();
      }, CLEAR_BUFFER_MS / currentSpeed());
    }

    // The end of the trial is driven by the audio, not by the animation loop.
    //
    // The reveal runs on requestAnimationFrame, and the end of the trial used
    // to run there with it: tick() was the only thing that ever noticed the
    // recording had finished, and therefore the only thing that cleared the
    // text and released the rating slider. Frames are not promised to anybody.
    // A backgrounded tab gets none at all, and a busy machine drops them --
    // and with no frames, a recording that has plainly ended leaves the answer
    // frozen on screen, no slider, and a play button disabled for the duration
    // of a recording that is already over. There is no way out of that trial:
    // the participant cannot advance, cannot re-listen, and has done nothing
    // wrong. Someone glancing at another tab while the devils talk is enough.
    //
    // So the audio says when it is over. tick() still calls scheduleClear()
    // too, for the case where playback runs past totalMs without ending, and
    // both are idempotent through the clearTimer/settled guard.
    audio.addEventListener('ended', function () { scheduleClear(); });

    function finish() {
      if (settled) return;
      settled = true;
      stopWatchdog();
      clearEndTimer();
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = null;
      try { audio.pause(); } catch (e) { /* ignore */ }
      // Past every window, so both bubbles clear: the participant rates what
      // they heard, with nothing left on screen to re-read.
      applyReveal(aEnd + CLEAR_BUFFER_MS + 1);
      // `exp2-done` latches. It is what the stylesheet gates the rating slider
      // on, and a replay must not make the slider vanish and reappear — the
      // speaker highlighting is carried by the listening/answering classes,
      // which do come and go.
      setState(STATE.DONE);
      container.classList.add('exp2-done');
      updateReplayButton();
      if (resolveRun) { var r = resolveRun; resolveRun = null; r(); }
    }

    // Always on screen, always saying the same thing; enabled exactly while a
    // listen remains.
    //
    // It used to be hidden while the recording played and again once the
    // listens ran out, and each time the card changed height under the
    // participant -- once at the very moment they were trying to take the
    // scene in, and once as they were reaching for the slider. Disabling it
    // keeps the layout still, and keeping the wording fixed means the only
    // thing that ever changes about it is whether it can be pressed.
    function updateReplayButton() {
      var remaining = allowReplay ? MAX_PLAYS - playsUsed : Math.max(0, 1 - playsUsed);
      replayBtn.disabled = remaining <= 0;
      replayBtn.textContent = playLabel;
    }

    // A recording that stops without ending.
    //
    // The reveal is driven by audio.currentTime, so if playback dies mid-turn
    // -- the element paused by something outside, a decoder giving up, a
    // hosted mp3 whose connection drops (the recordings are served off-farm in
    // deployment) -- the loop spins on a timestamp that never moves. Nothing
    // reaches `ended`, so nothing reaches exp2-done: no slider, and a play
    // button disabled for a recording that is not playing. The participant has
    // no way out of the trial and no way to say so.
    //
    // This is what stops that being possible. It notices the lack of progress,
    // clears the half-revealed turn, and hands the button back -- pressing it
    // again is the obvious thing to do, so it must be the thing that works.
    // The listen is refunded, because it did not happen; `audio.load()` puts
    // the element back in a state where playing it again is meaningful.
    //
    // It is a timer rather than part of tick(), on purpose: tick() runs on
    // animation frames, and "no frames" is one of the ways playback stops
    // being observable.
    function startWatchdog() {
      stopWatchdog();
      lastCt = -1;
      lastProgressAt = nowMs();
      watchdogId = global.setInterval(function () {
        if (settled || prerollTimer || audio.ended) return;
        var ct = audio.currentTime;
        if (ct > lastCt + 0.01) { lastCt = ct; lastProgressAt = nowMs(); return; }
        if (nowMs() - lastProgressAt >= STALL_MS) abandonPlayback();
      }, STALL_TICK_MS);
    }

    function stopWatchdog() {
      if (watchdogId) global.clearInterval(watchdogId);
      watchdogId = null;
    }

    // The turn ends at totalMs, and a timer is what guarantees it.
    //
    // tick() already stops there, but tick() runs on animation frames, and
    // "no frames" is one of the ways this stage stops being able to see
    // anything (see the note above `ended` below). For an ordinary item that
    // costs nothing: totalMs IS the end of the recording, so the audio's own
    // `ended` event arrives at the same moment and whichever fires first wins
    // through the clearTimer/settled guard.
    //
    // It matters when totalMs is EARLIER than the recording -- which is what
    // a `?cont=off` run does, handing the stage the point where the
    // continuation begins. There, `ended` comes too late by a second or more,
    // and a participant who had switched tabs would go on HEARING the clause
    // the run exists to withhold while nothing on screen showed it. So the
    // stop is a timer, off the frame loop, like everything else here that must
    // happen whether or not the page is being drawn.
    function armEndTimer(speed) {
      clearEndTimer();
      var remaining = totalMs - (audio.currentTime * 1000);
      if (remaining < 0) remaining = 0;
      endTimer = global.setTimeout(function () {
        endTimer = null;
        if (settled) return;
        try { audio.pause(); } catch (e) { /* ignore */ }
        scheduleClear();
      }, remaining / (speed || 1));
    }

    function clearEndTimer() {
      if (endTimer) global.clearTimeout(endTimer);
      endTimer = null;
    }

    function abandonPlayback() {
      stopWatchdog();
      clearEndTimer();
      if (settled) return;
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = null;
      if (clearTimer) { global.clearTimeout(clearTimer); clearTimer = null; }
      try { audio.pause(); } catch (e) { /* ignore */ }
      try { audio.load(); } catch (e) { /* ignore */ }
      playsUsed = Math.max(0, playsUsed - 1);
      replayed = Math.max(0, playsUsed - 1);
      abandoned += 1;
      applyReveal(-1);
      setState(STATE.IDLE);
      updateReplayButton();
    }

    function beginPlayback() {
      settled = false;
      startWatchdog();
      var speed = currentSpeed();
      try { audio.playbackRate = speed; } catch (e) { /* ignore */ }
      armEndTimer(speed);
      startWallTime = global.performance ? global.performance.now() : Date.now();
      var p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          // Autoplay was blocked (no user gesture yet upstream). The reveal
          // loop still needs to run once playback actually starts, so retry
          // on the next tick rather than hanging forever.
          global.setTimeout(function () {
            if (!settled) audio.play().catch(function () {});
          }, 50);
        });
      }
      rafId = global.requestAnimationFrame(tick);
    }

    replayBtn.addEventListener('click', function () {
      if (playsUsed >= MAX_PLAYS || (!allowReplay && playsUsed >= 1)) return;
      // prerollTimer is in this guard as well as the two playback ones: for
      // PREROLL_MS after the press nothing is running yet, and without it a
      // double-click would spend a listen on each half of itself.
      if (rafId || clearTimer || prerollTimer) return;
      if (firstPressAt === null) firstPressAt = nowMs();
      playsUsed += 1;
      replayed = Math.max(0, playsUsed - 1);
      replayBtn.disabled = true;
      settled = false;
      // Clears anything left from a prior play, and -- because -1 is before
      // qStart -- turns the listening devil's dots on, which is what fills the
      // pre-roll pause.
      applyReveal(-1);
      setState(STATE.LISTENING);
      try { audio.currentTime = 0; } catch (e) { /* ignore */ }
      prerollTimer = global.setTimeout(function () {
        prerollTimer = null;
        beginPlayback();
      }, PREROLL_MS / currentSpeed());
    });

    // Resolves when the *first* listen finishes, which is when the rating
    // slider appears. Playback itself waits for the participant: the trial
    // shows the context and the request with the stage silent until they press
    // the button, so nothing is spoken over text they are still reading.
    this.run = function () {
      return new Promise(function (resolve) {
        resolveRun = resolve;
        updateReplayButton();
      });
    };

    Object.defineProperty(this, 'state', { get: function () { return state; } });

    // --- Harness/tooling extras, beyond the core mount/run/state/metrics/
    // destroy contract: pcibex/tools/preview.html uses these for its scrub
    // slider and state-jump buttons. Nothing in the trial flow needs them —
    // the stage still never has to know about a slider or a continue
    // button — but a manual "move the reveal to this timestamp and look at
    // it" control needs a way to force a recompute, hence seekTo(), and the
    // scrub slider needs something to follow along during real playback,
    // hence exposing the underlying <audio> read-only.
    this.seekTo = function (ms) {
      var clamped = Math.max(0, Math.min(totalMs, Number(ms) || 0));
      try { audio.currentTime = clamped / 1000; } catch (e) { /* ignore */ }
      applyReveal(clamped);
    };

    Object.defineProperty(this, 'audioElement', { get: function () { return audio; } });

    this.metrics = function () {
      return {
        replayed: replayed,
        // Logged as `playback_stalls`. It is also what lets a check tell "the
        // recording stopped and the stage recovered" from "the recording
        // played" — the two are indistinguishable from the outside otherwise.
        abandoned: abandoned,
        firstPressAt: firstPressAt,
        audioMs: Math.round(audio.currentTime * 1000),
        totalMs: totalMs,
        speed: currentSpeed(),
        wallMs: startWallTime != null ? Math.round((global.performance ? global.performance.now() : Date.now()) - startWallTime) : null
      };
    };

    this.destroy = function () {
      settled = true;
      stopWatchdog();
      clearEndTimer();
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = null;
      if (clearTimer) global.clearTimeout(clearTimer);
      clearTimer = null;
      if (prerollTimer) global.clearTimeout(prerollTimer);
      prerollTimer = null;
      try { audio.pause(); } catch (e) { /* ignore */ }
      audio.src = '';
      clearChildren(container);
      container.classList.remove('exp2-stage');
      STATE_CLASSES.forEach(function (c) { container.classList.remove(c); });
    };
  }

  var Exp2Dialogue = {
    mount: function (container, options) {
      if (!container) throw new Error('Exp2Dialogue.mount: container is required');
      return new Stage(container, options || {});
    },

    // Adds `touchedClass` (default "exp2-touched") to `input` the first time
    // the participant interacts with it, and returns a handle for reading
    // whether/when that happened. PCIbex's own logged Comments field for a
    // slider records "time from previous value to selected value", but reads
    // NULL when the value is ever set programmatically rather than by a real
    // drag — so this is the reliable way to log "did the participant ever
    // touch the slider".
    //
    // `pointerdown` and the slider's own keys count as well as `input`, and
    // Returns absolute timestamps rather than durations. The trial knows when
    // it started; this does not, and a helper that subtracts from an origin it
    // was never told is how the two-clock bug got in.
    //
    // a participant who wants exactly 50 changes nothing and fires no `input`
    // event at all. Before this they had to drag away from 50 and back in
    // order to say "50". A deliberate press on the scale is an answer, so it
    // opens the same gate — and the columns this feeds (slider_touched,
    // first_touch_ms, last_touch_ms) accordingly mean "interacted with the
    // slider", not "moved it". `slider_moves` is the one that means moved it.
    // Inaction still opens nothing.
    //
    // Only keys that actually work a slider count, so that tabbing through the
    // page cannot answer it in passing. `opts.onTouch` fires on every one of
    // these events, not only the first — it is what the trial hangs revealing
    // the continue button on, and that must not be wired to `input` separately
    // or a click at dead centre would mark the slider answered without
    // offering any way forward.
    watchSlider: function (input, options) {
      var opts = options || {};
      var cls = opts.touchedClass || 'exp2-touched';
      var events = ['input', 'pointerdown', 'keydown'];
      var sliderKeys = /^(Arrow(Left|Right|Up|Down)|Home|End|Page(Up|Down))$/;
      var touched = false;
      var firstTouchAt = null;
      var lastTouchAt = null;
      var moves = 0;
      function onTouch(e) {
        if (e && e.type === 'keydown' && !sliderKeys.test(e.key)) return;
        if (!touched) {
          touched = true;
          firstTouchAt = nowMs();
          input.classList.add(cls);
        }
        lastTouchAt = nowMs();
        // `moves` counts only `input`, i.e. only events that actually changed
        // the value; a touch that did not is still a touch (that is the whole
        // point of counting pointerdown), so the two measures answer different
        // questions and a click at dead centre gives touched=1, moves=0.
        if (e && e.type === 'input') moves += 1;
        if (opts.onTouch) opts.onTouch(e);
      }
      for (var i = 0; i < events.length; i++) input.addEventListener(events[i], onTouch);
      return {
        isTouched: function () { return touched; },
        // Absolute readings of the shared clock, or null if never touched. The
        // caller owns the trial's origin and does its own subtraction — see the
        // note on nowMs().
        firstTouchAt: function () { return firstTouchAt; },
        lastTouchAt: function () { return lastTouchAt; },
        moves: function () { return moves; },
        destroy: function () {
          for (var j = 0; j < events.length; j++) input.removeEventListener(events[j], onTouch);
        }
      };
    },

    // Watch the window losing and regaining the participant's attention, for
    // as long as one trial lasts.
    //
    // This is the only inattention measure in the experiment that does not go
    // through the participant's own hands. Someone who switches tabs while the
    // recording plays, or goes away and comes back before rating, produces
    // response times that look entirely ordinary — a long one is
    // indistinguishable from careful deliberation, and a short one from
    // fluency. `blurred_ms` separates them.
    //
    // Two events, not one. `blur`/`focus` catch switching to another window or
    // application; `visibilitychange` catches switching to another tab in this
    // one, which on some browsers fires no blur at all. They can both fire for
    // one departure, so "away" is a state with a single entry timestamp rather
    // than a counter each of them increments — otherwise alt-tabbing away once
    // would count as two.
    //
    // The count is of departures, so a participant who leaves once for four
    // minutes and one who leaves eight times for two seconds are told apart by
    // reading `blur_count` and `blurred_ms` together.
    watchFocus: function () {
      var awayAt = null;
      var count = 0;
      var total = 0;

      function leave() {
        if (awayAt !== null) return;   // already away; not a second departure
        awayAt = nowMs();
        count += 1;
      }
      function arrive() {
        if (awayAt === null) return;
        total += nowMs() - awayAt;
        awayAt = null;
      }
      function onVisibility() {
        if (document.hidden) leave(); else arrive();
      }

      global.addEventListener('blur', leave);
      global.addEventListener('focus', arrive);
      document.addEventListener('visibilitychange', onVisibility);
      // The trial can begin with the window already in the background — a
      // participant who started the experiment and switched away during the
      // preload is away for the whole of the first trial, and it would
      // otherwise read as perfect attention.
      if (document.hidden || (document.hasFocus && !document.hasFocus())) leave();

      return {
        count: function () { return count; },
        // Includes any stretch still in progress, so reading this while the
        // window is in the background gives the truth rather than the total so
        // far. That matters: it is read when the participant presses Avanti,
        // which they cannot do from another tab, but a `visibilitychange` that
        // never paired up would otherwise vanish silently.
        blurredMs: function () {
          return Math.round(total + (awayAt === null ? 0 : nowMs() - awayAt));
        },
        destroy: function () {
          arrive();
          global.removeEventListener('blur', leave);
          global.removeEventListener('focus', arrive);
          document.removeEventListener('visibilitychange', onVisibility);
        }
      };
    },

    // The one clock. Anything timing anything in this experiment reads it from
    // here, so that two measurements can always be subtracted. See nowMs().
    now: function () { return nowMs(); },

    // Scroll whatever a participant has to act on next into view, if it is not
    // already there.
    //
    // Used on the screening and metadata screens only, where each answer prints
    // the next question below the last and the page grows while the participant
    // is looking at what appears to be a finished form. That growth is what
    // justifies moving the page for them.
    //
    // Deliberately NOT used on a judgment trial. The continue button's box is
    // reserved along with the slider, so touching the scale changes nothing
    // about the page's shape — and scrolling it anyway moved the page under a
    // participant who had just clicked and might be about to click again. If
    // the button is below the fold there, the scroll cue says so and the
    // scrolling is theirs to do.
    //
    // Two details that the obvious version gets wrong:
    //
    //  * The element is often revealed by adding a class, and its layout is
    //    not final in the same tick. Measuring on the next animation frame,
    //    not immediately, is what makes the rect real rather than the zeroed
    //    rect of a `display: none` element.
    //  * A short poll afterwards, because PennController may still be printing
    //    later elements: a button measured as visible can be pushed below the
    //    fold a moment later by a sibling appearing beneath it.
    //
    // No-ops when the target is already fully visible, so nothing jumps under
    // a participant who can see the control perfectly well.
    keepInView: function (target, options) {
      var opts = options || {};
      var tries = opts.tries == null ? 6 : opts.tries;
      var every = opts.every == null ? 120 : opts.every;
      var pad = opts.pad == null ? 12 : opts.pad;
      var gen = newScrollIntent();

      function resolve() {
        if (!target) return null;
        if (typeof target === 'string') return document.querySelector(target);
        if (typeof target === 'function') return target();
        return target;
      }

      function check(remaining) {
        if (gen !== scrollGen) return;   // something later has the page now
        var el = resolve();
        if (el && el.getBoundingClientRect) {
          var r = el.getBoundingClientRect();
          var visible = r.height > 0 &&
            r.bottom <= (global.innerHeight || 0) - pad &&
            r.top >= pad;
          if (r.height > 0 && !visible && typeof el.scrollIntoView === 'function') {
            try {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } catch (e) {
              el.scrollIntoView(false);   // older engines: no options object
            }
          }
        }
        if (remaining > 0) global.setTimeout(function () { check(remaining - 1); }, every);
      }

      if (global.requestAnimationFrame) {
        global.requestAnimationFrame(function () { check(tries); });
      } else {
        check(tries);
      }
    },

    // Put the page back at the top, and keep it there for a moment.
    //
    // The experiment is one long-lived page, so `scrollY` survives a trial
    // ending: a participant who scrolled down to reach the slider met the next
    // screen already scrolled past its own first line, and the consent form —
    // which follows a screen tall enough to have been scrolled — opened below
    // its heading. Nothing was wrong with those screens; they were simply
    // being shown from the middle.
    //
    // Scrolling once is not enough. A trial's first command runs before
    // PennController has printed any of its elements, and the browser scrolls
    // to a form control by itself when something takes focus, so the page can
    // walk away from the top a few frames after being put there. It is
    // therefore held for `holdMs`, and the hold gives way immediately to a
    // participant who scrolls, or to a keepInView() that has something better
    // to show them.
    resetScroll: function (options) {
      var opts = options || {};
      var holdMs = opts.holdMs == null ? 300 : opts.holdMs;
      var gen = newScrollIntent();
      var startedAt = nowMs();
      var userEvents = ['wheel', 'touchstart', 'keydown'];

      function release() {
        for (var i = 0; i < userEvents.length; i++) {
          global.removeEventListener(userEvents[i], onUser, true);
        }
      }
      function onUser() {
        if (gen === scrollGen) newScrollIntent();   // hand the page back
        release();
      }
      for (var i = 0; i < userEvents.length; i++) {
        global.addEventListener(userEvents[i], onUser, true);
      }

      function hold() {
        if (gen !== scrollGen) { release(); return; }
        global.scrollTo(0, 0);
        if (nowMs() - startedAt >= holdMs) { release(); return; }
        if (global.requestAnimationFrame) global.requestAnimationFrame(hold);
        else global.setTimeout(hold, 16);
      }
      hold();
    },

    // A standing "there is more below" cue, shown only while the page can
    // actually be scrolled further down.
    //
    // The column the experiment is drawn in runs the full height of the
    // canvas, so its bottom edge cannot say anything about whether the content
    // has ended -- it always reaches the bottom of the window. Something has to
    // say it, because a trial is routinely taller than the viewport and the
    // rating slider and continue button live in the part below the fold.
    //
    // Installed once and driven by scroll/resize; a ResizeObserver on the body
    // covers the case that matters most, which is content appearing *while* the
    // page is still, as each answered question reveals the next one.
    installScrollCue: function (label) {
      if (document.querySelector('.exp2-scroll-cue')) return;
      var cue = document.createElement('div');
      cue.className = 'exp2-scroll-cue';
      cue.setAttribute('aria-hidden', 'true');
      cue.textContent = label || 'Continua a leggere ↓';
      document.body.appendChild(cue);

      var raf = null;
      function update() {
        raf = null;
        var doc = document.documentElement;
        var remaining = doc.scrollHeight - (global.innerHeight + (global.scrollY || doc.scrollTop || 0));
        cue.classList.toggle('exp2-scroll-cue--on', remaining > 24);
      }
      function schedule() {
        if (raf == null) raf = global.requestAnimationFrame(update);
      }

      global.addEventListener('scroll', schedule, { passive: true });
      global.addEventListener('resize', schedule);
      if (global.ResizeObserver) new global.ResizeObserver(schedule).observe(document.body);
      // The runtime replaces the whole trial subtree between trials, which is
      // not a body resize, so watch for that too.
      if (global.MutationObserver) {
        new global.MutationObserver(schedule)
          .observe(document.body, { childList: true, subtree: true });
      }
      schedule();
    },

    // Fills every `.exp2-duration` span on the page from its
    // `data-<phase>-<whole|split>` attribute, so the consent form's stated
    // study length is an edit in one file instead of copy scattered across
    // HTML. Keyed by phase as well as link because one consent form serves
    // both phases and the test is the shorter of the two.
    //
    // A missing attribute writes "__" rather than leaving the span empty or
    // silently keeping a wrong number: an unfilled duration has to be VISIBLE,
    // because nothing may be recruited against a consent form that misstates
    // how long the study takes. `npm run contracts` also fails on one.
    // ---------------------------------------------------------------------
    // The audio archive
    //
    // Deployed, every recording arrives inside ONE zip fetched from the lab
    // server, and this unpacks it into blob: URLs the stage can play. Locally
    // the mp3s sit beside the page and none of this runs.
    //
    // Why not PennController's own PreloadZip(), which does exactly this: it
    // works -- measured, 296 recordings unpacked from the real URL -- but it
    // files the blob URLs in an internal resource list that is reachable from
    // no global (there is no `PennEngine`, and `PennController` is a bare
    // function). The stage plays a detached `new Audio()` rather than a
    // PennController element, because it needs currentTime, playbackRate and
    // the `ended` event, none of which a PennController Audio exposes. So the
    // stage cannot see what PreloadZip loaded, and loading it twice to have it
    // in both places would cost the participant 21 MB twice.
    //
    // Reading the archive here is about sixty lines and depends on nothing:
    // no library, no PCIbex internals, no undocumented log format. It also
    // means the progress a participant sees is real.
    loadAudioZip: function (url, onProgress) {
      if (zipPromise) return zipPromise;
      zipPromise = (function () {
        return fetch(url, { credentials: 'omit' }).then(function (response) {
          if (!response.ok) {
            throw new Error('the audio archive could not be fetched (HTTP ' +
                            response.status + ') from ' + url);
          }
          // Streamed rather than response.arrayBuffer(), so the wait can be
          // reported: this is 16-22 MB and a participant on a slow line is
          // otherwise looking at a still screen for a minute with no sign
          // that anything is happening.
          var total = Number(response.headers.get('content-length')) || 0;
          if (!response.body || typeof response.body.getReader !== 'function') {
            return response.arrayBuffer();
          }
          var reader = response.body.getReader();
          var chunks = [];
          var got = 0;
          return (function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                var all = new Uint8Array(got);
                var at = 0;
                for (var i = 0; i < chunks.length; i++) { all.set(chunks[i], at); at += chunks[i].length; }
                return all.buffer;
              }
              chunks.push(r.value);
              got += r.value.length;
              if (onProgress) onProgress(total ? 0.9 * (got / total) : null, got, total);
              return pump();
            });
          })();
        }).then(function (buffer) {
          // The download is most of the wait, so the unpack shares the last
          // slice of the same progress bar rather than starting a new one.
          return unpackZip(buffer, function (done, total) {
            if (onProgress) onProgress(0.9 + 0.1 * (done / total), done, total);
          });
        });
      })();
      return zipPromise;
    },

    // The URL to play for a given recording: the unpacked blob when there is
    // an archive, and otherwise the bare filename, which is what a local run
    // wants (the mp3s are served beside the page). Never silently falls back
    // to the filename once an archive IS loaded and simply lacks the entry --
    // that would send the request to the farm, which does not have it, and
    // the trial would fail with a 404 nobody sees.
    audioUrl: function (name) {
      if (zipEntries) {
        if (Object.prototype.hasOwnProperty.call(zipEntries, name)) return zipEntries[name];
        throw new Error('the audio archive has no entry named ' + name);
      }
      return name;
    },

    audioZipLoaded: function () { return zipEntries !== null; },

    fillDuration: function (phase, split) {
      var attr = 'data-' + (phase || 'pretest') + '-' + (split ? 'split' : 'whole');
      var nodes = document.querySelectorAll('.exp2-duration');
      for (var i = 0; i < nodes.length; i++) {
        var v = nodes[i].getAttribute(attr);
        nodes[i].textContent = v == null ? '__' : v;
      }
    }
  };

  global.Exp2Dialogue = Exp2Dialogue;
})(typeof window !== 'undefined' ? window : this);
