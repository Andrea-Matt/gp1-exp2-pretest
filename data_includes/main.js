// ===== GP1 Exp2 PCIbex (PennController) =====
//
// One script shared by both pcibex/pretest and pcibex/test
// (pcibex/tools/build.py copies this file verbatim into both). What differs
// between the two lives in js_includes/exp2_phase.js (one generated line:
// window.EXP2_PHASE = "pretest" | "test") and in the item table name that
// follows from it.
//
// The split (whole vs. half-and-half with the wh fillers) comes from the
// recruitment link itself via ?split=sm / ?split=or / absent=whole, so one
// build serves three different running orders. See reference/PCIBEX-CORE.md
// before touching any of this, and pcibex/tools/verify.mjs for the assertions
// this script's data has to satisfy.

PennController.ResetPrefix(null); // Use PennController commands without the default prefix.
DebugOff();                       // Hide the debug panel for production runs (toggle to diagnose issues).

var showProgressBar = true;
var progressBarText = "Avanzamento"; // Italian progress label shown above the bar.

// Generate a unique numeric-only session ID: 13-digit timestamp + 6 random digits
// (identical to GP_Exp1_paid/data_includes/main.js).
const sessionID = (() => {
    const ts = Date.now().toString();                // 13 digits (ms since epoch)
    const rnd = (Math.floor(Math.random() * 9e5)     // 0..899999
        + 1e5)                                       // shift to 100000..999999 so first digit isn't zero
        .toString();
    return ts + rnd;                                 // typically 19 digits total
})();

// ------------------------------------------------------------
// Prolific
// ------------------------------------------------------------
// This study is recruited and paid through Prolific. Prolific pays the
// participant itself, out of the reward set on the study page, so there is no
// payment form here and no payment detail in the results -- see
// pcibex/PROLIFIC.md.
//
// What replaces all of that is one URL. A submission moves from "In Progress"
// to approved only when the participant lands on Prolific's completion URL,
// which carries a code Prolific generates for the study; a participant who
// never reaches it submits as NOCODE and has to be resolved by hand. The code
// is Prolific's, not ours: it cannot be chosen, so it cannot be in this file
// until the study exists.
//
// ONE STUDY PER PHASE, and that is an assumption about how recruitment is run,
// not just a shape for this table. Every link of a phase -- whole, ?split=sm,
// ?split=or, ?cont=off -- gets the code below, so they must all belong to the
// SAME Prolific study. Which they do if a phase is recruited through one link
// at a time.
//
// Run two Prolific studies for one phase -- a listing for ?split=sm and another
// for ?split=or, say, because the halves are different lengths and different
// rewards -- and every participant on the second one is handed the first one's
// code and submits as NOCODE. Nothing here would notice: the URL is well
// formed, the screen renders, and the two studies are indistinguishable from
// inside the experiment. If that is ever the plan, this table has to be keyed
// by phase AND split, like BLOCK_PLAN below, and check_contracts.mjs has to
// require an entry per link rather than per phase.
//
// Keyed by phase here for the same reason BLOCK_PLAN is keyed the way it is:
// one declaration that can be read straight through, rather than a ternary that
// has to be evaluated in the head.
//
// UNSETCODE is a real-shaped placeholder and deliberately not an empty string:
// the closing screen then renders locally exactly as it will on the farm, which
// is what lets it be drawn and looked at. The one thing that refuses it is
// `build.py --dist`, and it refuses the WHOLE build rather than the offending
// phase -- `--dist --phase pretest` is how to build the one that is ready.
// check_contracts.mjs holds the shape; DEPLOY.md says where the code comes
// from.
const PROLIFIC_COMPLETION = {
    pretest: "https://app.prolific.com/submissions/complete?cc=C1MMTM9A",
    test: "https://app.prolific.com/submissions/complete?cc=UNSETCODE"
};

// Who Prolific says this is, as the study link hands it over. The parameter
// names are the researcher's to choose on the study page; these three are the
// ones this study passes:
//
//   ...?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
//
// PROLIFIC_PID is the participant -- a 24-character identifier, stable across
// studies, and the only thing Prolific support can use to find someone when a
// submission goes wrong. SESSION_ID is the SUBMISSION, not the person: a new
// one per submission, so it cannot link a pretest participant to a test one.
// STUDY_ID is not logged -- with one study per phase, `phase` already says
// which study a row came from.
//
// Note the collision of names, which is only a collision of names: Prolific's
// SESSION_ID is a submission id, and this script's own `session_id` column is
// the timestamp-plus-random id generated above. They are different things and
// both are logged.
//
// The `|| "NA"` is load-bearing, and the case it covers is the ORDINARY one:
// every local run and every check in the suite bar one opens the experiment
// with no Prolific parameters at all. GetURLParameter returns undefined for a
// parameter that is not there, and `.log()` of undefined does not log a blank
// -- measured, by deleting this fallback and running one session: all 24 rows
// came out carrying the literal string "prolific_pid", the column's own name.
// Nothing errors, nothing is empty, and every check that asks whether a column
// has a value is satisfied. verify.mjs asserts the exact value instead, on both
// branches: one run per phase passes the parameters and must come back with
// them, the rest pass none and must come back "NA".
const PROLIFIC_PID = GetURLParameter("PROLIFIC_PID") || "NA";
const PROLIFIC_SUBMISSION = GetURLParameter("SESSION_ID") || "NA";

// ------------------------------------------------------------
// Phase / split / speed
// ------------------------------------------------------------
// EXP2_PHASE comes from the generated js_includes/exp2_phase.js, loaded
// before this file. "pretest" or "test".
const PHASE = window.EXP2_PHASE;

// This phase's completion URL, from the table above. Read once, here, so the
// closing screen has a single name to build both its link and its visible code
// from -- a link whose text says one code while it carries another is exactly
// the shape of thing nobody looks at twice.
const COMPLETION_URL = PROLIFIC_COMPLETION[PHASE];

// The item table name follows the phase: pretest gets pretest_items dot csv,
// test gets test_items dot csv, both already in chunk_includes. Built from
// two separate string literals rather than one combined literal on purpose:
// tools/pcibex/lint.mjs's missing-resource check greps for quoted strings
// that look like a filename (no regard for which experiment directory it is
// linting), and a single combined literal would name a file that exists in
// only one of the two experiment directories -- flagged as a 404 in
// whichever one it does not, even though the concatenation is never wrong at
// runtime.
const ITEMS_TABLE = PHASE + "_items" + ".csv";

// ------------------------------------------------------------
// Where the audio comes from
// ------------------------------------------------------------
// Item rows name audio by bare filename ("or-no-no-1.mp3"), which lets the
// same script resolve it two ways without the rows ever changing:
//
//   local run  -- EXP2_AUDIO_ZIP is empty. run.mjs merges local_resources/
//                 into chunk_includes, so the bare filename resolves against
//                 the page itself. This is what the whole verify.mjs suite
//                 exercises.
//   deployed   -- EXP2_AUDIO_ZIP is the URL of ONE zip on the lab server,
//                 holding this phase's recordings. The mp3s live there rather
//                 than in the farm project, which keeps the farm account far
//                 under its 64MB quota so the experiment can stay up
//                 indefinitely for readers of the paper.
//
// Set by the generated js_includes/exp2_host.js (see pcibex/tools/build.py).
//
// There is deliberately no AddHost() here, and this is the one place to read
// before adding one back. AddHost redirects PennController's OWN resource
// resolution -- newAudio, newImage, newVideo -- and two things follow from
// that, both of which were true of this script and neither of which any local
// run could show, because a local run serves the mp3s from the page root
// where a bare filename resolves anyway:
//
//   1. It never reached the recordings. The dialogue stage plays a detached
//      `new Audio()` (it needs currentTime, playbackRate and `ended`, none of
//      which a PennController Audio element exposes), and AddHost has no
//      say over that element's src. Measured against a real external host:
//      the stage requested the mp3 from the FARM and playback never started.
//   2. It did reach the devil portraits. newImage("leftEv", "leftEv.png") in
//      the preload trial started resolving against the audio host, where the
//      images are not, so both 404'd.
//
// So the URL is resolved here instead, explicitly, by the one function every
// caller goes through.
const AUDIO_ZIP = window.EXP2_AUDIO_ZIP || "";

// The URL to play for a recording. Exp2Dialogue.audioUrl throws rather than
// guessing once an archive is loaded and lacks the entry -- a bare filename
// would then be requested from the farm, which does not have it, and the trial
// would stall on a 404 that nothing reports.
const audioFor = (name) => Exp2Dialogue.audioUrl(name);

// Every recording this session can ask for, collected as the Templates below
// build their trials -- which happens when this script is evaluated, before the
// Sequence runs a single screen.
//
// It exists so that "the archive is missing a recording" is answered at the
// door instead of forty items in. That throw from audioUrl lands inside the
// judgment trial's mount-stage function, and a throw there is not a logged
// failure or a skipped item: PennController stops executing the trial's
// remaining commands and the trial never ends. The participant is left with the
// prompt, the context and the request on screen, no devils, no play button, no
// slider and no Avanti -- because none of those had been printed yet -- and the
// whole session is lost, with nothing in the results to say why. Measured by
// throwing deliberately from mount-stage: `run.mjs` reports "stalled: no
// visible change and no results posted" and resultsTable is empty.
//
// So the preload trial checks this set against the unpacked archive and refuses
// to start if anything is absent. See the preload trial.
const NEEDED_AUDIO = [];
const needsAudio = (name) => { if (name) NEEDED_AUDIO.push(name); return name; };

// ?split=sm / ?split=or / absent -> "whole". Any other value is treated as
// "whole" too, rather than silently producing zero trials.
const rawSplit = GetURLParameter("split");
const SPLIT = (rawSplit === "sm" || rawSplit === "or") ? rawSplit : "whole";

