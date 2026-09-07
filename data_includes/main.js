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
// Payment
// ------------------------------------------------------------
// The form a participant fills in after the last screen, to be paid. It asks
// for the code below plus a PayPal address or a Satispay number, and it is
// deliberately OUTSIDE this experiment: payment details are personal data and
// must never reach the results file. Stated here once -- the QR code beside
// the link is drawn from this line by pcibex/tools/make_payment_qr.py, so the
// picture and the link cannot disagree.
const PAYMENT_FORM_URL = "https://forms.gle/BkrUavGzUqxtRwt7A";

// What the participant types into that form, and the only thing tying a
// payment request to a session. The last 8 digits of sessionID: the 6 random
// ones plus the last 2 of the timestamp.
//
// Eight rather than Exp1's six, for one reason. The code is what tells two
// claims apart, so a collision between two sessions is not a curiosity but an
// unresolvable case -- two people holding the same code, one payment owed, and
// no way to tell that from one person claiming twice. Six random digits
// collide with probability about n^2/2e6: ~2% over 200 sessions. Borrowing two
// digits of the millisecond timestamp, which are as good as uniform across
// participants, takes that to ~0.02% and costs one keystroke.
//
// Not logged as its own column: it is a function of session_id, which every
// row already carries, and a second copy of a derived value is a thing that
// can disagree with itself. analysis/read_exp2.R re-derives it with the same
// constant, and `npm run contracts` fails if the two numbers drift apart.
const PAYMENT_CODE_DIGITS = 8;
const paymentCode = sessionID.slice(-PAYMENT_CODE_DIGITS);

// ------------------------------------------------------------
// Phase / split / speed
// ------------------------------------------------------------
// EXP2_PHASE comes from the generated js_includes/exp2_phase.js, loaded
// before this file. "pretest" or "test".
const PHASE = window.EXP2_PHASE;

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

// ?cont=off -> the answers stop where their continuation clause would begin.
//
// A pilot variant, to hear what the pretest is like without the continuations
// before deciding whether to keep them. Nothing is re-recorded for it: the
// continuation is its own piece in the assembled audio, so `c_start_ms` is
// where it starts, and stopping the turn there is the whole mechanism. The
// displayed answer is cut to match, so nobody reads a clause they do not hear.
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
// Screening and eligibility check (kept verbatim from GP_Exp1_paid)
// ------------------------------------------------------------
newTrial("screening",
    startAtTop(),
    newText("disclaimer",
        "Prima di iniziare, vorremmo verificare che tu possa partecipare allo studio. " +
        "Se non risulti idonea/o, le tue risposte verranno eliminate. " +
        "Se risulti idonea/o, le risposte verranno conservate in modo sicuro e protetto. " +
        "Solo il personale della ricerca potrà accedervi. " +
        "Se sei idonea/o, potrai poi dare il tuo consenso informato alla partecipazione allo studio."
    )
        .css("margin-bottom", "1em")
        .print()
    ,
    newText("lang-desc", "Qual è la tua lingua madre?")
        .cssContainer({ "margin-bottom": "0.5em", "margin-top": "2em" })
        .center()
        .print()
    ,
    newScale("lang_val", "italiano", "altro")
        .labelsPosition("bottom")
        .settings.css("gap", "2em")
        .center()
        .print()
        .wait()
        .log()
    ,
    keepUpWithForm(),
    newText("age-desc", "Quanti anni hai? (Premi 'invio' per continuare.)")
        .cssContainer({ "margin-bottom": "0.5em", "margin-top": "2em" })
        .center()
        .print()
    ,
    newTextInput("age_val")
        .cssContainer({ "margin-bottom": "0.5em" })
        .center()
        .print()
        .wait()
    ,
    keepUpWithForm(),
    newVar("lang").global().set(getScale("lang_val")),
    newVar("age").global().set(getTextInput("age_val"))
    ,
    newButton("continue", "Verifica l'idoneità")
        .settings.css("margin-top", "2em")
        .settings.css("margin-bottom", "2em")
        .settings.css("font-size", "1em")
        .center()
        .print()
        .wait()
);

