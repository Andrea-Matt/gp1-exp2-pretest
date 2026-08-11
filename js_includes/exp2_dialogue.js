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

  // One initial listen plus one replay. Enforced here rather than by hiding
  // the button alone, so a stray double-click cannot buy a third.
  var MAX_PLAYS = 2;

  // Minimum/maximum for window.EXP2_SPEED. Default (no override, or 1) must
  // always be real-time — this is strictly a headless-testing affordance.
  var MIN_SPEED = 1;
  var MAX_SPEED = 20;

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
    var playLabel = opts.playLabel || 'Riproduci';
    var replayLabel = opts.replayLabel || 'Riascolta';

    var state = STATE.IDLE;
    // Playback never starts on its own: the participant reads the context and
    // the request first, then presses the button when ready. Trials that begin
    // talking the instant they appear are heard over the tail of whatever the
    // participant was still reading.
    var playsUsed = 0;
    var replayed = 0;
    var rafId = null;
    var clearTimer = null;
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

    function finish() {
      if (settled) return;
      settled = true;
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

    // Visible whenever a play remains, labelled for what it will do next.
    function updateReplayButton() {
      var remaining = allowReplay ? MAX_PLAYS - playsUsed : Math.max(0, 1 - playsUsed);
      replayBtn.hidden = remaining <= 0;
      replayBtn.textContent = playsUsed === 0 ? playLabel : replayLabel;
    }

    function beginPlayback() {
      settled = false;
      var speed = currentSpeed();
      try { audio.playbackRate = speed; } catch (e) { /* ignore */ }
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
      if (rafId || clearTimer) return;   // already playing; ignore double-clicks
      playsUsed += 1;
      replayed = Math.max(0, playsUsed - 1);
      replayBtn.hidden = true;
      settled = false;
      applyReveal(-1);                   // clear anything left from a prior play
      setState(STATE.LISTENING);
      try { audio.currentTime = 0; } catch (e) { /* ignore */ }
      beginPlayback();
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
        audioMs: Math.round(audio.currentTime * 1000),
        totalMs: totalMs,
        speed: currentSpeed(),
        wallMs: startWallTime != null ? Math.round((global.performance ? global.performance.now() : Date.now()) - startWallTime) : null
      };
    };

    this.destroy = function () {
      settled = true;
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = null;
      if (clearTimer) global.clearTimeout(clearTimer);
      clearTimer = null;
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
    // it fires an `input` event, and returns a handle for reading whether/when
    // that happened. PCIbex's own logged Comments field for a slider records
    // "time from previous value to selected value", but reads NULL when the
    // value is ever set programmatically rather than by a real drag — so this
    // is the reliable way to log "did the participant ever touch the slider".
    watchSlider: function (input, options) {
      var opts = options || {};
      var cls = opts.touchedClass || 'exp2-touched';
      var touched = false;
      var firstTouchAt = null;
      function now() { return global.performance ? global.performance.now() : Date.now(); }
      function onInput() {
        if (touched) return;
        touched = true;
        firstTouchAt = now();
        input.classList.add(cls);
      }
      input.addEventListener('input', onInput);
      return {
        isTouched: function () { return touched; },
        msSinceFirstTouch: function () { return touched ? Math.round(now() - firstTouchAt) : null; },
        destroy: function () { input.removeEventListener('input', onInput); }
      };
    },

    // Fills every `.exp2-duration` span on the page from its data-whole /
    // data-split attribute, so the consent form's stated study length is a
    // one-line edit shared by both link variants instead of copy scattered
    // across HTML.
    fillDuration: function (split) {
      var attr = split ? 'data-split' : 'data-whole';
      var nodes = document.querySelectorAll('.exp2-duration');
      for (var i = 0; i < nodes.length; i++) {
        var v = nodes[i].getAttribute(attr);
        if (v != null) nodes[i].textContent = v;
      }
    }
  };

  global.Exp2Dialogue = Exp2Dialogue;
})(typeof window !== 'undefined' ? window : this);