// ?speed=N speeds up audio playback for headless testing (tools/pcibex/run.mjs
// / pcibex/tools/verify.mjs pass this). Left untouched -- and so defaulting to
// real-time inside exp2_dialogue.js's own currentSpeed() -- for a real
// participant's link, which never carries this parameter.
const rawSpeed = GetURLParameter("speed");
if (rawSpeed) window.EXP2_SPEED = Number(rawSpeed);

// ?cont=off -> the answers have no continuation clause.
//
// A pilot variant, to hear what the pretest is like without the continuations
// before deciding whether to keep them. It plays its OWN recordings -- the same
// pieces assembled without the continuation piece, named by `audio_nocont` --
// and the displayed answer is cut to match, so nobody reads a clause they do
// not hear.
//
// It used to work by stopping the ordinary recording at `c_start_ms`, and that
// was wrong in a way nothing local could show. `audio.pause()` stops the
// element to the millisecond -- measured at -2 to +10 ms against the deployed
// build, with the audio coming out of the archive -- but the samples the
// operating system has already handed to the output device still reach the
// participant. On wired output that queue is 10-30 ms; on Bluetooth it is
// 150-250 ms, which is the first syllable of the clause this variant exists to
// withhold. Reported from the farm, on a build every local measurement called
// correct. There is now nothing to stop and no continuation in the file.
//
// PRETEST ONLY, enforced here rather than trusted to the link. In the test
// phase the continuation IS the manipulation -- `cond_answer` is impl/canc/ign,
// which are continuations -- so a test session with them switched off is not a
// variant of the design but the absence of one, and would log eight conditions
// that no longer differ. A `?cont=off` on a test link is ignored, and the
// results say `on`, which is what actually happened.
const CONTINUATIONS =
    (GetURLParameter("cont") === "off" && PHASE === "pretest") ? "off" : "on";

// `answer` is the whole utterance and `continuation` is its tail -- the same
// string, at the end (build_items.R asserts exactly that, so this is a check on
// data that has already been checked, not a guess about it). Cutting on the
// text rather than on a word count keeps the displayed answer in step with the
// audio: both stop at the same clause boundary or neither does.
//
// A row whose continuation is empty (the wh fillers) or that somehow does not
// end in it is returned untouched, so a mismatch degrades to "played whole"
// rather than to a truncation at the wrong place.
function answerWithoutContinuation(answer, continuation) {
    const a = String(answer || "");
    const c = String(continuation || "").trim();
    if (!c) return a;
    const at = a.lastIndexOf(c);
    if (at <= 0 || at + c.length !== a.length) return a;
    // Take the punctuation and space that joined the two clauses with it, then
    // close the sentence: "Ne ha rubate alcune, ma non le ha rubate tutte."
    // becomes "Ne ha rubate alcune." and not "Ne ha rubate alcune,".
    return a.slice(0, at).replace(/[\s,;:]+$/, "") + ".";
}

// Keeps only the rows a participant on this split should see:
//   whole -> everything (both critical sub-experiments + any wh fillers)
//   sm    -> the 24 sm critical rows + the first half (num 1-12) of the fillers
//   or    -> the 24 or critical rows + the second half (num 13-24) of the fillers
//
// The filler halving is PRETEST-ONLY in effect, and not by a phase test here:
// build_items.R emits wh rows for the pretest alone, so in the test table the
// `wh` branch below simply never matches a row. Left phase-agnostic on purpose
// — the filter states what a split means, and the item table states which rows
// exist; making both say it would be two places to get the answer from.
// GetTable(...).setGroupColumn("group") (below, at the Template call) has
// already restricted the table to this participant's one Latin-square group
// by this point; this filter runs on top of that.
function rowInSplit(row, split) {
    if (split === "whole") return true;
    if (row.subexp === split) return true;
    if (row.subexp === "wh") {
        const n = Number(row.num);
        if (split === "sm") return n >= 1 && n <= 12;
        if (split === "or") return n >= 13 && n <= 24;
    }
    return false;
}

// ------------------------------------------------------------
// Helpers to pull fixed-size chunks from a randomized trial set
// (identical to GP_Exp1_paid/data_includes/main.js)
// ------------------------------------------------------------
function Pick(set, n) {
    if (typeof set !== "object")
        throw new Error("pick expects a randomized set or predicate object");
    const count = Math.max(0, Number(n) || 0);
    this.args = [set];
    if (!Object.prototype.hasOwnProperty.call(set, "remainingSet"))
        set.remainingSet = null;
    this.run = arrays => {
        if (set.remainingSet === null)
            set.remainingSet = arrays[0];
        const block = [];
        while (block.length < count && set.remainingSet.length)
            block.push(set.remainingSet.shift());
        return block;
    };
}
const pick = (set, n) => new Pick(set, n);

// ------------------------------------------------------------
// Keeping the next thing to do on screen
// ------------------------------------------------------------
// The screening and metadata trials reveal one question at a time: each
// `.wait()` blocks until the current answer arrives, and only then do the next
// prompt and its input print. On a short window the page therefore grows
// downwards past the fold, and because nothing scrolls by itself a participant
// answers a question and is left looking at what appears to be a finished page
// — the question they are meant to answer next is below it.
//
// `keepInView` polls for about a second rather than measuring once, which is
// what makes a single call after each `.wait()` enough: at the moment the wait
// resolves the next element has not printed yet, and the poll catches it when
// it does. Targeting the last element container rather than a named element
// means the same call works at every step.
let scrollStep = 0;
const keepUpWithForm = () =>
    newFunction(`scroll-into-view-${++scrollStep}`, () => {
        Exp2Dialogue.keepInView(() => {
            const els = document.querySelectorAll(".PennController-elementContainer");
            for (let i = els.length - 1; i >= 0; i--) {
                if (els[i].getBoundingClientRect().height > 0) return els[i];
            }
            return null;
        }, { tries: 10 });
    }).call();

// ------------------------------------------------------------
// Starting every screen at the top
// ------------------------------------------------------------
// The experiment is one page that never navigates, so the scroll position
// survives a trial ending. A participant who scrolled down to reach the slider
// therefore met the next screen already scrolled past its first line, and the
// consent form — which follows a screen tall enough to have been scrolled —
// opened below its own heading. Nothing was wrong with those screens; they
// were being shown from the middle.
//
// This is the first command of every trial. It has to be a trial command
// rather than one global hook because there is no reliable "a trial started"
// event to hang one on; `npm run contracts` checks that no trial is missing
// it. Exp2Dialogue.resetScroll() holds the top for a moment afterwards,
// because the trial's elements print after this runs — see its comment.
let topStep = 0;
const startAtTop = () =>
    newFunction(`scroll-top-${++topStep}`, () => Exp2Dialogue.resetScroll()).call();

// ------------------------------------------------------------
// Turning a timestamp into a column
// ------------------------------------------------------------
// Every `*_ms` column measured from a trial's onset goes through here, so that
// "it never happened" is written down one way instead of four. `at` is an
// absolute reading of Exp2Dialogue.now() (or null/undefined if the thing never
// happened), `start` the trial's own reading of the same clock.
//
// "NA" rather than 0 or -1 for a thing that did not happen: read_exp2.R coerces
// these with as.numeric(), which turns "NA" into a real NA and would turn a 0
// into a zero-millisecond response — a value that is not merely wrong but
// wrong in the direction that looks like inattention.
//
// Rounded, because performance.now() has a fractional part and no measurement
// here means anything below a millisecond.
const sinceStart = (at, start) =>
    (at === null || at === undefined) ? "NA" : Math.round(at - start);

// ------------------------------------------------------------
// Latin-square counterbalancing
// ------------------------------------------------------------
// Advances Ibex's own server-side counter as soon as the experiment starts,
// rather than only once someone finishes (the default) -- see the "counter"
// label wired into Sequence below and reference/PCIBEX-CORE.md's note on
// SetCounter. GetTable(...).setGroupColumn("group") then uses that counter to
// hand each participant one of the four Latin-square lists (group a/b/c/d)
// round-robin, replacing Exp1's Math.random() group pick with something that
// actually spreads participants across lists on the real farm.
SetCounter("counter", "inc", 1);

// ------------------------------------------------------------
// Preload frequently used assets to avoid the first-trial lag
// ------------------------------------------------------------
newTrial("preload",
    startAtTop(),
    newImage("leftEv", "leftEv.png"),
    newImage("rightEv", "rightEv.png"),

    // Deployed, every recording for this phase arrives here, in one request.
    // The message is printed only if there is an archive to wait for, so a
    // local run's preload screen is unchanged.
    newText("zip-status", "")
        .css("font-size", "1.05em")
        .center()
        .print()
    ,
    newFunction("load-audio-zip", () => {
        if (!AUDIO_ZIP) return;
        const el = document.querySelector(".PennController-zip-status");
        const say = (t) => { if (el) el.textContent = t; };
        say("Caricamento in corso…");
        return Exp2Dialogue.loadAudioZip(AUDIO_ZIP, (frac) => {
            say(frac === null
                ? "Caricamento in corso…"
                : `Caricamento in corso… ${Math.round(frac * 100)}%`);
        }).then(() => {
            // Every recording the session will ask for has to be in there.
            // Without this the first trial naming a missing entry throws out of
            // audioFor() inside mount-stage, which stops that trial dead and
            // ends the session with no results and nothing on screen to say so
            // -- see NEEDED_AUDIO. A stale archive on the server is the way that
            // happens in practice: the build and the item tables move together
            // in git, the zip is uploaded by hand.
            //
            // Measured, by serving the same build twice against two archives
            // built from the same recordings: with the complete one the session
            // runs on and reaches the welcome screen; with one two entries
            // short it stops here, shows the message below, never reaches
            // welcome, and the thrown error names the two files.
            const missing = [];
            const seen = {};
            for (const name of NEEDED_AUDIO) {
                if (seen[name]) continue;
                seen[name] = true;
                try { Exp2Dialogue.audioUrl(name); }
                catch (e) { missing.push(name); }
            }
            if (missing.length) {
                say("Le registrazioni scaricate non sono complete (" +
                    missing.length + " mancanti). Non è possibile iniziare: " +
                    "scrivi a chi ti ha inviato il link.");
                throw new Error("the archive is missing " + missing.length +
                    " recording(s) this session needs, e.g. " +
                    missing.slice(0, 3).join(", "));
            }
            say("");
        }, (err) => {
            // A participant who cannot hear anything must be told, not left on
            // a screen that never advances. There is nothing they can do about
            // it, so the message says who to tell.
            say("Non è stato possibile caricare le registrazioni. " +
                "Controlla la connessione e ricarica la pagina; se il problema " +
                "persiste, scrivi a chi ti ha inviato il link.");
            throw err;
        });
    }).call(),
    // Installed once, here, because it has to outlive every trial: the cue is
    // appended to the body and driven by its own listeners, so it survives the
    // runtime replacing the trial subtree underneath it.
    newFunction("install-scroll-cue", () => {
        Exp2Dialogue.installScrollCue("Continua a leggere ↓");
    }).call(),
    newTimer("preload-wait", 500).start().wait()
).setOption("countsForProgressBar", false);