newTrial("eligibility-check",
    startAtTop(),
    getVar("age").test.is(v => Number(v) >= 18)
        .and(getVar("lang").test.is("italiano"))
        .failure(
            newText("Purtroppo non sei idonea/o a partecipare a questo studio. " +
                "Grazie per il tuo tempo.")
                .center()
                .print()
            ,
            newText("Puoi chiudere questa finestra.")
                .css("margin-bottom", "1em")
                .css("margin-top", "1em")
                .center()
                .print()
                .wait()
        )
);

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
    // Fills the exp2-duration span(s) the form just printed from their
    // data-<phase>-<whole|split> attribute -- one line per link variant,
    // all of them in one file. See exp2_dialogue.js.
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
// Demographic questionnaire (kept verbatim from GP_Exp1_paid)
// ------------------------------------------------------------
newTrial("meta",
    startAtTop(),
    defaultText
        .cssContainer({ "margin-bottom": "0.5em", "margin-top": "2em" })
        .center()
        .print()
    ,
    newText("instructions-1", "Per favore, inserisci tutti i dati richiesti qui sotto.")
    ,
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
    keepUpWithForm(),
    newText("study-desc", "Se sei una/o studente, qual è la tua area di studio? (Premi 'invio' per continuare)")
    ,
    newTextInput("study_val")
        .center()
        .print()
        .wait()
    ,
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
    newVar("study")
        .global()
        .set(getTextInput("study_val"))
    ,
    newVar("caff")
        .global()
        .set(getScale("caff_val"))
    ,
    newButton("continue", "Avanti")
        .settings.css("margin-top", "2em")
        .settings.css("margin-bottom", "2em")
        .settings.css("font-size", "1em")
        .center()
        .print()
        .wait()
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
        // Exp1's framing, kept word for word apart from the two sentences that
        // have to change because Exp2 is heard rather than read.
        "In questo contesto, due spiritelli danno delle ricompense ai bambini a seconda di quello che fanno. " +
        "Una volta stabilito come assegnare la ricompensa, gli spiritelli si fanno una domanda su cosa sia successo. " +
        "Nel corso dell'esperimento, li sentirai dialogare " +
        "e rispondere alle domande l'uno dell'altro. " +
        "Tuttavia, le risposte che si danno sono talvolta incoerenti, oppure non sembrano rispondere veramente alla domanda fatta. " +
        "<b>Il tuo compito sarà quello di penalizzare le risposte che non ti suonano accettabili rispetto alla domanda.</b> " +
        "Per farlo, userai un cursore che potrai muovere liberamente tra \"per nulla accettabile\" (estremo sinistro) e \"totalmente accettabile\" (estremo destro)."
    ),

    newText("logic",
        "Nota bene: il tuo compito è di valutare le risposte in relazione alle domande, e non le domande in sé. " +
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
// it that matters here -- four of the eight training items turn on PROSODY,
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

newTrial("training-intro",
    startAtTop(),
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
// Training: the 8 items in chunk_includes/training_items.csv, in table order.
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
//   * The table is phase-independent — the same 8 rows are written into both
//     phases' chunk_includes by prepare_stimuli.py — so it is NOT filtered by
//     split and carries no `group`: every participant does all 8, in order.
//   * Order is the table's, not randomized. The items build on each other
//     (ignorance, then two prosody contrasts, then marked questions), and
//     `num` in data/training_items.tsv is what sets it.
// ------------------------------------------------------------
const TRAINING_TABLE = "training_items" + ".csv";

// Position within the training block, logged as `trial_index` the way the
// judgment trials log theirs. Its own counter: the two never interleave, and
// sharing one would make a judgment trial's index depend on how the training
// went.
let trainingIndex = 0;

Template(
    GetTable(TRAINING_TABLE),
    row => {
        // Only for a LOCAL run, where the file sits beside the page. Deployed,
        // the recording is already in memory from the archive, and pointing a
        // PennController resource at a bare filename would make it fetch from
        // the farm, which does not have it.
        if (!AUDIO_ZIP) newAudio("training-stim", row.audio);

        // Same three pieces of per-trial state the judgment trial keeps, for
        // the same reason: one clock origin, and two watchers whose listeners
        // outlive the trial unless they are torn down.
        let itemStart = 0;
        let sliderWatch = null;
        let focusWatch = null;

        return newTrial("training",
            startAtTop(),
            // Order on screen: intro, context, request, dialogue — and then,
            // only once the recording has played through, the prompt, the
            // comment on the item and the slider.
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
                if (window.__exp2CurrentDialogue) {
                    try { window.__exp2CurrentDialogue.destroy(); } catch (e) { /* ignore */ }
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
            }).call(),

            // Printed after the stage, so both are revealed with the slider.
            newText("prompt", "Quanto è accettabile la risposta alla domanda?")
                .css("margin-bottom", "2em")
                .center()
                .print(),

            // Above the slider, not below it: it ends by saying which way to
            // move the cursor, which is no use underneath the cursor.
            newText("training-feedback", row.feedback)
                .css("margin-bottom", "2em")
                .css("padding", "0.75em 1em")
                .css("border-left", "3px solid var(--exp2-line-strong)")
                .css("text-align", "left")
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

            newButton("continue", "Avanti")
                // Tight against the slider: on the rating trials the two are one
                // action, and 2em of air reads as a page break between them.
                .settings.css("margin-top", "0.35em")
                .settings.css("margin-bottom", "2em")
                .settings.css("font-size", "1em")
                .center()
                .print(),

            getButton("continue").wait(),

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
            .log("phase", PHASE)
            .log("split", SPLIT)
            .log("continuations", CONTINUATIONS)
            .log("trial_index", getVar("trialIndexVar"))
            .log("training_item", `${row.num}-${row.topic}-${row.label}`)
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
        if (!AUDIO_ZIP) newAudio("stim", row.audio);

        // What this trial actually plays and shows. Identical to the row on an
        // ordinary run, and on a `?cont=off` run identical for the wh fillers
        // too -- `c_start_ms` is `total_ms` when there is no continuation to
        // cut, so the fillers need no special case here.
        const cutting = CONTINUATIONS === "off";
        const cutEnd = cutting ? Number(row.c_start_ms) : Number(row.total_ms);
        const cutAnswer = cutting
            ? answerWithoutContinuation(row.answer, row.continuation)
            : row.answer;

        // Every _ms column below is a difference against this, read from the
        // one shared clock (Exp2Dialogue.now). Nothing here calls Date.now():
        // mixing the two is what made the old time_to_first_move unusable.
        let itemStart = 0;
        let sliderWatch = null;
        let focusWatch = null;

        return newTrial("judgment",
            startAtTop(),
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
                // The stage's <audio> is a detached `new Audio()`, so PCIbex taking
                // the trial's DOM away does not stop it playing.
                if (window.__exp2CurrentDialogue) {
                    try { window.__exp2CurrentDialogue.destroy(); } catch (e) { /* ignore */ }
                    window.__exp2CurrentDialogue = null;
                }
                const dialogue = Exp2Dialogue.mount(container, {
                    question: row.question,
                    // On a `?cont=off` run the turn ends where the continuation
                    // piece begins, and the displayed text ends with it. Both,
                    // or neither: a shortened recording under the full text
                    // would show a clause nobody heard, and the full recording
                    // under shortened text would play one nobody could read.
                    answer: cutAnswer,
                    qStart: Number(row.q_start_ms),
                    qEnd: Number(row.q_end_ms),
                    aStart: Number(row.a_start_ms),
                    aEnd: cutEnd,
                    totalMs: cutEnd,
                    audioUrl: audioFor(row.audio),
                    allowReplay: true,
                    playLabel: "Riproduci"
                });
                window.__exp2CurrentDialogue = dialogue;
                dialogue.run();
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
            .log("audio_file", row.audio)
            // How long the stimulus was AS PRESENTED, not how long the mp3 is:
            // on a `continuations = off` row the turn stopped at `c_start_ms`
            // and that is what this says. The two differ only there, and the
            // file's own length is always recoverable from the item table --
            // whereas what a participant actually sat through is not, if this
            // column reports the file instead. It is also the one thing in the
            // results that can be checked exactly against `c_start_ms`, which
            // is how verify.mjs knows the variant did anything at all.
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
            .log("lang", getVar("lang"))
            .log("caff", getVar("caff"))
            .log("study", getVar("study"));
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
    "screening",
    "eligibility-check",
    "consent",
    "meta",
    "instructions1",
    "training-intro",
    "training",
    "beginning",
    ...judgmentSequence,
    "send",
    "end",
    "payment",
    "goodbye"
);

// ------------------------------------------------------------
// Send results and closing screen
// ------------------------------------------------------------
newTrial("send",
    startAtTop(),
    SendResults()
);

// `end` comes after SendResults(), so everything below it happens with the
// data already uploaded: a participant who closes the window on the payment
// screen has still been recorded, and is still owed the money.
newTrial("end",
    startAtTop(),
    newText("L'esperimento è terminato.")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
        .center()
        .print(),

    newText("Ora puoi procedere a richiedere il compenso.")
        .css("font-size", "1.2em")
        .css("margin-top", "1em")
        .center()
        .print(),

    newButton("pay", "Richiedi il compenso")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// Payment instructions (IRB version)
// ------------------------------------------------------------
// The consent form promises this screen by name -- "un modulo a parte dopo la
// schermata 'Fine dell'esperimento'" -- so it is not optional decoration.
//
// The link and the QR code are two ways to the same URL, because the form is
// filled in on a phone as often as in the tab the experiment is running in,
// and the last thing a finished participant should have to do is retype a
// shortened URL. The QR is generated FROM the constant beside that link (see
// make_payment_qr.py), not drawn by hand, so the two cannot come apart.
//
// The code below is the whole of the audit trail: the form asks for it, the
// results carry the session_id it is the tail of, and matching them is what
// says a claim belongs to a session that actually finished. Displayed large
// and on its own line because it is typed into another window, often on
// another device.
newTrial("payment",
    startAtTop(),
    defaultText
        .cssContainer({ "margin-top": "1em", "margin-bottom": "1em" })
        .center()
        .print()
    ,
    newText("payment-1",
        "Affinché tu possa ricevere il compenso per quest'esperimento, dobbiamo raccogliere delle informazioni con un modulo a parte. " +
        "Clicca sul link o inquadra il codice QR qui sotto per compilare il modulo per il compenso. Il link aprirà una nuova finestra.")
    ,
    newText("payment-2", `<a href="${PAYMENT_FORM_URL}" target="_blank" rel="noopener">${PAYMENT_FORM_URL}</a>`)
        .css("font-size", "1.3em")
    ,
    newImage("payment-qr", "payment_qr.png")
        .size(200, 200)
        .center()
        .print()
    ,
    newText("payment-3",
        "Per favore, inserisci il seguente codice quando richiesto dal modulo per il pagamento:")
    ,
    newText("payment-code", paymentCode)
        .css("font-size", "2em")
        .css("font-weight", "bold")
        .css("letter-spacing", "0.12em")
    ,
    newText("payment-4",
        "Il codice serve solo a verificare che tu abbia completato l'esperimento, e non è collegato alle tue risposte.")
        .css("font-size", "0.9em")
    ,
    // The participant's own signal that they are finished with the form. The
    // screen used to end on an unprinted, never-clicked wait(), which left the
    // last thing they saw indistinguishable from a page that had stalled --
    // with a code on it they had just been asked to copy elsewhere, so "is it
    // safe to leave now?" was a real question with no answer on screen.
    //
    // Nothing depends on it being pressed: the results went up at `send`, three
    // trials ago. It buys the acknowledgement on "goodbye" and nothing else,
    // which is why it can sit after a link that opens another tab.
    newButton("done", "Fatto")
        .css("margin-top", "1.5em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// The last screen
// ------------------------------------------------------------
// Deliberately a sentence and not a "Chiudi" button. `window.close()` is only
// honoured for a window script opened itself; in the ordinary case -- a tab the
// participant opened from a recruitment link -- it is ignored with nothing
// visible happening, so the button would read as broken exactly where the
// experiment is trying to say that everything worked.
newTrial("goodbye",
    startAtTop(),
    newText("Grazie per aver partecipato!")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
        .center()
        .print(),

    newText("Ora puoi chiudere questa finestra.")
        .css("font-size", "1.2em")
        .css("margin-top", "1em")
        .center()
        .print(),

    newButton("stay").wait()   // never clicked: the experiment ends here
);
