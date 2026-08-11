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

// Keeps only the rows a participant on this split should see:
//   whole -> everything (both critical sub-experiments + all 24 wh fillers)
//   sm    -> the 24 sm critical rows + the first half (num 1-12) of the fillers
//   or    -> the 24 or critical rows + the second half (num 13-24) of the fillers
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
    newImage("leftEv", "leftEv.png"),
    newImage("rightEv", "rightEv.png"),
    newTimer("preload-wait", 500).start().wait()
).setOption("countsForProgressBar", false);

// ------------------------------------------------------------
// Welcome screen
// ------------------------------------------------------------
newTrial("welcome",
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
    newHtml("consent_form", "consent_v2.html")
        .cssContainer({ "width": "500px", "fontsize": "1em" })
        .checkboxWarning("È necessario dare il proprio consenso prima di procedere.")
        .print()
    ,
    // Fills the exp2-duration span(s) the form just printed from their
    // data-whole / data-split attribute -- one line to keep both link
    // variants' stated study length in sync. See exp2_dialogue.js.
    newFunction("fill-duration", () => {
        Exp2Dialogue.fillDuration(SPLIT !== "whole");
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
    newText("study-desc", "Se sei una/o studente, qual è la tua area di studio? (Premi 'invio' per continuare)")
    ,
    newTextInput("study_val")
        .center()
        .print()
        .wait()
    ,
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
        "Nota bene: il tuo compito è di valutare le risposte in relazione alle domande, ma non le domande in sé. " +
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
// Instructions block 2 (good vs. bad examples -- adapted for listening)
// ------------------------------------------------------------
newTrial("instructions2",
    newText("example", "Per fare un esempio, immagina il seguente contesto:")
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("context", "Sul tavolo c'erano un bicchiere blu, uno giallo e uno verde.")
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),
    newText("request",
        "Eva, che aveva intenzione di rompere il bicchiere blu o il bicchiere giallo, " +
        "riceverà una ricompensa se ha rotto quello blu."
    )
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),

    newText("good-ans",
        "Se ascolti un dialogo come quello qui sotto, " +
        "la risposta dovrebbe suonarti perfettamente accettabile, " +
        "anche se vuol dire che Eva non riceverà la ricompensa. " +
        "Puoi tranquillamente dare una valutazione vicina all'estremo \"totalmente accettabile\"."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("good-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto il bicchiere blu, oppure no?</div>" +
        "<div style='font-weight: bold;'>No, ha rotto il bicchiere giallo.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
        .center()
        .print(),

    newText("bad-ans",
        "La stessa risposta a una domanda diversa, come qui sotto, " +
        "dovrebbe invece suonarti non accettabile, perché sembra incoerente. " +
        "Puoi per esempio valutarla vicino all'estremo \"per nulla accettabile\"."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("request",
        "Eva riceverà una ricompensa se ha rotto il bicchiere giallo."
    )
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),

    newText("bad-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto il bicchiere giallo, oppure no?</div>" +
        "<div style='font-weight: bold;'>No, ha rotto il bicchiere giallo.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
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
// Instructions block 3 (additional info examples -- adapted for listening)
// ------------------------------------------------------------
newTrial("instructions3",
    newText("example", "Facciamo un altro esempio con lo stesso contesto.")
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("context", "Sul tavolo c'erano un bicchiere blu, uno giallo e uno verde.")
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),
    newText("request",
        "Eva, che aveva intenzione di rompere il bicchiere blu o il bicchiere giallo, " +
        "riceverà una ricompensa se ha rotto quello blu."
    )
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),

    newText("good-ans",
        "Se ascolti uno scambio come quello qui sotto, " +
        "la risposta dovrebbe suonarti perfettamente accettabile, " +
        "perché il secondo spiritello risponde con delle informazioni aggiuntive. " +
        "Puoi tranquillamente dare una valutazione vicina all'estremo \"totalmente accettabile\"."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("good-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto il bicchiere blu, oppure no?</div>" +
        "<div style='font-weight: bold;'>Ha rotto il bicchiere blu, e non quello giallo.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
        .center()
        .print(),

    newText("bad-ans",
        "Se invece lo scambio comincia con la domanda qui sotto, " +
        "la risposta non dovrebbe suonarti accettabile, perché sembra rispondere a una domanda diversa. " +
        "Puoi per esempio valutarla vicino all'estremo \"per nulla accettabile\"."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("bad-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto il bicchiere blu, oppure no?</div>" +
        "<div style='font-weight: bold;'>Ha rotto il bicchiere giallo, e non quello verde.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
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
// Instructions block 4 (uncertainty example -- adapted for listening)
// ------------------------------------------------------------
newTrial("instructions4",
    newText("example",
        "Un ultimo esempio. Immagina un contesto simile al precedente:"
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("context", "Sul tavolo c'erano un bicchiere blu, uno giallo e uno verde.")
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),
    newText("request",
        "Eva, che aveva intenzione di rompere dei bicchieri, " +
        "riceverà una ricompensa se ha rotto sia il bicchiere blu che il bicchiere giallo."
    )
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),

    newText("good-ans",
        "Se ascolti uno scambio come quello qui sotto, " +
        "la risposta dovrebbe suonarti accettabile " +
        "anche se il secondo spiritello non sa dare una risposta sicura. " +
        "Puoi di nuovo dare una valutazione nella porzione superiore della scala."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("good-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto sia il bicchiere blu che quello giallo, oppure no?</div>" +
        "<div style='font-weight: bold;'>Ha rotto il bicchiere blu, ma non ricordo se abbia rotto anche quello giallo.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
        .center()
        .print(),

    newText("bad-ans",
        "Se invece lo scambio si svolge come qui sotto, " +
        "la risposta non dovrebbe suonarti accettabile, perché sembra incoerente."
    )
        .css("margin-bottom", "1em")
        .css("margin-top", "1em")
        .print(),

    newText("bad-layout",
        "<div style='display: flex; justify-content: center; align-items: center;'>" +
        "<img src='leftEv.png' style='height:100px; margin-right: 2em;'>" +
        "<div style='text-align: center;'>" +
        "<div style='margin-bottom: 1em;'>Ma quindi Eva ha rotto sia il bicchiere blu che quello giallo, oppure no?</div>" +
        "<div style='font-weight: bold;'>Ha rotto sia il bicchiere blu che il bicchiere giallo, ma non ricordo se abbia rotto quello giallo.</div>" +
        "</div>" +
        "<img src='rightEv.png' style='height:100px; margin-left: 2em;'>" +
        "</div>"
    )
        .css("margin-bottom", "1em")
        .center()
        .print(),

    newButton("continue", "Ho capito")
        .css("margin-top", "2em")
        .css("margin-bottom", "2em")
        .css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// Training (placeholder): one hardcoded item, walked through the same
// dialogue + slider + continue machinery as a real judgment trial, so the
// shape is exercised end to end.
//
// TODO: this is a provisional stand-in for a proper training block (several
// items spanning the range of naturalness, maybe feedback on the "expected"
// answer). Replace before running real participants. The hardcoded item
// below (a "wh" filler, num 17) is one whose audio and text are identical in
// both pcibex/pretest and pcibex/test's item tables, so
// this trial works unmodified regardless of phase.
//
// This trial deliberately does not .log() condition/subexp/num/etc: it must
// stay invisible to pcibex/tools/verify.mjs's trial counting (which keys off a
// populated `condition` column), since it is not one of the participant's
// counted judgment trials.
// ------------------------------------------------------------
const TRAINING_ITEM = {
    context: "Sull'attaccapanni c'erano un foulard a pois, uno a righe, uno a quadri e uno a tinta unita.",
    request: "Luna, che aveva intenzione di rovinare pochi foulard, riceverà una ricompensa se ha rovinato quello a tinta unita.",
    question: "Ma quindi Luna quali foulard non ha rovinato?",
    answer: "Ha rovinato quello a righe.",
    audio: "wh-neg-pos-17.mp3",
    q_start_ms: 0, q_end_ms: 2565, a_start_ms: 3315, a_end_ms: 4935, total_ms: 4935
};
newAudio("training-stim", TRAINING_ITEM.audio);

newTrial("training",
    newText("training-notice",
        "<b>Nota:</b> questa è una prova d'allenamento provvisoria (un solo esempio, da completare in seguito con altri casi). " +
        "Serve solo a farti provare come funziona lo scambio audio e la scala qui sotto."
    )
        .css("margin-bottom", "2em")
        .css("padding", "0.75em 1em")
        .css("border", "1px dashed var(--exp2-line-strong)")
        .css("border-radius", "12px")
        .center()
        .print(),

    newText("prompt", "Quanto è accettabile la risposta alla domanda?")
        .css("margin-bottom", "2em")
        .center()
        .print(),

    newText("context", TRAINING_ITEM.context)
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),
    newText("request", TRAINING_ITEM.request)
        .css("margin-bottom", "1em")
        .italic()
        .center()
        .css("text-align", "center")
        .cssContainer({ "text-align": "center" })
        .print(),

    newText("stage", "<div></div>").print(),

    newFunction("training-mount", () => {
        const container = document.querySelector(".PennController-stage-container");
        if (window.__exp2CurrentDialogue) {
            try { window.__exp2CurrentDialogue.destroy(); } catch (e) { /* ignore */ }
        }
        const dialogue = Exp2Dialogue.mount(container, {
            question: TRAINING_ITEM.question,
            answer: TRAINING_ITEM.answer,
            qStart: TRAINING_ITEM.q_start_ms,
            qEnd: TRAINING_ITEM.q_end_ms,
            aStart: TRAINING_ITEM.a_start_ms,
            aEnd: TRAINING_ITEM.a_end_ms,
            totalMs: TRAINING_ITEM.total_ms,
            audioUrl: TRAINING_ITEM.audio,
            allowReplay: true,
            playLabel: "Riproduci",
            replayLabel: "Riascolta"
        });
        window.__exp2CurrentDialogue = dialogue;
        dialogue.run();
    }).call(),

    newScale("rating", 101)
        .slider()
        .before(newText("lo", "(per nulla accettabile) "))
        .after(newText("hi", " (totalmente accettabile)"))
        .center()
        .print(),

    newFunction("training-wire-slider", () => {
        const input = document.querySelector(".PennController-rating-container input[type=range]");
        const stageContainer = document.querySelector(".PennController-stage-container");
        Exp2Dialogue.watchSlider(input);
        input.addEventListener("input", () => {
            stageContainer.classList.add("exp2-answered");
        });
    }).call(),

    newButton("continue", "Avanti")
        // Tight against the slider: on the rating trials the two are one
        // action, and 2em of air reads as a page break between them.
        .settings.css("margin-top", "0.35em")
        .settings.css("margin-bottom", "2em")
        .settings.css("font-size", "1em")
        .center()
        .print()
        .wait()
);

// ------------------------------------------------------------
// Optional splash screen before the items
// ------------------------------------------------------------
newTrial("beginning",
    newText("beginning", "Inizio dell'esperimento")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
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

const makeBreakTrial = (label, doneCount, totalCount) =>
    newTrial(label,
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

        newButton("break-continue", "Riprendi l'esperimento")
            .css("margin-top", "1.5em")
            .css("margin-bottom", "1.5em")
            .css("font-size", "1em")
            .center()
            .print()
            .wait()
    )
        .setOption("countsForProgressBar", false);

// Block sizes per the design: 3x24 for the whole list, 2x18 for a half split.
const TOTAL_TRIALS = SPLIT === "whole" ? 72 : 36;
if (SPLIT === "whole") {
    makeBreakTrial("judgment-break-1", 24, TOTAL_TRIALS);
    makeBreakTrial("judgment-break-2", 48, TOTAL_TRIALS);
} else {
    makeBreakTrial("judgment-break-1", 18, TOTAL_TRIALS);
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
newVar("firstMoveVar").global();
newVar("decisionVar").global();
newVar("submitVar").global();
newVar("audioMsVar").global();
newVar("replayedVar").global();

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
        newAudio("stim", row.audio);

        let itemStart = 0;
        let decisionMs = null;
        let sliderWatch = null;

        return newTrial("judgment",
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
                itemStart = Date.now();
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
                    answer: row.answer,
                    qStart: Number(row.q_start_ms),
                    qEnd: Number(row.q_end_ms),
                    aStart: Number(row.a_start_ms),
                    aEnd: Number(row.a_end_ms),
                    totalMs: Number(row.total_ms),
                    audioUrl: row.audio,
                    allowReplay: true,
                    playLabel: "Riproduci",
                    replayLabel: "Riascolta"
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
                sliderWatch = Exp2Dialogue.watchSlider(input);
                input.addEventListener("input", () => {
                    // Reveals the continue button (CSS gate: exp2-done AND
                    // exp2-answered) and marks the first genuine interaction.
                    stageContainer.classList.add("exp2-answered");
                    if (decisionMs === null) decisionMs = Date.now() - itemStart;
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
            getVar("firstMoveVar").set(
                () => (sliderWatch && sliderWatch.msSinceFirstTouch() != null
                    ? sliderWatch.msSinceFirstTouch() : "NA")),
            getVar("decisionVar").set(() => (decisionMs === null ? "NA" : decisionMs)),
            getVar("submitVar").set(() => Date.now() - itemStart),
            getVar("audioMsVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                const m = d ? d.metrics() : {};
                return m.audioMs != null ? m.audioMs : Number(row.total_ms);
            }),
            getVar("replayedVar").set(() => {
                const d = window.__exp2CurrentDialogue;
                return d ? (d.metrics().replayed || 0) : 0;
            }),

            // Last, strictly after every getVar above has read metrics() off
            // it. A participant may press Avanti part-way through a replay,
            // and the stage's audio is a detached `new Audio()` PennController
            // knows nothing about -- without this it carries on talking over
            // the next trial.
            newFunction("teardown-stage", () => {
                const d = window.__exp2CurrentDialogue;
                if (d) { try { d.destroy(); } catch (e) { /* ignore */ } }
                window.__exp2CurrentDialogue = null;
            }).call()
        )
            .log("session_id", sessionID)
            .log("phase", PHASE)
            .log("split", SPLIT)
            .log("session_group", row.group)
            .log("subexp", row.subexp)
            .log("condition", row.condition)
            .log("cond_question", row.cond_question)
            .log("cond_answer", row.cond_answer)
            .log("num", row.num)
            .log("kid", row.kid)
            .log("group", row.group)
            .log("rating", getVar("ratingVar"))
            .log("slider_touched", getVar("touchedVar"))
            .log("time_to_first_move", getVar("firstMoveVar"))
            .log("replayed", getVar("replayedVar"))
            .log("audio_ms", getVar("audioMsVar"))
            .log("decision_time_item", getVar("decisionVar"))
            .log("submit_time", getVar("submitVar"))
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
const judgmentSequence = SPLIT === "whole"
    ? [pick(randomizedJudgmentTrials, 24), "judgment-break-1",
    pick(randomizedJudgmentTrials, 24), "judgment-break-2",
    pick(randomizedJudgmentTrials, 24)]
    : [pick(randomizedJudgmentTrials, 18), "judgment-break-1",
    pick(randomizedJudgmentTrials, 18)];

Sequence(
    "counter",
    "preload",
    "welcome",
    "screening",
    "eligibility-check",
    "consent",
    "meta",
    "instructions1",
    "instructions2",
    "instructions3",
    "instructions4",
    "training",
    "beginning",
    ...judgmentSequence,
    "send",
    "end"
);

// ------------------------------------------------------------
// Send results and closing screen
// ------------------------------------------------------------
newTrial("send",
    SendResults()
);

newTrial("end",
    newText("L'esperimento è terminato. Grazie per aver partecipato!")
        .css("font-size", "1.6em")
        .css("font-weight", "bold")
        .center()
        .print(),

    newButton("wait").wait()   // never clicked: keeps the page up while results upload
);