// ------------------------------------------------------------
// Welcome screen
// ------------------------------------------------------------
newTrial("welcome",
    startAtTop(),
    newText("welcome", "Ciao! Clicca qui sotto per iniziare.")
        .center()
        .print(),

    newButton("continue", "Avanti")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// There is no screening trial, and there is no eligibility check.
// ------------------------------------------------------------
// There were both, until this study moved to Prolific. They asked for native
// language and age and then ended the session for anyone who failed, on a
// screen that said "Puoi chiudere questa finestra" and waited forever.
//
// Prolific screens instead, with its own first-language and age prescreeners,
// against what a participant told Prolific when they joined. So the question is
// no longer this experiment's to ask -- and the dead end is no longer a thing it
// may have: a participant stranded on a screen they cannot leave submits as
// NOCODE, which costs them their payment and costs Prolific's support a ticket.
//
// Native language is not asked at all now; the prescreener is the only screen
// for it, and the `lang` column is gone from the results with it (see
// design/design.toml). Age IS still asked, in the questionnaire below, because
// it is an analysis variable and not only an eligibility one -- and it is asked
// the way the consent checkbox is asked, with a message beside the field and a
// screen that will not advance, rather than with a door out of the study.

// ------------------------------------------------------------
// Consent form (IRB version -- copied from GP_Exp1_paid, only the duration
// sentence changed to the exp2-duration span; see chunk_includes/consent_v2.html)
// ------------------------------------------------------------
newTrial("consent",
    startAtTop(),
    newHtml("consent_form", "consent_v2.html")
        .cssContainer({ "width": "500px", "fontsize": "1em" })
        .checkboxWarning("È necessario dare il proprio consenso prima di procedere.")
        .print()
    ,
    // Fills the exp2-duration and exp2-reward spans the form just printed,
    // from their data-<phase>-<whole|split> attributes -- one value per link
    // variant, all of them in one file. How long the study takes and what it
    // pays are the two numbers a participant is actually deciding on, and
    // neither is the same on all four links. See exp2_dialogue.js.
    newFunction("fill-duration", () => {
        Exp2Dialogue.fillDuration(PHASE, SPLIT !== "whole");
        // PennController writes the consent warning into the label but never
        // takes it back down, so it would sit there contradicting a box the
        // participant has since ticked.
        const warning = document.querySelector('label.error[for="__ALL_FIELDS__"]');
        // Found relative to the warning rather than by element name: PCIbex
        // strips the underscore when it builds its classes, so the obvious
        // `.PennController-consent_form` matches nothing (it is
        // `-consentform`), and that failure is silent.
        const form = warning ? warning.closest(".PennController-Html") : null;
        const box = form ? form.querySelector("input[type=checkbox].obligatory") : null;
        if (warning && box) {
            box.addEventListener("change", () => {
                if (box.checked) warning.textContent = "";
            });
        }
    }).call()
    ,
    newButton("continue", "Avanti")
        .settings.css("margin-top", "2em")
        .settings.css("margin-bottom", "2em")
        .settings.css("font-size", "1em")
        .center()
        .print()
        .wait(
            getHtml("consent_form").test.complete()
                .failure(getHtml("consent_form").warn())
        )
);

// ------------------------------------------------------------
// Demographic questionnaire
// ------------------------------------------------------------
// Adapted from GP_Exp1_paid, with age moved in from the screening trial this
// study no longer has, and native language dropped entirely -- Prolific's
// first-language prescreener is the only screen for it now.
//
// It runs AFTER the consent form, which is where a questionnaire belongs and
// which is simply what deleting the screening pair leaves behind: those two
// trials were the only reason anything was asked before consent.
//
// Age is gated, and the gate is the consent checkbox's gate rather than the old
// eligibility check's: a message beside the field, and a screen that will not
// advance until the answer is corrected. Nothing here ends a session. See the
// note where the screening trials used to be.
// The rule and the message, in one place, because the field is gated TWICE --
// on Enter and again on "Avanti" -- and two gates that disagree about what is
// acceptable, or say different things about it, are worse than one.
const AGE_OK = /^\s*(1[89]|[2-9]\d|1[01]\d)\s*$/;
const AGE_MESSAGE = "Inserisci la tua età in cifre. Per partecipare devi avere " +
    "almeno 18 anni.";

newTrial("meta",
    startAtTop(),
    defaultText
        .cssContainer({ "margin-bottom": "0.5em", "margin-top": "2em" })
        .center()
        .print()
    ,
    newText("instructions-1", "Per favore, inserisci tutti i dati richiesti qui sotto.")
    ,
    newText("age-desc", "Quanti anni hai? (Premi 'invio' per continuare.)")
    ,
    newTextInput("age_val")
        .cssContainer({ "margin-bottom": "0.5em" })
        .center()
        .print()
    ,
    // Printed empty and filled by the failure branch below. It has to exist
    // before the wait, because the wait is what fills it. `:empty` keeps it out
    // of the layout until there is something to say -- see global_exp2.css,
    // where it shares its rule with the consent warning so the two cannot drift
    // into looking like different kinds of message.
    //
    // No underscore in the name: PCIbex strips one when it builds the class, so
    // an element called `age_error` is `.PennController-ageerror` and every
    // selector naming it matches nothing, silently.
    newText("age-error", "")
        // Against defaultText's 2em, which is the gap BETWEEN questions. This
        // is not a question; it is about the field directly above it, and at
        // 2em it read as a detached notice rather than as a correction to that
        // answer. The stylesheet supplies the 1.2em that separates them.
        .cssContainer({ "margin-top": "0" })
    ,
    // Two rules in one test, for two different reasons.
    //
    // A whole number is data integrity: the field is free text, so before this
    // existed "trenta", "30 anni" and an empty answer all reached the `age`
    // column unexamined, and read_exp2.R's as.numeric() turned them into NA
    // without anyone being asked.
    //
    // 18 is the eligibility rule, and it is the only one this experiment still
    // enforces itself. Prolific's own minimum age to hold an account is 18 and
    // the study prescreens on age as well, so a number below it here is a typo
    // far more often than it is a fact. The message says what to type and what
    // the rule is, and stops there: it is a correction, not a door out of the
    // study, and nothing here may end a session.
    //
    // The upper bound is 119 and is there only to keep a slip of the hand out
    // of the data.
    getTextInput("age_val").wait(
        getTextInput("age_val").test.text(AGE_OK)
            .failure(getText("age-error").text(AGE_MESSAGE))
    ),
    // PennController leaves a warning where it wrote it, so an answer that is
    // now fine would sit under a message saying it is not. The consent trial
    // solves the same problem with a listener; here the wait has already
    // returned, so clearing it is one command.
    getText("age-error").text(""),
    // Read HERE, as the wait returns, and read again after the button gate at
    // the end of the trial.
    //
    // Each gate tests the field at one moment, and the field stays on screen and
    // editable between them. This read captures exactly what passed the Enter
    // gate; the one at the bottom captures what passed the button, which is the
    // value the participant left in the box. Without a read here, an answer
    // blanked and retyped would have to be trusted to the second gate alone;
    // without the second read, a correction made after this line would be
    // invisible in the data.
    //
    // The other three are scales, so none of them makes a claim this could
    // break.
    newVar("age")
        .global()
        .set(getTextInput("age_val"))
    ,
    keepUpWithForm(),
    newText("In che genere ti identifichi?")
        .print()
    ,
    newScale("gender_val", "femmina", "maschio", "altro")
        .labelsPosition("bottom")
        .settings.css("gap", "2em")
        .center()
        .print()
        .wait()
        .log()
    ,
    keepUpWithForm(),
    newText("handed-desc", "Sei mancina/o o destrimana/o?")
    ,
    newScale("handed_val", "mancina/o", "destrimana/o", "ambidestra/o")
        .labelsPosition("bottom")
        .settings.css("gap", "2em")
        .center()
        .print()
        .wait()
        .log()
    ,
    // There used to be a free-text question here asking students for their
    // field of study. It went when recruitment moved to Prolific, whose pool is
    // mostly not students, and the `study` column went with it -- see
    // design/design.toml.
    keepUpWithForm(),
    newText("caff-desc", "Hai assunto della caffeina oggi?")
    ,
    newScale("caff_val", "Sì", "No")
        .labelsPosition("bottom")
        .settings.css("gap", "2em")
        .center()
        .print()
        .wait()
        .log()
    ,
    keepUpWithForm(),
    newVar("gender")
        .global()
        .set(getScale("gender_val"))
    ,
    newVar("handed")
        .global()
        .set(getScale("handed_val"))
    ,
    newVar("caff")
        .global()
        .set(getScale("caff_val"))
    ,
    // The same gate again, on the way out, and it is not a belt-and-braces
    // repetition: the Enter gate is a gate on a MOMENT, not on an answer. The
    // field stays on screen and editable for the three questions that follow,
    // so "18", Enter, then 8 left the screen advancing on a value that was no
    // longer in the box -- measured, and the `age` column then said 18, which
    // was true of nothing. Same rule and same words as the gate above, from
    // AGE_OK and AGE_MESSAGE, so the two cannot drift apart.
    //
    // This is still not a door out: the button simply does not advance, exactly
    // as the consent form's does not until the box is ticked.
    newButton("continue", "Avanti")
        .settings.css("margin-top", "2em")
        .settings.css("margin-bottom", "2em")
        .settings.css("font-size", "1em")
        .center()
        .print()
        .wait(
            getTextInput("age_val").test.text(AGE_OK)
                .failure(getText("age-error").text(AGE_MESSAGE))
        )
    ,
    // PennController leaves a message where it wrote it, so the same clear as
    // after the first gate -- otherwise a corrected answer leaves the screen
    // with the correction still on it.
    getText("age-error").text(""),
    // And read the field once more. The early read caught the value that passed
    // the Enter gate; this one catches the value the participant actually left
    // in the box, which the button has just gated too. Both are gated values,
    // and this is the later of the two.
    getVar("age").set(getTextInput("age_val"))
);

// ------------------------------------------------------------
// Instructions block 1 (general framing -- adapted from GP_Exp1_paid for a
// listening rather than a reading task)
// ------------------------------------------------------------
newTrial("instructions1",
    startAtTop(),
    defaultText
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("kids",
        "In questo esperimento, sentirai parlare di sei bambini: Marta, Albi, Eva, Nico, Luna e Pietro. " +
        "Il contesto è fittizio, e nulla di ciò che verrà detto è un riferimento ad un fatto reale."
    ),

    newText("pranks",
        "Questi bambini fanno degli scherzi e combinano dei guai. " +
        "Per esempio, Eva rompe spesso degli oggetti, mentre Pietro si diverte a nascondere le cose degli altri."
    ),

    newText("speech",
        // Rewritten on 2026-09-19. Exp1's framing had the two devils handing
        // out rewards to the children, and the items a request saying what a
        // child would be rewarded for; it confused more than it explained, and
        // it said nothing about intonation, which is half of what the pretest
        // asks about. The devils now have fixed roles -- red asks, blue answers
        // -- and the request says what would make the red one happy.
        "In questo contesto, due spiritelli parlano di quello che fanno i bambini. " +
        "Lo spiritello rosso (a sinistra) fa delle domande sulla base di quello che lo renderebbe contento, " +
        "e lo spiritello blu (a destra) prova a dare delle risposte. " +
        "Tuttavia, lo spiritello blu non è molto bravo a parlare, e le risposte che dà sono talvolta incoerenti, " +
        "non rispondono veramente alla domanda fatta, oppure sono pronunciate con un'intonazione che ha poco senso. " +
        "<b>Il tuo compito sarà quello di penalizzare le risposte che non ti suonano accettabili rispetto alla domanda.</b> " +
        "Per farlo, userai un cursore che potrai muovere liberamente tra \"per nulla accettabile\" (estremo sinistro) e \"totalmente accettabile\" (estremo destro)."
    ),

    newText("logic",
        "Nota bene: il tuo compito è di valutare le risposte dello spiritello blu, e non le domande dello spiritello rosso. " +
        "Ascolta con attenzione e cerca di seguire il tuo intuito per decidere se la risposta che senti suona adeguata rispetto alla domanda oppure no."
    ),

    newButton("continue", "Avanti")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// Instructions blocks 2-4 used to sit here: three screens of worked examples,
// each a mock dialogue printed as text between two devil images, with a
// paragraph saying how it should sound and where on the scale to put it.
//
// They are gone, replaced by the training block below, which teaches the same
// things with the real thing: a recording the participant listens to and rates
// on the real slider, then a comment. A written mock could not do the half of
// it that matters here -- four of the six training items turn on PROSODY,
// and two pairs of them are the same answer heard against different questions,
// which on the page is simply the same sentence twice.
//
// What they taught is preserved: "an answer is judged against its question" and
// "extra information is still acceptable" are now in the opening screen's text
// (data/training_frame.md), and the uncertainty-vs-contradiction contrast is
// training items 1 and 2.
// ------------------------------------------------------------

// ------------------------------------------------------------
// The two screens wrapping the training block.
//
// Their prose is data/training_frame.md, rendered to
// js_includes/exp2_training_frame.js. They are printed on their own — nothing
// else on the screen — because each is a moment of orientation, not part of a
// trial: one sets up the practice, the other hands over to the experiment.
// ------------------------------------------------------------
const TRAINING_FRAME = window.EXP2_TRAINING_FRAME || { opening: [], closing: [] };

// Paragraphs as separate elements rather than one blob with <br><br>: the
// spacing is then the stylesheet's business and matches every other screen.
const frameParagraphs = (slot) =>
    (TRAINING_FRAME[slot] || []).map((text, i) =>
        newText(`frame-${slot}-${i}`, text)
            .css("margin-bottom", "1em")
            .css("margin-top", i === 0 ? "1em" : "0")
            .print()
    );

// The opening screen carries a title, where no other framing screen does: it is
// the one place a participant has to register that what follows is practice and
// not the experiment, and a heading is read where a first sentence is skimmed.
// Same size and weight as the break screens' "Pausa".
newTrial("training-intro",
    startAtTop(),
    newText("training-title", "Dialoghi di prova")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
        .center()
        .print(),
    ...frameParagraphs("opening"),
    newButton("continue", "Avanti")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// Training: the 6 items in chunk_includes/training_items.csv, in table order.
//
// Same dialogue + slider + continue machinery as a judgment trial, so a
// participant meets the real task before any of it counts, and each item is
// preceded by its own `intro` sentence saying what to listen for.
//
// Three things about this trial that are not free:
//
//   * It deliberately does not .log() condition/subexp/num. pcibex/tools/
//     verify.mjs counts judgment trials by a populated `condition`, so a
//     training trial that logged one would be counted as data.
//   * The table is phase-independent — the same 6 rows are written into both
//     phases' chunk_includes by prepare_stimuli.py — so it is NOT filtered by
//     split and carries no `group`: every participant does all 6, in order.
//   * Order is the table's, not randomized. The items build on each other
//     (ignorance, then two prosody contrasts), and `num` in
//     data/training_items.tsv is what sets it. There were 8 until 2026-09-19;
//     the last pair, on marked questions, was dropped.
// ------------------------------------------------------------
const TRAINING_TABLE = "training_items" + ".csv";

// Position within the training block, logged as `trial_index` the way the
// judgment trials log theirs. Its own counter: the two never interleave, and
// sharing one would make a judgment trial's index depend on how the training
// went.
let trainingIndex = 0;

// How many training trials there are, counted as the Template below builds
// them -- which happens when this script is evaluated, so by the time any
// training trial RUNS it is final. It is what the "x/6" on each trial's counter
// is read from, rather than a 6 written into this file: the table is the one
// place that says how many items there are.
let trainingTotal = 0;

// The one check the training block makes on an answer.
//
// Each training item's comment says which end of the scale it belongs at, and
// `label` in the table records which one that is. On the first "Avanti" whose
// slider is on the wrong side of the scale -- or exactly on its midpoint, which
// is neither side -- the trial does not advance and TRAINING_WARNING appears.
// The second "Avanti" advances whatever the slider says: this is a nudge to
// read the instructions again, not a gate a participant can get stuck behind,
// and nothing in this experiment may end or stall a session.
//
// Strict inequalities against the midpoint of the 0-100 scale, so 50 counts as
// wrong in both directions and 51 / 49 as right. Whether the warning was shown
// is logged as `training_warned`; the final rating is logged as always.
const TRAINING_MIDPOINT = 50;
const TRAINING_WARNING = "Per favore, rileggi le istruzioni.";
// How long the warning has to have been on screen before an "Avanti" goes
// through. Without it a double-click passes the gate in one gesture -- its
// first click is refused and its second, a tenth of a second later, is "the
// second Avanti" -- and the message is never read. A click inside the window is
// refused again, which changes nothing on screen.
const TRAINING_WARNING_MIN_MS = 600;

// true when the slider sits on the side of the scale `label` says, and also
// when there is nothing to judge (no slider found, a label that is neither
// value) -- an answer this cannot read is never a reason to hold a
// participant back.
// Where the training trial's "Avanti" is in the window, or null.
function trainingButtonTop() {
    const b = document.querySelector(".PennController-continue");
    return b ? b.getBoundingClientRect().top : null;
}

function trainingAnswerOnRightSide(label) {
    const input = document.querySelector(
        ".PennController-rating-container input[type=range]");
    if (!input) return true;
    const v = Number(input.value);
    if (label === "good") return v > TRAINING_MIDPOINT;
    if (label === "bad") return v < TRAINING_MIDPOINT;
    return true;
}

Template(
    GetTable(TRAINING_TABLE),
    row => {
        // Only for a LOCAL run, where the file sits beside the page. Deployed,
        // the recording is already in memory from the archive, and pointing a
        // PennController resource at a bare filename would make it fetch from
        // the farm, which does not have it.
        if (!AUDIO_ZIP) newAudio("training-stim", row.audio);
        needsAudio(row.audio);

        // Same three pieces of per-trial state the judgment trial keeps, for
        // the same reason: one clock origin, and two watchers whose listeners
        // outlive the trial unless they are torn down.
        let itemStart = 0;
        let sliderWatch = null;
        let focusWatch = null;
        // Whether this trial has already shown TRAINING_WARNING. Set by the
        // failure branch of the "Avanti" gate below, and read by the test in
        // it, so the test itself changes nothing: PennController may evaluate
        // a test more than once per click, and a test that flipped this as a
        // side effect could let the FIRST wrong click through.
        let warned = false;
        // When the warning went up, on Exp2Dialogue's clock.
        let warnedAt = null;
        // The button's position on screen just before the warning goes in above
        // it; see training-mark-warned.
        let buttonTop = null;
        const position = ++trainingTotal;

        return newTrial("training",
            startAtTop(),
            ...clearResponseVars(),
            // "Dialogo di prova x/6", above everything else on the screen, so
            // no training item can be mistaken for a trial that counts. Filled
            // in rather than printed with its text, because the total is only
            // known once every row has been built -- see trainingTotal.
            newText("training-counter", "").center().print(),
            newFunction("training-counter-fill", () => {
                const el = document.querySelector(".PennController-training-counter");
                if (el) el.textContent = `Dialogo di prova ${position}/${trainingTotal}`;
            }).call(),
            // Order on screen: counter, intro, context, request, dialogue —
            // and then, only once the recording has played through, the
            // comment on the item (the amber box), the prompt, the slider, the
            // (empty) warning and the button.
            //
            // That reveal is not wired here. Everything printed AFTER the stage
            // element is hidden by the stylesheet until the stage carries
            // `exp2-done`, which the dialogue sets when playback finishes; the
            // continue button then has a second gate on `exp2-answered`. So the
            // comment appears with the slider by virtue of being printed after
            // the stage, and a participant cannot read the answer before
            // hearing the item. See the gate block in global_exp2.css.
            newText("training-notice", row.intro)
                .css("margin-bottom", "2em")
                .css("padding", "0.75em 1em")
                .css("border", "1px dashed var(--exp2-line-strong)")
                .css("border-radius", "12px")
                .center()
                .print(),

            newText("context", row.context)
                .italic()
                .center()
                .css("text-align", "center")
                .cssContainer({ "text-align": "center" })
                .print(),
            newText("request", row.request)
                .css("margin-bottom", "1em")
                .italic()
                .center()
                .css("text-align", "center")
                .cssContainer({ "text-align": "center" })
                .print(),

            newFunction("training-mark-start", () => {
                itemStart = Exp2Dialogue.now();
                trainingIndex += 1;
                if (focusWatch) focusWatch.destroy();
                focusWatch = Exp2Dialogue.watchFocus();
            }).call(),

            newText("stage", "<div></div>").print(),

            newFunction("training-mount", () => {
              const container = document.querySelector(".PennController-stage-container");
              try {
                if (window.__exp2CurrentDialogue) {
                    try { window.__exp2CurrentDialogue.destroy(); } catch (e) { /* ignore */ }
                    window.__exp2CurrentDialogue = null;
                }
                const dialogue = Exp2Dialogue.mount(container, {
                    question: row.question,
                    answer: row.answer,
                    qStart: Number(row.q_start_ms),
                    qEnd: Number(row.q_end_ms),
                    aStart: Number(row.a_start_ms),
                    aEnd: Number(row.a_end_ms),
                    totalMs: Number(row.total_ms),
                    audioUrl: audioFor(row.audio),
                    allowReplay: true,
                    playLabel: "Riproduci"
                });
                window.__exp2CurrentDialogue = dialogue;
                dialogue.run();
              } catch (e) {
                stageFailureNotice(container, e);
                throw e;
              }
            }).call(),

            // The box and the prompt are both printed after the stage, so both
            // are revealed with the slider. The box comes first, above the
            // prompt (Andrea's call, 2026-09-19): the instruction is read, then
            // the question, then the slider. Above the slider in any case: it
            // ends by saying which way to move the cursor, which is no use
            // underneath the cursor.
            //
            // This is the sentence the whole training trial exists to deliver,
            // so it is a box that cannot be read past: amber, heavy-bordered,
            // under a heading of its own. All of its look is in
            // global_exp2.css (`.PennController-training-feedback`) and none of
            // it here, because a .css() here is an inline style and would beat
            // the stylesheet. TRAINING_WARNING sends the participant back to
            // this box, and the heading is what lets them find it.
            newText("training-feedback",
                '<span class="exp2-callout-title">Come valutare questa risposta</span>' +
                row.feedback)
                .print(),

            newText("prompt", "Quanto è accettabile la risposta alla domanda?")
                .css("margin-bottom", "2em")
                .center()
                .print(),

            newScale("rating", 101)
                .slider()
                .before(newText("lo", "(per nulla accettabile) "))
                .after(newText("hi", " (totalmente accettabile)"))
                .center()
                .print(),

            newFunction("training-wire-slider", () => {
                const input = document.querySelector(".PennController-rating-container input[type=range]");
                const stageContainer = document.querySelector(".PennController-stage-container");
                // onTouch rather than a listener of our own: what counts as touching
                // the slider is watchSlider's business, and a click that lands on the
                // centre value it is born at counts. See its comment.
                sliderWatch = Exp2Dialogue.watchSlider(input, {
                    onTouch: () => {
                        stageContainer.classList.add("exp2-answered");
                    }
                });
            }).call(),

            // Printed empty, between the slider and the button, and filled only
            // by the gate's failure branch -- so it appears directly above the
            // "Avanti" that was just refused. Empty, it takes no space at all
            // (`:empty`, with !important, in global_exp2.css -- the rule the age
            // message taught), and it shares its look with the consent and age
            // messages.
            //
            // Appearing above the button pushes the button down by the
            // message's height at the instant of the click, and the second
            // click -- the one that is supposed to go through -- would then land
            // on the message. So the failure branch notes where the button is
            // on screen before the text goes in, and scrolls the page by however
            // far it moved: the button stays under the pointer and the page
            // above it rises to make room. See trainingButtonTop.
            newText("training-warning", "").center().print(),

            newButton("continue", "Avanti")
                // Tight against the slider: on the rating trials the two are one
                // action, and 2em of air reads as a page break between them.
                .settings.css("margin-top", "0.35em")
                .settings.css("margin-bottom", "2em")
                .settings.css("font-size", "1em")
                .center()
                .print(),

            // The gate's halves, as functions rather than inline: the test
            // reads the slider and `warned` and changes nothing; the failure
            // branch is the only thing that sets `warned`. See `warned` above.
            //
            // Neither of the last two may throw: a throw inside a trial stops
            // it for good (see stageFailureNotice), and these run on the click
            // of a participant who is doing nothing wrong. Hence the try/catch
            // around what touches the page -- the worst a failure here can do
            // is leave the button a few pixels lower.
            newFunction("training-answer-ok", () =>
                (warned && Exp2Dialogue.now() - warnedAt >= TRAINING_WARNING_MIN_MS) ||
                trainingAnswerOnRightSide(row.label)),
            newFunction("training-note-button", () => {
                try { buttonTop = trainingButtonTop(); } catch (e) { buttonTop = null; }
            }),
            newFunction("training-mark-warned", () => {
                // The first refusal only: a click inside TRAINING_WARNING_MIN_MS
                // is refused again and must not restart the wait.
                if (!warned) { warned = true; warnedAt = Exp2Dialogue.now(); }
                // Put the button back where the pointer is. Where the page
                // cannot scroll that far (it fits the window with room to
                // spare), what remains is a button a few pixels lower and a
                // click that lands on the message, which does nothing. No
                // `behavior`: nothing here sets smooth scrolling, and the
                // two-argument form is the one every engine takes.
                try {
                    const now = trainingButtonTop();
                    if (buttonTop !== null && now !== null && now !== buttonTop) {
                        window.scrollBy(0, now - buttonTop);
                    }
                } catch (e) { /* see above */ }
                buttonTop = null;
            }),

            getButton("continue").wait(
                getFunction("training-answer-ok").test.is(true)
                    .failure(
                        getFunction("training-note-button").call(),
                        getText("training-warning").text(TRAINING_WARNING),
                        getFunction("training-mark-warned").call()
                    )
            ),

            // Read the response out, exactly as the judgment trial does. These
            // must be `getVar(...).set()` commands in the trial's sequence, not
            // calls inside a newFunction body -- see the same note there.
            getVar("ratingVar").set(() => {
                const input = document.querySelector(
                    ".PennController-rating-container input[type=range]");
                return input ? Number(input.value) : "NA";
            }),
            getVar("touchedVar").set(
                () => (sliderWatch && sliderWatch.isTouched() ? 1 : 0)),
            getVar("movesVar").set(
                () => (sliderWatch ? sliderWatch.moves() : "NA")),
            getVar("playPressVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                const at = d ? d.metrics().firstPressAt : null;
                return sinceStart(at, itemStart);
            }),
            getVar("firstTouchVar").set(
                () => sinceStart(sliderWatch && sliderWatch.firstTouchAt(), itemStart)),
            getVar("lastTouchVar").set(
                () => sinceStart(sliderWatch && sliderWatch.lastTouchAt(), itemStart)),
            getVar("submitVar").set(() => Math.round(Exp2Dialogue.now() - itemStart)),
            getVar("audioPlayedVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                const m = d ? d.metrics() : {};
                return m.audioMs != null ? m.audioMs : Number(row.total_ms);
            }),
            getVar("replayedVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                return d ? (d.metrics().replayed || 0) : 0;
            }),
            getVar("stallsVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                return d ? (d.metrics().abandoned || 0) : 0;
            }),
            getVar("blurCountVar").set(() => (focusWatch ? focusWatch.count() : "NA")),
            getVar("blurredVar").set(() => (focusWatch ? focusWatch.blurredMs() : "NA")),
            getVar("trialIndexVar").set(() => trainingIndex),
            getVar("trainingWarnedVar").set(() => (warned ? 1 : 0)),

            newFunction("training-teardown", () => {
                const d = window.__exp2CurrentDialogue;
                if (d) { try { d.destroy(); } catch (e) { /* ignore */ } }
                window.__exp2CurrentDialogue = null;
                if (focusWatch) { focusWatch.destroy(); focusWatch = null; }
                if (sliderWatch) { sliderWatch.destroy(); sliderWatch = null; }
            }).call()
        )
            // The training rows carry the same columns as a judgment row
            // wherever the two mean the same thing, so one reader handles both.
            //
            // Two columns are deliberately absent: `condition` and the design
            // factors that go with it. That is not an oversight — `condition`
            // being empty is precisely what marks a row as training, and
            // verify.mjs counts judgment trials by it. `training_item` is the
            // mirror image, empty on every judgment row.
            .log("session_id", sessionID)
            // Prolific's own two, straight off the study link. See the
            // block at the top of this file: PROLIFIC_PID is the person,
            // prolific_submission is ONE submission, and neither is the
            // `session_id` above it, which this script generates itself.
            .log("prolific_pid", PROLIFIC_PID)
            .log("prolific_submission", PROLIFIC_SUBMISSION)
            .log("phase", PHASE)
            .log("split", SPLIT)
            .log("continuations", CONTINUATIONS)
            .log("trial_index", getVar("trialIndexVar"))
            .log("training_item", `${row.num}-${row.topic}-${row.label}`)
            // 1 if this item's first "Avanti" found the slider on the wrong side
            // of the scale (or on its midpoint) and TRAINING_WARNING was shown,
            // 0 if not. The rating below is the one finally submitted, which
            // after a warning may or may not have been corrected.
            .log("training_warned", getVar("trainingWarnedVar"))
            .log("num", row.num)
            .log("item_context", row.context)
            .log("item_reward_condition", row.request)
            .log("item_question", row.question)
            .log("item_answer", row.answer)
            .log("audio_file", row.audio)
            .log("recording_ms", Number(row.total_ms))
            .log("rating", getVar("ratingVar"))
            .log("slider_touched", getVar("touchedVar"))
            .log("slider_moves", getVar("movesVar"))
            .log("replayed", getVar("replayedVar"))
            .log("play_press_ms", getVar("playPressVar"))
            .log("first_touch_ms", getVar("firstTouchVar"))
            .log("last_touch_ms", getVar("lastTouchVar"))
            .log("submit_ms", getVar("submitVar"))
            .log("audio_played_ms", getVar("audioPlayedVar"))
            .log("blur_count", getVar("blurCountVar"))
            .log("blurred_ms", getVar("blurredVar"))
            .log("playback_stalls", getVar("stallsVar"));
    }
);

// ------------------------------------------------------------
// The screen between the training block and the real items.
//
// This used to read "Inizio dell'esperimento" and nothing else. It now carries
// the training block's closing text, so the same screen that says the practice
// is over is the one whose button starts the experiment — rather than a bare
// heading a participant has no reason to stop and read.
// ------------------------------------------------------------
newTrial("beginning",
    startAtTop(),
    ...frameParagraphs("closing"),
    newButton("continue", "Inizia l'esperimento")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

const makeBreakTrial = (label, doneCount, totalCount) =>
    newTrial(label,
        startAtTop(),
        newText("break-title", "Pausa")
            .css("font-size", "1.6em")
            .css("font-weight", "bold")
            .center()
            .print(),

        newText("break-body",
            `Hai completato ${doneCount} giudizi su ${totalCount}.<br>` +
            "Ti consigliamo di prenderti circa 30 secondi di pausa prima di proseguire.<br>" +
            "Quando sei pronta/o, premi il pulsante per continuare."
        )
            .css("margin-top", "1.5em")
            .css("margin-bottom", "1.5em")
            .center()
            .print(),

        newButton("break-continue", "Riprendi con l'esperimento")
            .css("margin-top", "1.5em")
            .css("margin-bottom", "1.5em")
            .css("font-size", "1em")
            .center()
            .print()
            .wait()
    )
        .setOption("countsForProgressBar", false);

// How the judgment trials are cut into blocks, with a break between each pair.
//
// One declaration, phase by split, rather than a pair of ternaries: the counts
// stopped being the same in both phases when the wh fillers were dropped from
// the test (48 whole / 24 per split there, against the pretest's 72 / 36), and
// four configurations expressed as nested conditionals is where a wrong number
// hides. pcibex/tools/check_contracts.mjs parses THIS object and asserts each
// row sums to what verify.mjs expects, so a block size edited here without its
// counterpart in verify.mjs fails the contracts run rather than shipping.
//
// Blocks are near-equal by design: a break lands mid-session, not next to it.
const BLOCK_PLAN = {
    pretest: { whole: [24, 24, 24], sm: [18, 18], or: [18, 18] },
    test: { whole: [24, 24], sm: [12, 12], or: [12, 12] }
};

const BLOCKS = BLOCK_PLAN[PHASE][SPLIT];
const TOTAL_TRIALS = BLOCKS.reduce((a, b) => a + b, 0);

// One break trial between consecutive blocks: n blocks -> n-1 breaks. Each is
// told how many judgments come before it, which is the running total.
let doneSoFar = 0;
for (let i = 0; i < BLOCKS.length - 1; i++) {
    doneSoFar += BLOCKS[i];
    makeBreakTrial(`judgment-break-${i + 1}`, doneSoFar, TOTAL_TRIALS);
}

// ------------------------------------------------------------
// Acceptability judgment trials
// ------------------------------------------------------------
// The response columns have to be declared out here, `.global()`, exactly as
// GP_Exp1_paid does. A `newVar` created inside the trial is scoped to it, and
// the `.log("rating", getVar("ratingVar"))` calls hanging off newTrial(...)
// cannot resolve it — every such column logs `undefined`, silently, with the
// trial otherwise running perfectly.
newVar("ratingVar").global();
newVar("touchedVar").global();
newVar("movesVar").global();
newVar("replayedVar").global();
newVar("playPressVar").global();
newVar("firstTouchVar").global();
newVar("lastTouchVar").global();
newVar("submitVar").global();
newVar("audioPlayedVar").global();
newVar("blurCountVar").global();
newVar("blurredVar").global();
newVar("stallsVar").global();
newVar("trialIndexVar").global();
newVar("trainingWarnedVar").global();

// Every response column, cleared at the start of the trial that will log it.
//
// These are `.global()` vars by necessity (a newVar created inside a trial
// cannot be resolved by the `.log()` calls hanging off newTrial), and a global
// var's value outlives the trial that set it. `.log()` reads whatever is in it
// when the row is written. So a trial that ends WITHOUT having executed its own
// `getVar(...).set()` commands logs the previous trial's rating, timings, move
// counts and stall count -- a complete, plausible response row for an item the
// participant may never have answered. Nothing about such a row looks wrong.
//
// This is not hypothetical. The 2026-09-06 pilot session carries forty rows
// holding one trial's response block and twenty-four holding another's, under
// correct and varying item text; it took comparing `trial_index` against the
// item columns to see it at all, and the same script produced clean sessions on
// 2026-09-08 and 2026-09-10. Whatever skipped those commands, a stale global is
// what turned it into data.
//
// "NA" rather than 0 or an empty string, for the reason sinceStart() gives:
// read_exp2.R coerces these with as.numeric(), "NA" becomes a real NA, and
// assert_exp2() stops on a trial with no rating. An aborted trial is then a
// loud failure in the loader rather than a row in a model.
//
// Commands, not assignments inside a newFunction: `.set()` builds a command
// object the engine has to execute, and calling it from plain JS constructs it
// and drops it -- the same trap the reading block below warns about.
// A function declaration, not a const: the training Template above this line
// spreads it into its trial, and a `const` would still be in its temporal dead
// zone when that Template's callback runs -- which is at script evaluation, not
// when the trial plays.
// What a trial shows when its dialogue stage cannot be built at all.
//
// Nothing should reach this: the preload trial checks the archive against
// NEEDED_AUDIO, which is the one thing known to make the mount throw. It is here
// because of what the alternative looks like. A throw inside mount-stage stops
// the trial's remaining commands, so the stage, the slider and the continue
// button are never printed and the participant is left looking at a context
// sentence on a page that will never change again -- no error, no message, no
// way forward, and no results, because the session never reaches SendResults.
// Seen once in a pilot run on 2026-09-08, and reproduced exactly by throwing
// from mount-stage on purpose.
//
// The trial still cannot continue -- there is nothing to rate, and printing the
// slider anyway would collect a judgment on a recording nobody heard, which is
// worse than losing the session. What this changes is that the dead end says so,
// and names the one action that can help.
//
// In words, and deliberately not as a button -- the same reason `goodbye` does
// not offer a "Chiudi" button. A reload button here is a control in the middle of
// a page that has stopped, and the autopilot presses every control it finds: it
// reloaded into the same failure eighteen times in ten minutes, which turned a
// clean "stalled, nothing posted" into a timeout and hid what had happened.
// Measured; that is how this paragraph got written.
function stageFailureNotice(container, err) {
    if (!container) return;
    container.classList.remove("exp2-stage");
    while (container.firstChild) container.removeChild(container.firstChild);
    const p = document.createElement("p");
    p.className = "exp2-stage-failed";
    p.textContent = "Si è verificato un problema nel caricamento di questo " +
        "dialogo, e l'esperimento non può continuare. Prova a ricaricare la " +
        "pagina; se il problema si ripresenta, scrivi a chi ti ha inviato il " +
        "link.";
    container.appendChild(p);
    // Named so a browser console still carries the cause for whoever is asked.
    try { console.error("exp2: stage mount failed", err); } catch (e) { /* ignore */ }
}

function clearResponseVars() { return [
    getVar("ratingVar").set("NA"),
    getVar("touchedVar").set("NA"),
    getVar("movesVar").set("NA"),
    getVar("replayedVar").set("NA"),
    getVar("playPressVar").set("NA"),
    getVar("firstTouchVar").set("NA"),
    getVar("lastTouchVar").set("NA"),
    getVar("submitVar").set("NA"),
    getVar("audioPlayedVar").set("NA"),
    getVar("blurCountVar").set("NA"),
    getVar("blurredVar").set("NA"),
    getVar("stallsVar").set("NA"),
    getVar("trialIndexVar").set("NA"),
    getVar("trainingWarnedVar").set("NA")
]; }

// Presentation order, logged rather than derived.
//
// It used to be recovered in analysis/read_exp2.R by sorting each
// participant's rows on EventTime. That works, but it makes the order a
// property of how the rows happened to be written rather than something the
// experiment stated, and it is unrecoverable from a file whose rows have been
// sorted by anything else. Counting here costs one integer.
//
// Judgment trials only: the break screens and the training trial are not
// positions in the running order a participant rated anything at.
let judgmentIndex = 0;

Template(
    GetTable(ITEMS_TABLE)
        .setGroupColumn("group")
        .filter(row => rowInSplit(row, SPLIT)),
    row => {
        // Fails loudly at load time if the table ever carries a value outside
        // the design (a typo'd condition string, say), instead of quietly
        // flowing a bad row into the results.
        EXP2_DESIGN.validateRow(row);

        // Declaring the Audio element (never printed or played through it)
        // is enough to get PCIbex's own preloader to fetch this URL ahead of
        // the trial; the dialogue stage's own <audio> (exp2_dialogue.js)
        // requests the identical URL and hits the browser cache instead of
        // the network. See the header comment and CLAUDE.md fact #4.
        // See the training trial: local runs only. The archive is the deployed
        // preload, and it has already finished by the time any trial runs.
        // What this trial actually plays and shows. Identical to the row on an
        // ordinary run, and on a `?cont=off` run identical for the wh fillers
        // too -- `audio_nocont` IS `audio` when there is no continuation to
        // leave off, so the fillers need no special case here.
        //
        // `cutEnd` is the whole turn, not a truncation of a longer file: on an
        // `off` run it is the companion recording's own duration, so the stage
        // is again being told where its audio ends rather than where to stop it
        // early. `truncatesRecording()` in exp2_dialogue.js therefore answers no
        // on every row of every run, which is the point.
        const cutting = CONTINUATIONS === "off";
        const cutAudio = needsAudio(cutting ? row.audio_nocont : row.audio);
        const cutEnd = Number(cutting ? row.total_ms_nocont : row.total_ms);
        const cutAnswer = cutting
            ? answerWithoutContinuation(row.answer, row.continuation)
            : row.answer;

        // Declaring the Audio element (never printed or played through it)
        // is enough to get PCIbex's own preloader to fetch this URL ahead of
        // the trial; the dialogue stage's own <audio> (exp2_dialogue.js)
        // requests the identical URL and hits the browser cache instead of
        // the network. See the header comment and CLAUDE.md fact #4.
        // See the training trial: local runs only. The archive is the deployed
        // preload, and it has already finished by the time any trial runs.
        // Preloads what will actually be played, which on an `off` run is the
        // companion -- preloading `row.audio` there would warm the cache for a
        // file this trial never requests.
        if (!AUDIO_ZIP) newAudio("stim", cutAudio);

        // Every _ms column below is a difference against this, read from the
        // one shared clock (Exp2Dialogue.now). Nothing here calls Date.now():
        // mixing the two is what made the old time_to_first_move unusable.
        let itemStart = 0;
        let sliderWatch = null;
        let focusWatch = null;

        return newTrial("judgment",
            startAtTop(),
            ...clearResponseVars(),
            newText("prompt", "Quanto è accettabile la risposta alla domanda?")
                .css("margin-bottom", "2em")
                .center()
                .print(),

            newText("context", row.context)
                .italic()
                .center()
                .css("text-align", "center")
                .cssContainer({ "text-align": "center" })
                .print(),
            newText("request", row.request)
                .css("margin-bottom", "1em")
                .italic()
                .center()
                .css("text-align", "center")
                .cssContainer({ "text-align": "center" })
                .print(),

            newFunction("mark-item-start", () => {
                itemStart = Exp2Dialogue.now();
                judgmentIndex += 1;
                // Started here rather than at mount: the participant can be
                // away before ever pressing play, and that absence belongs to
                // this trial.
                if (focusWatch) focusWatch.destroy();
                focusWatch = Exp2Dialogue.watchFocus();
            }).call(),

            // Mounted onto the Text element's own elementContainer (not a
            // nested div): the CSS gate in global_exp2.css is a sibling
            // combinator off this exact container's exp2-stage/exp2-done
            // classes. See exp2_dialogue.js's header comment and
            // reference/PCIBEX-CORE.md fact #1.
            newText("stage", "<div></div>").print(),

            newFunction("mount-stage", () => {
              const container = document.querySelector(".PennController-stage-container");
              try {
                // The stage's <audio> is a detached `new Audio()`, so PCIbex taking
                // the trial's DOM away does not stop it playing.
                if (window.__exp2CurrentDialogue) {
                    try { window.__exp2CurrentDialogue.destroy(); } catch (e) { /* ignore */ }
                    window.__exp2CurrentDialogue = null;
                }
                const dialogue = Exp2Dialogue.mount(container, {
                    question: row.question,
                    // On a `?cont=off` run this is the companion recording and
                    // the text that matches it. All three move together, or
                    // none of them: a shortened recording under the full text
                    // would show a clause nobody heard, and the full recording
                    // under shortened text would play one nobody could read.
                    answer: cutAnswer,
                    qStart: Number(row.q_start_ms),
                    qEnd: Number(row.q_end_ms),
                    aStart: Number(row.a_start_ms),
                    aEnd: cutEnd,
                    totalMs: cutEnd,
                    audioUrl: audioFor(cutAudio),
                    allowReplay: true,
                    playLabel: "Riproduci"
                });
                window.__exp2CurrentDialogue = dialogue;
                dialogue.run();
              } catch (e) {
                // See stageFailureNotice(): the trial stops either way, but it
                // stops visibly. Re-thrown so run.mjs's pageErrors still names
                // the cause -- a check must not go quiet because a participant
                // now gets a message.
                stageFailureNotice(container, e);
                throw e;
              }
            }).call(),

            // No .wait() here: .slider() renders a bare <input type="range">
            // whose `change` never fires if the participant wants the centre
            // value it is born at, so waiting on the scale itself would hang
            // the trial. Gating and reading happen through
            // Exp2Dialogue.watchSlider() and a plain DOM read instead --
            // see CLAUDE.md fact #3.
            newScale("rating", 101)
                .slider()
                .before(newText("lo", "(per nulla accettabile) "))
                .after(newText("hi", " (totalmente accettabile)"))
                .center()
                .print(),

            newFunction("wire-slider", () => {
                const input = document.querySelector(".PennController-rating-container input[type=range]");
                const stageContainer = document.querySelector(".PennController-stage-container");
                // onTouch rather than a listener of our own: what counts as
                // touching the slider is watchSlider's business, and a click
                // that lands on the centre value it is born at counts, so a
                // rating of 50 needs no detour through some other value.
                sliderWatch = Exp2Dialogue.watchSlider(input, {
                    onTouch: () => {
                        // Reveals the continue button (CSS gate: exp2-done AND
                        // exp2-answered).
                        //
                        // Nothing is scrolled here, deliberately. The button's
                        // box is already laid out with the slider, so touching
                        // the scale changes nothing about the page's shape and
                        // there is nothing to chase; a keepInView() call here
                        // just moved the page under a participant who had not
                        // asked it to move. If the button is below the fold,
                        // the scroll cue is what says so.
                        //
                        // No timestamp is taken here either: watchSlider keeps
                        // its own first/last readings, and a second copy kept
                        // in this closure is a second thing to get wrong.
                        stageContainer.classList.add("exp2-answered");
                    }
                });
            }).call(),

            newButton("continue", "Avanti")
                // Tight against the slider: on the rating trials the two are one
                // action, and 2em of air reads as a page break between them.
                // Note that most of the visible gap is NOT this margin -- the
                // slider's two anchor labels sit in row 2 of the scale's own
                // grid, i.e. between the slider and this button, so shrinking
                // this value alone moves the button barely at all.
                .settings.css("margin-top", "0.35em")
                .settings.css("margin-bottom", "2em")
                .settings.css("font-size", "1em")
                .center()
                .print(),

            getButton("continue").wait(),

            // Read the response out once the participant has committed it.
            //
            // These have to be `newVar(...).set(callback)` commands in the
            // trial's own sequence, NOT `getVar(...).set(...)` calls inside a
            // newFunction body: `.set()` builds a PennController command
            // object that the engine has to execute. Calling it from plain JS
            // constructs the command and drops it, so every one of these
            // columns logs `undefined` — with no error anywhere, because
            // nothing actually failed.
            getVar("ratingVar").set(() => {
                const input = document.querySelector(
                    ".PennController-rating-container input[type=range]");
                return input ? Number(input.value) : "NA";
            }),
            getVar("touchedVar").set(
                () => (sliderWatch && sliderWatch.isTouched() ? 1 : 0)),
            getVar("movesVar").set(
                () => (sliderWatch ? sliderWatch.moves() : "NA")),

            // The four points on the trial's own clock, in the order they
            // happen. `sinceStart` is the only arithmetic any of them needs,
            // which is the whole benefit of one clock: every reading below is
            // a number from Exp2Dialogue.now(), so the subtraction is always
            // meaningful and always in milliseconds.
            getVar("playPressVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                const at = d ? d.metrics().firstPressAt : null;
                return sinceStart(at, itemStart);
            }),
            getVar("firstTouchVar").set(
                () => sinceStart(sliderWatch && sliderWatch.firstTouchAt(), itemStart)),
            getVar("lastTouchVar").set(
                () => sinceStart(sliderWatch && sliderWatch.lastTouchAt(), itemStart)),
            getVar("submitVar").set(() => Math.round(Exp2Dialogue.now() - itemStart)),

            getVar("audioPlayedVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                const m = d ? d.metrics() : {};
                return m.audioMs != null ? m.audioMs : Number(row.total_ms);
            }),
            getVar("replayedVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                return d ? (d.metrics().replayed || 0) : 0;
            }),
            getVar("stallsVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                return d ? (d.metrics().abandoned || 0) : 0;
            }),
            getVar("blurCountVar").set(() => (focusWatch ? focusWatch.count() : "NA")),
            getVar("blurredVar").set(() => (focusWatch ? focusWatch.blurredMs() : "NA")),
            getVar("trialIndexVar").set(() => judgmentIndex),

            // Last, strictly after every getVar above has read metrics() off
            // it. A participant may press Avanti part-way through a replay,
            // and the stage's audio is a detached `new Audio()` PennController
            // knows nothing about -- without this it carries on talking over
            // the next trial.
            newFunction("teardown-stage", () => {
                const d = window.__exp2CurrentDialogue;
                if (d) { try { d.destroy(); } catch (e) { /* ignore */ } }
                window.__exp2CurrentDialogue = null;
                // Its listeners are on the window, which no trial boundary
                // clears; left running they would keep accruing this trial's
                // absence into the next one.
                if (focusWatch) { focusWatch.destroy(); focusWatch = null; }
                if (sliderWatch) { sliderWatch.destroy(); sliderWatch = null; }
            }).call()
        )
            // Order here is the order of the columns in the results file, and
            // it is grouped rather than historical: who and when, what they
            // were shown, what they did, how long each part took, who they
            // are. The set has to match design/design.toml exactly — in both
            // directions — or `npm run contracts` fails.
            //
            // Session and order
            .log("session_id", sessionID)
            // Prolific's own two, straight off the study link. See the
            // block at the top of this file: PROLIFIC_PID is the person,
            // prolific_submission is ONE submission, and neither is the
            // `session_id` above it, which this script generates itself.
            .log("prolific_pid", PROLIFIC_PID)
            .log("prolific_submission", PROLIFIC_SUBMISSION)
            .log("phase", PHASE)
            .log("split", SPLIT)
            .log("continuations", CONTINUATIONS)
            .log("group", row.group)
            .log("trial_index", getVar("trialIndexVar"))
            // Design and item
            .log("subexp", row.subexp)
            .log("condition", row.condition)
            .log("cond_question", row.cond_question)
            .log("cond_answer", row.cond_answer)
            .log("num", row.num)
            .log("kid", row.kid)
            .log("item_id", `${row.subexp}-${row.num}`)
            // The stimulus, logged in full on every row, so a results file can
            // be read years later without the item tables beside it — and so a
            // mismatch between the analysed condition label and the text that
            // carried it is visible rather than assumed.
            //
            // `item_answer` is the item's answer AS BUILT, not as truncated: on
            // a `continuations = off` row the participant heard `item_answer`
            // minus `item_continuation`, and those two columns beside this one
            // say so exactly. Logging the truncated string here instead would
            // make one column mean two different things depending on another,
            // and would cost verify.mjs the check that every logged sentence
            // still matches the item table.
            .log("item_context", row.context)
            .log("item_reward_condition", row.request)
            .log("item_question", row.question)
            .log("item_answer", row.answer)
            .log("item_continuation", row.continuation)
            // The recording actually played, which on a `continuations = off`
            // row is the companion assembled without the continuation. Not
            // `row.audio`: that names a file this trial never requested, and
            // "which recording did this participant hear" is the one question
            // this column exists to answer.
            .log("audio_file", cutAudio)
            // How long that recording is. On a `continuations = off` row it is
            // the companion's own length, which is shorter than `total_ms` by
            // the continuation plus the gap before it. The file's own length is
            // always recoverable from the item table; what a participant
            // actually sat through is not, unless it is written down here. It
            // is also the one thing in the results that can be checked exactly
            // against `total_ms_nocont`, which is how verify.mjs knows the
            // variant did anything at all.
            .log("recording_ms", cutEnd)
            // Response
            .log("rating", getVar("ratingVar"))
            .log("slider_touched", getVar("touchedVar"))
            .log("slider_moves", getVar("movesVar"))
            .log("replayed", getVar("replayedVar"))
            // Timing and attention, all milliseconds. The first four are
            // measured from the trial's onset; the rest are durations.
            .log("play_press_ms", getVar("playPressVar"))
            .log("first_touch_ms", getVar("firstTouchVar"))
            .log("last_touch_ms", getVar("lastTouchVar"))
            .log("submit_ms", getVar("submitVar"))
            .log("audio_played_ms", getVar("audioPlayedVar"))
            .log("blur_count", getVar("blurCountVar"))
            .log("blurred_ms", getVar("blurredVar"))
            .log("playback_stalls", getVar("stallsVar"))
            // Questionnaire
            .log("age", getVar("age"))
            .log("gender", getVar("gender"))
            .log("handed", getVar("handed"))
            .log("caff", getVar("caff"));
    }
);

// ------------------------------------------------------------
// Running order
// ------------------------------------------------------------
const randomizedJudgmentTrials = randomize("judgment");
// Interleave the blocks declared in BLOCK_PLAN with the break trials created
// alongside them: block, break, block, break, ..., block. `pick` shifts each
// block off the one randomized set, so the order is a single shuffle of the
// participant's whole list cut into pieces — not a shuffle per block, which
// would confine an item to the block it happened to land in.
const judgmentSequence = BLOCKS.flatMap((size, i) =>
    i === 0
        ? [pick(randomizedJudgmentTrials, size)]
        : [`judgment-break-${i}`, pick(randomizedJudgmentTrials, size)]
);

Sequence(
    "counter",
    "preload",
    "welcome",
    "consent",
    "meta",
    "instructions1",
    "training-intro",
    "training",
    "beginning",
    ...judgmentSequence,
    "send",
    "goodbye"
);

// ------------------------------------------------------------
// Send results
// ------------------------------------------------------------
// Strictly before the completion link below. Everything after this happens with
// the data already uploaded, so a participant who closes the window on the last
// screen has still been recorded -- and, on Prolific, a submission that reaches
// the completion URL has data by construction, which is what makes approving
// automatically safe. A completion link moved above this would send people to
// Prolific with their session still in the browser.
newTrial("send",
    startAtTop(),
    SendResults()
);

// ------------------------------------------------------------
// The last screen
// ------------------------------------------------------------
// Under Prolific this screen is not decoration: it is where a participant gets
// paid. A submission stays "In Progress" until they land on Prolific's
// completion URL; one who closes the tab here instead submits as NOCODE, which
// Prolific's researcher has to resolve by hand and which the participant has no
// way of knowing about.
//
// So this is the ONLY screen after `send`, and `send` is what puts the data up.
// There used to be three -- a thank-you, a payment form with a QR code, and a
// sign-off -- because the payment form was a second errand, on a second device
// as often as not. There is no errand now, and every screen between finishing
// and this link is somewhere to lose someone.
//
// Two ways to the same place, for the same reason the payment screen had two:
// the link, and the code in plain text. A participant whose click does not land
// -- a blocked pop-up, a link opened and lost, a tab restored without it -- can
// still type the code into Prolific's own "complete study" box. Both are built
// from COMPLETION_URL, so they cannot come apart; check_contracts.mjs holds
// exactly that.
//
// And no automatic redirect, deliberately. It would fire under
// `run.mjs --start-at goodbye` too, navigating a headless check onto Prolific's
// servers, which makes the one element on this path whose failure costs a
// participant their payment the one element no check could draw. PCIbex's own
// Prolific guide uses a link.
//
// It ends on an unprinted wait(), and it is allowed to: this is the last screen
// and there is nowhere to hand anyone on to. Everything above it has to hand
// on, and check_contracts.mjs asserts that only this one does not.
newTrial("goodbye",
    startAtTop(),
    newText("L'esperimento è terminato.")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
        .center()
        .print(),

    newText("Grazie per aver partecipato!")
        .css("font-size", "1.2em")
        .css("margin-top", "1em")
        .center()
        .print(),

    newText("goodbye-instruction",
        "Clicca sul link qui sotto per confermare la tua partecipazione su " +
        "Prolific. Senza questo passaggio la tua sessione resta aperta e il " +
        "compenso non ti viene accreditato.")
        .css("margin-top", "1.5em")
        .center()
        .print(),

    newText("goodbye-link",
        `<a href="${COMPLETION_URL}" rel="noopener">${COMPLETION_URL}</a>`)
        .css("font-size", "1.2em")
        .css("margin-top", "1.5em")
        .center()
        .print(),

    // "Altrimenti", not "se il link non funziona": typing the code into
    // Prolific's own box is a way of completing the study, not the repair of a
    // broken one, and a fallback offered as a fault reads like one.
    newText("goodbye-fallback",
        "Altrimenti, torna su Prolific e inserisci questo codice:")
        .css("margin-top", "1.5em")
        .css("font-size", "0.95em")
        .center()
        .print(),

    // The tail of the URL, read off the constant rather than written out again.
    newText("goodbye-code", COMPLETION_URL.split("cc=")[1])
        .css("font-size", "2em")
        .css("font-weight", "bold")
        .css("letter-spacing", "0.12em")
        .center()
        .print(),

    newButton("stay").wait()   // never clicked: the experiment ends here
);
