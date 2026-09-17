// 
// GRNA 2.0 - 2024
// 
// Javascript for the html page, contains UI logic
// Gets data from the grnaService & displays it
//

var outputTexts = {
    "textOutputFull": "",
    "textOutputNotFound": "",
    "textOutputAdapter": ""
}


// "Symbols not found" and "Run" sit at the foot of two
// columns whose content above them differs and reflows independently, so no
// fixed height lines them up at every window width: measured across nine
// widths the offset ran from -5px to +19px. The symbol box is the one
// flexible thing in its column, so its height is measured back from the two
// headings and corrected after layout.
const _SYMBOX_MIN = 180
const _SYMBOX_MAX = 460

function _alignSymbolColumn() {
    const box = document.getElementById("searchSymbols")
    if (!box) return
    // Below 900px the three columns stack, so there is nothing to line up.
    const spacer = document.getElementById("paramColSpacer")
    const clearSpacer = () => { if (spacer) spacer.style.height = "0px" }
    if (window.innerWidth <= 900) { box.style.height = ""; clearSpacer(); return }
    if (document.body.classList.contains("validate-mode")) return
    if (document.body.classList.contains("cn-mode")) return
    const titles = [...document.querySelectorAll(".smallTitle")]
    const notFound = titles.find(t => /Symbols not found/i.test(t.textContent))
    // Run, the last panel of the parameters column, against Symbols not
    // found, the last of the gene column: the two feet of the two columns.
    // The heading's text runs straight into its info dot ("Runi"), so this
    // cannot ask for a word boundary after it.
    const cellLine = titles.find(t => /^Run/i.test(t.textContent.trim()))
    if (!notFound || !cellLine) return
    // Both are visible only in design mode; a hidden element measures zero.
    if (!notFound.getClientRects().length || !cellLine.getClientRects().length) return
    // Growing the box does not move the heading below it by the same amount:
    // the panel it sits in distributes free space, so part of the change is
    // absorbed. One pass therefore lands short. Repeat until it settles, which
    // takes two or three passes, and stop either way so a layout that cannot
    // converge cannot spin.
    // The spacer is the second half of this and has to start from nothing, or
    // the pass would measure a gap it put there itself.
    clearSpacer()
    for (var pass = 0; pass < 5; pass++) {
        const delta = Math.round(cellLine.getBoundingClientRect().top - notFound.getBoundingClientRect().top)
        if (Math.abs(delta) < 2) return
        const current = box.getBoundingClientRect().height
        const next = Math.max(_SYMBOX_MIN, Math.min(_SYMBOX_MAX, Math.round(current + delta)))
        if (next === Math.round(current)) break         // clamped: pad instead
        box.style.height = next + "px"
    }
    // Clamped, and the feet still differ. That happens when the parameters
    // column is the short one — tightening the Controls panel took 120px out
    // of it, more than the gene box had left to give. Pad the parameters
    // column rather than shrink the box past readable.
    if (!spacer) return
    const left = Math.round(cellLine.getBoundingClientRect().top - notFound.getBoundingClientRect().top)
    if (left < -1) spacer.style.height = Math.min(240, -left) + "px"
}

// Anything that adds or removes a panel in the gene column changes its height,
// and the alignment is measured, not computed, so it has to be measured again.
// Debounced: several of these land together on one keystroke.
function APP_realign() {
    clearTimeout(window._symboxTimer)
    window._symboxTimer = setTimeout(_alignSymbolColumn, 60)
}

// Layout settles after fonts and images land, so realign on those too.
window.addEventListener("resize", APP_realign)
window.addEventListener("load", () => setTimeout(_alignSymbolColumn, 60))

// Everything else that changes a column's height: the library citation
// arriving, a control ticked, a curated list added, a status line growing to
// two lines. Rather than remember to call APP_realign from each of them —
// and miss one — watch the two columns and let any change ask for it.
// _alignSymbolColumn does nothing when the feet are already within 2px, so
// the pass it triggers by resizing the box itself stops after one round.
document.addEventListener("DOMContentLoaded", () => {
    if (typeof ResizeObserver !== "function") return
    const plates = [...document.querySelectorAll(".plate")]
    const watch = plates.filter(p => {
        const title = p.querySelector(".plateTitle")
        return title && /^(2\.|3\.)/.test(title.textContent.trim())
    })
    if (watch.length < 2) return
    const ro = new ResizeObserver(APP_realign)
    for (const p of watch) ro.observe(p)
})

// Put the cursor where the work starts. The library has a sensible default
// and the parameters are optional, so the gene box is the first thing anyone
// actually has to fill in.
function _focusSymbolBox() {
    const box = document.getElementById("searchSymbols")
    // Only when it is the box in play and empty: focusing it would otherwise
    // scroll a returning user away from whatever they were reading, and in
    // the takeover modes it is not the first thing to fill in either.
    if (!box || box.value.trim()) return
    if (document.body.classList.contains("validate-mode")) return
    if (document.body.classList.contains("cn-mode")) return
    try { box.focus({ preventScroll: true }) } catch (e) { box.focus() }
}

async function init() {
    var data = null
    try {
        data = await SER_getDefaultSettings()
    }
    catch (error) {
        throw new Error(`Failed to get default settings:\n ${error.message}`)
    }
    await insertData(data)
    // Warm the copy-number matrix in the background so the first click on a
    // CN feature doesn't wait on a 62 MB download. Deliberately not awaited.
    if (typeof CN_prefetchWhenIdle === "function") CN_prefetchWhenIdle()
    if (typeof LIBX_prefetchWhenIdle === "function") LIBX_prefetchWhenIdle()
    _focusSymbolBox()
    setTimeout(_alignSymbolColumn, 60)
}

async function loadTestSettings() {
    if (_validateState.isValidateMode && _validateState.activeSpecies) {
        const textarea = document.getElementById("searchSymbols")
        textarea.value = _testSequences[_validateState.activeSpecies]
        changeSymbols()
        return false
    }
    if (_cnState && _cnState.isMode) {
        // Common CN-varying cancer genes: classic focal amplifications
        // (MYC, ERBB2, CDK4, MDM2, EGFR, CCNE1, MET, CCND1, BCL2),
        // canonical tumour-suppressor deletions (CDKN2A, RB1, PTEN,
        // BRCA1/2, ATM, STK11), plus a couple of housekeeping diploid
        // controls (TP53 — almost always 2 copies but often mutated).
        const testGenes = [
            "MYC", "ERBB2", "CDK4", "MDM2", "EGFR", "CCNE1", "MET",
            "CCND1", "BCL2", "FGFR1", "KRAS",
            "CDKN2A", "RB1", "PTEN", "BRCA1", "BRCA2", "ATM", "STK11",
            "SMAD4", "APC", "NF1", "VHL", "TP53"
        ].join("\n")
        document.getElementById("searchSymbols").value = testGenes
        _setStatus("statusSearchSymbolsRows", "23 common CN-varying genes loaded")
        return false
    }

    var data = null
    try {
        data = await SER_getTestSettings()
    }
    catch (error) {
        throw new Error(`Failed to get default settings:\n ${error.message}`)
    }
    insertData(data)
    // Pre-fill the optional screening cell line with A-375 (a common
    // melanoma reference line) so the user can see what the integrated
    // copy-number output looks like without having to discover the
    // typeahead first.
    const cnInp = document.getElementById("screeningCellLineInput")
    if (cnInp) {
        cnInp.value = "A-375"
        CN_handleScreeningCellLineInput()
    }
    return false
}




async function insertData(data) {
    console.log(data)
    document.getElementById("trimBefore").min = 0
    document.getElementById("trimBefore").value = data.trimBefore

    document.getElementById("trimAfter").min = 0
    document.getElementById("trimAfter").value = data.trimAfter

    // .value, not .defaultValue: defaultValue only reaches the field while its
    // dirty flag is clear, so once the user has typed an adapter, loading test
    // data would silently leave their old sequence in place.
    document.getElementById("adapterBefore").value = data.adaptorBefore;
    document.getElementById("adapterAfter").value = data.adaptorAfter;

    document.getElementById("searchSymbols").value = data.searchSymbols.join("\n")
    document.getElementById("outputFileName").value = data.outputName
    document.getElementById("outputFileName").defaultValue = ""

    document.getElementById("partialMatches").checked = data.partialMatches
    document.getElementById("enableSynonyms").checked = data.enableSynonyms

    document.getElementById("includeSafeTargeting").checked = !!data.includeSafeTargeting
    document.getElementById("includeNonTargeting").checked = !!data.includeNonTargeting
    document.getElementById("includeEssential").checked = !!data.includeEssential
    // A settings load hands the count boxes back to the suggestion unless the
    // settings file names an explicit number.
    for (const [id, val] of [["safeTargetingCount", data.safeTargetingCount],
                             ["nonTargetingCount", data.nonTargetingCount],
                             ["essentialCount", data.essentialCount]]) {
        const el = document.getElementById(id)
        el.value = (val == null) ? "" : val
        el.dataset.auto = (el.value.trim() === "") ? "1" : "0"
    }
    SET_settingsSetControls({
        includeSafeTargeting: !!data.includeSafeTargeting,
        safeTargetingCount: document.getElementById("safeTargetingCount").value,
        includeNonTargeting: !!data.includeNonTargeting,
        nonTargetingCount: document.getElementById("nonTargetingCount").value,
        includeEssential: !!data.includeEssential,
        essentialCount: document.getElementById("essentialCount").value
    })

    const libraryNames = await SER_getLibraryNames()
    const librarydropdown = document.getElementById("libraries")
    const existingValues = Array.from(librarydropdown.options).map(option => option.value)
    const namesToAdd = libraryNames.filter(value => !existingValues.includes(value))

    namesToAdd.forEach(name => {

        var option = document.createElement('option')
        option.text = name
        option.value = name
        librarydropdown.appendChild(option)
    })

    librarydropdown.value = data.defaultLibrary ? data.defaultLibrary : libraryNames[0]

    const synonymNames = await SER_getSynonymNames()
    const synonymDropdown = document.getElementById("synonymSelect")
    synonymNames.forEach(name => {
        var option = document.createElement('option')
        option.text = name
        option.value = name
        synonymDropdown.appendChild(option)
    })
    synonymDropdown.value = data.defaultSynonyms ? data.defaultSynonyms : synonymNames[0]
    // store the settings in an object
    SET_settingsSetAll(data.searchSymbols, data.partialMatches, data.trimBefore, data.trimAfter, data.adaptorBefore, data.adaptorAfter, data.outputName, data.enableSynonyms, data.defaultSynonyms)

    //uppdates wich synonym list to use
    changeSynonyms()

    // load the library
    changeLibrary()

    // update example sequence
    _updateExampleText()

    // 30 KB, and every run wants it. Fetched here so the first run does not
    // wait for it.
    if (typeof ESS_loadIfNeeded === "function") ESS_loadIfNeeded()
}



var _testSequences = {
    human: "GAAGGTGCGTTCGATGACAG\nCCTGCACTCGGAGAAGAACG\nTGTGCCGCAAAAGGTCTTCA\nAAGATGAAGAATGCCCACAA\nGACTGGGAATAGTTACTCCC\nTTTGGATTACTTACTCAAGT",
    mouse: "GCAGCGTTACCTCTATCGTA\nCTCACCCAGTGACAACTCAG\nCGACGATGACCTCCTTCTTG\nGAACCTCTGTACTACAACGC\nGATGTACAACAACTGTGAAG\nGAACGACGTAGCCATTGTGA"

    // Human: AKT1(4 libs), AKT1(Brunello only), AKT1(GeCKO only), CD19(Brunello+Jacquere), PTEN(Jacquere+MinLibCas9), BRAF(MinLibCas9 only)
    // Mouse: Kras(4 libs), Akt1(Brie only), Akt1(GeCKO only), Braf(Julianna+VBC), Egfr(VBC+mTKO), Akt1(mTKO only)
}

// The instructions inside the empty input box. They are numbered steps for
// the mode the app is actually in: in validate mode the design-mode text
// ("Select a sgRNA library… gene symbols…") described a different job from
// the one the box was waiting for, and it is the only instruction on screen.
const _INPUT_PLACEHOLDERS = {
    design: "1.  Select a sgRNA library (e.g. Jacquere)\n" +
            "2.  Type or paste one or several gene symbols here\n" +
            "3.  Set parameters (optional) and press Run\n" +
            "4.  Collect the results at the foot of the page\n\n" +
            "(One gene symbol per line, or separated by\ncommas, semicolons, tabs or spaces)",
    validate: "1.  Paste the sgRNA spacer sequences here\n" +
              "2.  Press Run\n" +
              "3.  The results say which libraries each\n" +
              "     sequence is in, and which gene it targets\n\n" +
              "(20 nt spacers, A/C/G/T only, without the PAM\n" +
              "and without adapters. One per line, or separated\n" +
              "by commas, semicolons, tabs or spaces)",
    cn: "1.  Type or paste one or several gene symbols here\n" +
        "2.  Press Run\n" +
        "3.  The results give each gene's copy number in\n" +
        "     the cell lines you picked\n\n" +
        "(One gene symbol per line, or separated by\ncommas, semicolons, tabs or spaces)"
}

function _setInputPlaceholder(mode) {
    const box = document.getElementById("searchSymbols")
    if (box) box.placeholder = _INPUT_PLACEHOLDERS[mode] || _INPUT_PLACEHOLDERS.design
}

function toggleValidateMode(species) {
    const humanBtn = document.getElementById("validateHumanButton")
    const mouseBtn = document.getElementById("validateMouseButton")
    const symbolsTitle = document.getElementById("symbolsTitle")
    const inputPlateTitle = document.getElementById("inputPlateTitle")

    document.getElementById("outputTable").style.display = "none"
    document.getElementById("fileContentContainer").style.display = "none"

    // If clicking the already-active species, toggle OFF (back to design mode)
    if (_validateState.isValidateMode && _validateState.activeSpecies === species) {
        _validateState.isValidateMode = false
        _validateState.activeSpecies = null
        document.body.classList.remove("validate-mode")
        humanBtn.classList.remove("validate-btn-active")
        mouseBtn.classList.remove("validate-btn-active")
        _setSectionTitle("symbolsTitle", "Symbol matching")
        _setSectionTitle("inputPlateTitle", "2. Input symbols")
        _setInputPlaceholder("design")
        // Reload default settings to restore a clean design-mode state
        init()
        return
    }

    // Enter validate mode (or switch species)
    _validateState.isValidateMode = true
    _validateState.activeSpecies = species
    document.body.classList.add("validate-mode")

    humanBtn.classList.toggle("validate-btn-active", species === "human")
    mouseBtn.classList.toggle("validate-btn-active", species === "mouse")

    _setSectionTitle("symbolsTitle", "Enter sgRNA sequences")
    _setSectionTitle("inputPlateTitle", "2. Input sgRNA")
    _setInputPlaceholder("validate")
    document.getElementById("searchSymbols").value = ""
    _setStatus("statusSearchSymbolsRows", "")
}

async function runValidation() {
    _toggleLigtBox()

    var statusText = document.getElementById("statusSearch")
    statusText.classList.add("pulse")
    await new Promise(r => setTimeout(r, 100))

    const species = _validateState.activeSpecies
    try {
        const isLoaded = species === "human" ? _validateState.humanLoaded : _validateState.mouseLoaded
        if (!isLoaded) {
            _setStatus("statusSearch", `Loading ${species} validation index...`)
            await new Promise(r => setTimeout(r, 50))
            await VAL_loadIndex(species)
        }

        const rawInput = document.getElementById("searchSymbols").value
        const sequences = [...new Set(
            SYM_split(rawInput)
                .map(s => s.trim().toUpperCase())
                .filter(s => s.length > 0)
        )]

        // Validate: only ACGT characters
        const invalidSeqs = sequences.filter(s => !/^[ACGT]+$/.test(s))
        if (invalidSeqs.length > 0) {
            _setStatus("statusSearch", "Error: Sequences must contain only A, C, G, T characters")
            _toggleLigtBox()
            statusText.classList.remove("pulse")
            return
        }

        if (sequences.length === 0) {
            _setStatus("statusSearch", "Error: Please enter at least one sgRNA sequence")
            _toggleLigtBox()
            statusText.classList.remove("pulse")
            return
        }

        const results = VAL_search(sequences)
        _validateState.resultsOutput = VAL_createResultsOutput(results)
        _validateState.notFoundOutput = VAL_createNotFoundOutput(results)

        const outputName = document.getElementById("outputFileName").value || "validation"
        _createDownloadLinkRaw(_toCsv(_validateState.resultsOutput), outputName + " Validation Results", document.getElementById("validationDownload"), "text/csv;charset=utf-8", ".csv")
        _createDownloadLinkRaw(_toCsv(_validateState.notFoundOutput), outputName + " Not Found", document.getElementById("validationNotFoundDownload"), "text/csv;charset=utf-8", ".csv")

        _setStatus("statusSearch", `Validation complete: ${results.found.length} found, ${results.notFound.length} not found`)
    } catch (error) {
        console.error("Validation failed:", error)
        _setStatus("statusSearch", "Error: Failed to run validation")
    }

    _toggleLigtBox()
    statusText.classList.remove("pulse")
    document.getElementById("outputTable").style.display = "flex"
    document.getElementById("outputTable").classList.remove("statusFadeOut")
    document.getElementById("outputTable").classList.add("statusFadeIn")
}

// `rowExtra` appends columns after the data: one { header, cell(cols) }, or an
// array of them, where cell returns HTML for that row. The adapter and full
// views use it for the per-guide buttons and the cross-library count.
// Hotspot mutations in the chosen cell line.
//
// A gene that already carries an activating hotspot in the line being screened
// is not the same experiment as the same gene wild-type: knocking out mutant
// BRAF in A-375 asks what that cell depends on, and the answer is not what a
// wild-type knockout would give. And a guide whose spacer or PAM happens to
// cover the mutated codon may not cut that allele at all.
//
// DepMap's hotspot calls, with the variant named where DepMap names it. About
// 60 KB, fetched only when a cell line has been picked.
var _hotspots = { data: null, loading: null }

function HOT_loadIfNeeded() {
    if (_hotspots.data) return Promise.resolve(_hotspots.data)
    if (_hotspots.loading) return _hotspots.loading
    _hotspots.loading = fetch("hotspotMutations.json")
        .then(r => r.ok ? r.json() : null)
        .then(json => {
            _hotspots.data = json || { genes: [], byCellLine: {}, named: {}, source: "" }
            return _hotspots.data
        })
        .catch(e => {
            console.warn("Hotspot list unavailable:", e)
            _hotspots.data = { genes: [], byCellLine: {}, named: {}, source: "" }
            return _hotspots.data
        })
    return _hotspots.loading
}

// The one cell line the design is annotated against, or null. The copy-number
// lookup mode can hold several at once, and a mark that means "in one of these
// lines" means nothing.
function _hotCellLine() {
    if (typeof _cnState === "undefined" || !_cnState) return null
    if (_cnState.isMode) return null
    const picked = _cnState.screeningCellLines
    return (picked && picked.length === 1) ? picked[0] : null
}

// "" when the gene carries a hotspot DepMap does not name, the variant when it
// does, and null when it carries none.
function HOT_variant(cellLine, symbol) {
    const d = _hotspots.data
    if (!d || !cellLine || !symbol) return null
    const idx = d.byCellLine[cellLine.id]
    if (!idx || !idx.length) return null
    var name = String(symbol).trim().toUpperCase()
    // The library may spell the gene differently from DepMap; the same
    // resolver the copy-number column uses knows the aliases.
    if (typeof CN_resolveSymbol === "function" && typeof CN_isLoaded === "function" && CN_isLoaded()) {
        const map = (typeof _library !== "undefined" && _library) ? _library.synonymMap : null
        const r = CN_resolveSymbol(name, map)
        if (r && r.resolved) name = r.resolved
    }
    for (const i of idx) {
        if (d.genes[i] === name) {
            const named = d.named[cellLine.id]
            return (named && named[name]) || ""
        }
    }
    return null
}

// Sorting the output table by clicking a heading.
//
// The file's own order means something — the guides for a gene come out best
// first — so sorting is a third state rather than a mode: click once for
// ascending, again for descending, a third time to put the file's order back.
// Each row remembers its position for that last step.
//
// The rows themselves are moved rather than the table rebuilt, so the Context
// and Libraries buttons in the last column travel with the row they belong to.
function _sortTable(table, col) {
    const body = table.tBodies[0]
    if (!body) return
    const rows = [...body.rows]
    if (rows.length < 2) return

    const th = table.tHead.rows[0].cells[col]
    const was = th.dataset.sort || ""
    const dir = was === "asc" ? "desc" : was === "desc" ? "" : "asc"
    for (const cell of table.tHead.rows[0].cells) {
        delete cell.dataset.sort
        const mark = cell.querySelector(".sortMark")
        if (mark) mark.textContent = ""
    }

    if (!dir) {
        // Back to the order the file is written in.
        rows.sort((a, b) => (+a.dataset.row) - (+b.dataset.row))
        for (const r of rows) body.appendChild(r)
        return
    }
    th.dataset.sort = dir
    const mark = th.querySelector(".sortMark")
    if (mark) mark.textContent = dir === "asc" ? " \u25b2" : " \u25bc"

    const text = row => (row.cells[col] ? row.cells[col].textContent.trim() : "")
    // A column counts as numeric when every value in it that is not blank
    // reads as a number. "none" in the library-count column and the wording in
    // the copy-number column make those text, which is what they are.
    const values = rows.map(text).filter(v => v !== "")
    const numeric = values.length > 0 && values.every(v => /^-?[\d.]+$/.test(v.replace(/,/g, "")))
    const sign = dir === "asc" ? 1 : -1

    // Stable, and blanks last whichever way it is sorted: an empty cell is a
    // missing value, not the smallest one.
    const decorated = rows.map((row, i) => ({ row, i, v: text(row) }))
    decorated.sort((a, b) => {
        if (a.v === "" || b.v === "") {
            if (a.v === b.v) return a.i - b.i
            return a.v === "" ? 1 : -1
        }
        const d = numeric
            ? parseFloat(a.v.replace(/,/g, "")) - parseFloat(b.v.replace(/,/g, ""))
            : a.v.localeCompare(b.v, undefined, { numeric: true, sensitivity: "base" })
        return d !== 0 ? sign * d : a.i - b.i
    })
    for (const d of decorated) body.appendChild(d.row)
}

document.addEventListener("click", e => {
    const th = e.target.closest ? e.target.closest("th.sortable") : null
    if (!th) return
    const table = th.closest("table.sortTable")
    if (!table) return
    _sortTable(table, th.cellIndex)
})

document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return
    const th = e.target.closest ? e.target.closest("th.sortable") : null
    if (!th) return
    e.preventDefault()
    const table = th.closest("table.sortTable")
    if (table) _sortTable(table, th.cellIndex)
})

// Genes that are essential in nearly every cell line. Marked with a * in the
// output table, because they behave the same way in any screen: their guides
// drop out whatever the experiment was asking, so a hit among them is usually
// the screen working rather than a result. They are also the genes to look at
// first when a screen appears to have failed.
//
// Human: DepMap's inferred common essentials. Mouse: their orthologues. Built
// by tools/build_essential_genes.py; about 30 KB, fetched after the first run
// that needs it and kept for the session.
var _essential = { data: null, loading: null }

function ESS_loadIfNeeded() {
    if (_essential.data) return Promise.resolve(_essential.data)
    if (_essential.loading) return _essential.loading
    _essential.loading = fetch("essentialGenes.json")
        .then(r => r.ok ? r.json() : null)
        .then(json => {
            _essential.data = {
                source: (json && json.source) || "",
                human: new Set((json && json.human || []).map(s => s.toLowerCase())),
                mouse: new Set((json && json.mouse || []).map(s => s.toLowerCase()))
            }
            return _essential.data
        })
        .catch(e => {
            // A missing list only costs the asterisks.
            console.warn("Essential-gene list unavailable:", e)
            _essential.data = { source: "", human: new Set(), mouse: new Set() }
            return _essential.data
        })
    return _essential.loading
}

// The column the downloaded files carry. Named so the file explains itself
// when it is opened by someone who never saw the app: these land in order
// forms and analysis folders, and "essential" on its own invites the reader to
// think it means essential for their experiment.
const _ESS_COLUMN = "Broadly essential (in nearly every cell line)"

// The hotspot column, and the value in it. Named after the cell line, since
// this is a fact about that line and not about the gene.
function _hotColumn(cl) {
    return `Hotspot mutation in ${_cnPlainName(cl)} cells`
}

function _hotFlag(cl, symbol) {
    const v = (typeof HOT_variant === "function") ? HOT_variant(cl, symbol) : null
    return v === null ? "" : (v || "yes")
}

function ESS_flag(symbol) {
    return ESS_isEssential(symbol) ? "yes" : ""
}

function ESS_isEssential(symbol) {
    if (!_essential.data) return false
    const set = _setsSpecies() === "Mouse" ? _essential.data.mouse : _essential.data.human
    return set.has(String(symbol).trim().toLowerCase())
}

function _renderTsvAsTable(tsv, delimiter, rowExtra) {
    const extras = !rowExtra ? [] : (Array.isArray(rowExtra) ? rowExtra.filter(Boolean) : [rowExtra])
    if (!delimiter) delimiter = "\t"
    const lines = tsv.trim().split("\n").filter(l => l.length > 0)
    if (lines.length === 0) return "<p>No data</p>"

    // Separate leading info/comment lines from tabular data
    var infoHtml = ""
    var dataStart = 0
    for (var i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith("#") || !line.includes(delimiter)) {
            const displayText = line.startsWith("# ") ? line.substring(2) : line
            // Comment rows are written by this app and may carry deliberate
            // markup; everything below is data and gets escaped.
            // The run banner is the only line specific to this file, so it is
            // drawn as a callout instead of a fourth line of gray small print.
            // Two of these lines are not small print. The run banner says what
            // this file is, and the copy-number line says why most of a column
            // is empty — a reader who misses it reads blank cells as missing
            // data. Both are drawn as callouts; everything else stays quiet.
            const rich = _headerHtml[displayText.trim()] || displayText
            infoHtml += /^THIS RUN:/.test(displayText)
                ? `<p class="runBanner">${displayText}</p>`
                : /^Copy number:/.test(displayText)
                ? `<p class="cnNote">${rich}</p>`
                : `<p style="font-size: 0.8rem; color: #666; margin-bottom: 2px;">${displayText}</p>`
            dataStart = i + 1
        } else {
            break
        }
    }

    if (dataStart >= lines.length) return infoHtml + "<p>No tabular data</p>"

    const headers = lines[dataStart].split(delimiter)
    // Italicize cells in gene-symbol columns to follow the standard
    // nomenclature convention (HUGO: human genes uppercase italic;
    // MGI: mouse genes sentence-case italic). We don't force the case
    // here — the source data is already correct (DepMap stores human
    // as "TP53" and mouse libraries as "Trp53") — we just add italic
    // styling to the gene column when rendered as HTML. Header match
    // covers the common patterns across all of our outputs.
    const _GENE_HEADER_RE = /^(gene|gene symbol|gene id|target gene symbol|annotated gene symbol|gene_id|approved_symbol|resolvedsymbol|symbol|target gene)$/i
    const italicCols = new Set()
    for (let j = 0; j < headers.length; j++) {
        if (_GENE_HEADER_RE.test(headers[j].trim())) italicCols.add(j)
    }
    // The * goes on the symbol itself, in the first gene column only. The
    // file keeps plain symbols: an asterisk inside a gene name would follow
    // the symbol into MAGeCK, a vendor's order form and every lookup made
    // from them.
    const starCol = Math.min(...italicCols, Infinity)
    var starred = false
    const hotSeen = new Map()
    // Gene symbols, guide IDs and sequences never contain a space, so a cell
    // that does is prose and may wrap. Everything else stays on one line,
    // where a break would make it unreadable. Without this the longest
    // sentence in a column set the column's width and pushed the columns
    // after it off the right of the pane.
    const _wrappable = t => /\s/.test(String(t).trim())
    // The essential column is for the file. On screen the same fact is the *
    // on the symbol, which costs no width in a table that already has more
    // columns than a phone can hold.
    const hiddenCols = new Set()
    headers.forEach((h, j) => {
        if (h.trim() === _ESS_COLUMN) hiddenCols.add(j)
        // Same reasoning as the essential column: on screen the ** and the
        // line under the table say it, in none of the width.
        if (/^Hotspot mutation in /.test(h.trim())) hiddenCols.add(j)
    })
    // The rows are built first: whether an appended column can be sorted
    // depends on what its cells turn out to hold, and the heading that says so
    // is written above them.
    const extraHasControls = extras.map(() => false)
    var bodyHtml = ""
    for (var i = dataStart + 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter)
        // Pad short rows out to the header. A row ending in an empty field
        // ends in a separator, and trimming the file removes that separator
        // from the last row, which used to shift every appended column left
        // by one on that row alone.
        while (cols.length < headers.length) cols.push("")
        bodyHtml += `<tr data-row="${i - dataStart - 1}">`
        for (let j = 0; j < cols.length; j++) {
            if (hiddenCols.has(j)) continue
            const safe = _escapeHtml(cols[j])
            const cls = _wrappable(cols[j]) ? ' class="wrapCell"' : ""
            var cell = italicCols.has(j) ? `<i>${safe}</i>` : safe
            // The gene itself opens in Correlate, where the same gene has its
            // effect across the whole DepMap panel. Only in the symbol column,
            // only for real genes — a safe-targeting control is not one — and
            // only for human libraries, since that is the panel Correlate
            // holds.
            if (j === starCol && _geneLinkable(cols[j])) {
                const sym = String(cols[j]).trim()
                cell = `<a class="geneLink" href="${_correlateGeneUrl(sym.toUpperCase())}" target="_blank" ` +
                       `rel="noopener noreferrer" title="Open ${_escapeHtml(sym)} in Correlate: its gene effect across ` +
                       `the DepMap cell lines">${cell}</a>`
            }
            if (j === starCol) {
                const line = _hotCellLine()
                const variant = line ? HOT_variant(line, cols[j]) : null
                if (variant !== null) {
                    cell += `<span class="hotMark" title="Known hotspot mutation in ${_escapeHtml(line.name)}` +
                            `${variant ? ": " + _escapeHtml(variant) : ""}">**</span>`
                    hotSeen.set(String(cols[j]).trim(), variant)
                }
            }
            if (j === starCol && ESS_isEssential(cols[j])) {
                // A marker again rather than a link: the symbol beside it now
                // goes to the same page, and two links to one place in one
                // cell is one too many.
                cell += `<span class="essStar" title="Essential in nearly every cell line">*</span>`
                starred = true
            }
            bodyHtml += `<td${cls}>${cell}</td>`
        }
        extras.forEach((x, k) => {
            const cell = x.cell(cols) || ""
            const hasControls = /<button|<a /.test(cell)
            if (hasControls) extraHasControls[k] = true
            // Same rule as the data columns: a phrase can wrap, a button row
            // cannot. Buttons carry no spaces outside their markup, so the
            // test looks at the text the cell will actually show.
            const text = cell.replace(/<[^>]*>/g, " ").trim()
            bodyHtml += `<td class="gcCell${hasControls ? "" : (_wrappable(text) ? " wrapCell" : "")}">${cell}</td>`
        })
        bodyHtml += '</tr>'
    }

    var html = infoHtml + '<table class="validationResultsTable sortTable"><thead><tr>'
    for (let j = 0; j < headers.length; j++) {
        if (hiddenCols.has(j)) continue
        const h = headers[j]
        const rich = _headerHtml[h.trim()]
        html += `<th class="sortable${_wrappable(h) ? " wrapCell" : ""}" tabindex="0" ` +
                `title="Sort by this column">${rich || _escapeHtml(h)}<span class="sortMark"></span></th>`
    }
    // An appended column of values sorts like any other; one holding the
    // Context and Libraries buttons has nothing to sort by.
    extras.forEach((x, k) => {
        const sortable = !extraHasControls[k]
        html += `<th class="${sortable ? "sortable " : ""}${_wrappable(x.header) ? "wrapCell" : ""}"` +
                (sortable ? ' tabindex="0" title="Sort by this column"' : "") +
                `>${_escapeHtml(x.header)}${sortable ? '<span class="sortMark"></span>' : ""}</th>`
    })
    html += '</tr></thead><tbody>' + bodyHtml + '</tbody></table>'
    if (hotSeen.size) {
        const line = _hotCellLine()
        // Named in the line itself, so the variant is readable without a
        // hover, which a phone does not have.
        const shown = [...hotSeen.entries()].slice(0, 6)
            .map(([g, v]) => _escapeHtml(g) + (v ? " " + _escapeHtml(v) : ""))
        const more = hotSeen.size - shown.length
        html += `<p class="essLegend">** Carries a known hotspot mutation in ` +
                `${_escapeHtml(line ? line.name : "this cell line")} cells: ${shown.join(", ")}` +
                `${more > 0 ? ` and ${more} more` : ""}. Knocking out a gene that is already mutated is a different ` +
                `experiment from knocking out the wild-type, and a guide whose spacer or PAM covers the mutated site may ` +
                `not cut that allele. Source: ${_escapeHtml((_hotspots.data && _hotspots.data.source) || "DepMap")}.</p>`
    }
    if (starred) {
        html += `<p class="essLegend">* Essential in nearly every cell line, so its guides drop out ` +
                `whatever the experiment was asking. Source: ${_escapeHtml(_essential.data.source)}.</p>`
    }
    return html
}

function _renderValidationTsvAsTable(tsv) {
    const lines = tsv.trim().split("\n").filter(l => l.length > 0)
    if (lines.length === 0) return "<p>No data</p>"

    // Skip comment lines, show as info text
    var infoHtml = ""
    var dataStart = 0
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("#")) {
            const displayText = lines[i].startsWith("# ") ? lines[i].substring(2) : lines[i].substring(1)
            // Comment rows are written by this app and may carry deliberate
            // markup; everything below is data and gets escaped.
            infoHtml += `<p style="font-size: 0.8rem; color: #666; margin-bottom: 2px;">${displayText}</p>`
            dataStart = i + 1
        } else {
            break
        }
    }

    if (dataStart >= lines.length) return infoHtml + "<p>No data</p>"

    const headers = lines[dataStart].split("\t")

    // Count how many rows each sgRNA appears in
    const countMap = new Map()
    const rows = []
    for (var i = dataStart + 1; i < lines.length; i++) {
        const cols = lines[i].split("\t")
        const seq = cols[0]
        rows.push(cols)
        countMap.set(seq, (countMap.get(seq) || 0) + 1)
    }

    // Build table: insert "# Libraries" column after first column
    var html = infoHtml + '<table class="validationResultsTable"><thead><tr>'
    html += `<th>${_escapeHtml(headers[0])}</th><th># Libraries</th>`
    for (var h = 1; h < headers.length; h++) {
        html += `<th>${_escapeHtml(headers[h])}</th>`
    }
    html += '</tr></thead><tbody>'

    const seen = new Set()
    for (const cols of rows) {
        const seq = cols[0]
        const isFirst = !seen.has(seq)
        seen.add(seq)

        html += '<tr>'
        if (isFirst) {
            html += `<td>${_escapeHtml(seq)}</td><td>${countMap.get(seq)}</td>`
        } else {
            html += `<td></td><td></td>`
        }
        for (var c = 1; c < cols.length; c++) {
            html += `<td>${_escapeHtml(cols[c])}</td>`
        }
        html += '</tr>'
    }

    html += '</tbody></table>'
    return html
}

// The output panel hosts three mutually exclusive panes: the raw-text
// textarea (#fileContent, declared in index.html), the rendered TSV table
// (#validationTableDiv) and the copy-number results (#cnResultsDiv). The
// two div panes are created on demand; showing one hides the others.
// Everything writes into its own pane rather than the container's
// innerHTML — overwriting the container would delete the textarea, which
// index.html declares as its only child and nothing ever recreates.
// Section headings carry an info dot as a child element, so their text lives
// in an inner "<id>Text" span — writing textContent on the heading itself
// would delete the dot along with the text.
function _setSectionTitle(id, text) {
    const el = document.getElementById(id + "Text") || document.getElementById(id)
    if (el) el.textContent = text
}

// Mark which output is on screen. Several of these views look alike once
// rendered — the adapter, MAGeCK and full outputs are all a table of guides —
// so without this there is nothing to say which one you are reading.
function _setActiveShow(key) {
    document.querySelectorAll("#outputTable button[data-show]").forEach(b => {
        b.classList.toggle("show-active", b.dataset.show === key)
    })
}

function _showOutputPane(paneId) {
    const container = document.getElementById("fileContentContainer")
    container.style.display = "flex"
    for (const id of ["validationTableDiv", "cnResultsDiv"]) {
        var pane = document.getElementById(id)
        if (!pane && id === paneId) {
            pane = document.createElement("div")
            pane.id = id
            pane.style.overflowX = "auto"
            pane.style.width = "100%"
            container.appendChild(pane)
        }
        if (pane) pane.style.display = (id === paneId) ? "block" : "none"
    }
    const textarea = document.getElementById("fileContent")
    if (textarea) textarea.style.display = (paneId === "fileContent") ? "" : "none"
    return document.getElementById(paneId)
}

function _showTableOutput(text, delimiter, rowExtra) {
    const notice = (rowExtra && typeof LIBX_noticeHtml === "function") ? LIBX_noticeHtml() : ""
    _showOutputPane("validationTableDiv").innerHTML = notice + _renderTsvAsTable(text, delimiter, rowExtra)
}

function showValidationOutput() {
    _setActiveShow("validation")
    _showOutputPane("validationTableDiv").innerHTML = _renderValidationTsvAsTable(_validateState.resultsOutput)
}

function copyValidationOutput() {
    navigator.clipboard.writeText(_validateState.resultsOutput).then(() => {
        _setStatus("statusSearch", "Validation results copied to clipboard")
    })
}

function copyValidationNotFoundOutput() {
    navigator.clipboard.writeText(_validateState.notFoundOutput).then(() => {
        _setStatus("statusSearch", "Not found sequences copied to clipboard")
    })
}

function showValidationNotFoundOutput() {
    _setActiveShow("validationNotFound")
    _showOutputPane("validationTableDiv").innerHTML = _renderTsvAsTable(_validateState.notFoundOutput)
}

async function runScreening() {
    if (_validateState.isValidateMode) {
        return runValidation()
    }
    if (typeof _cnState !== "undefined" && _cnState.isMode) {
        return CN_runLookup()
    }

    _toggleLigtBox()

    button = document.getElementById("startButton")
    var statusText = document.getElementById("statusSearch")
    statusText.classList.add("pulse")
    await new Promise(r => setTimeout(r, 100)) //waits for animation

    try {
        searchOutput = await SER_runScreening(settings)

        // Resolve the optional screening cell line and load the copy-number
        // data BEFORE building any output, so the adapter output can carry
        // its per-gene CN warning column. Loaded lazily — a user who picks no
        // cell line never pays the ~60 MB download.
        // Wait for any in-flight typeahead resolution first: if the user
        // clicked "Load test data" and then immediately "Run", the selection
        // might not be in state yet.
        if (_cnState && _cnState.screeningInputPromise) {
            const inputVal = document.getElementById("screeningCellLineInput")?.value?.trim()
            if (inputVal) {
                _setStatus("statusSearch", "Waiting for cell-line data to finish loading…")
                try { await _cnState.screeningInputPromise } catch (_) {}
            }
        }
        const screeningCl = (_cnState && _cnState.screeningCellLines) ? _cnState.screeningCellLines : []
        var cnReady = false
        if (screeningCl.length > 0) {
            try {
                if (!CN_isLoaded()) {
                    // This is where the 62 MB now arrives, so the run status
                    // carries the download rather than sitting on one line
                    // while a phone looks frozen.
                    _setStatus("statusSearch", `Loading copy-number data for ${screeningCl.length} cell line(s)…`)
                    const onProgress = _cnRunProgress()
                    CN_onProgress(onProgress)
                    try { await CN_loadIfNeeded() } finally { CN_offProgress(onProgress) }
                }
                // CN_loadIfNeeded kicks off the synonym index without
                // awaiting it, so resolve it explicitly here — otherwise
                // whether an alias resolves depends on download timing and
                // the same run can produce different output twice in a row.
                await CN_loadSynonymsIfNeeded()
                cnReady = true
            } catch (e) {
                console.error("CN load failed, outputs will omit copy number:", e)
            }
        }

        // Which genes are essential in nearly every line: a column in the
        // files and a * in the table, so it has to be here before either is
        // built.
        if (typeof ESS_loadIfNeeded === "function") await ESS_loadIfNeeded()
        // Only when a cell line is in play: it is 60 KB, and it says nothing
        // without one.
        if (screeningCl.length === 1 && typeof HOT_loadIfNeeded === "function") await HOT_loadIfNeeded()
        const fullOutput = _createFullTxtOutput(searchOutput.filteredLibraryMap, searchOutput.headers)
        const notFoundOutput = _createSymbolNotFound(searchOutput.usedSynonyms)
        const adapterOutput = _createAdapterOutput(searchOutput.filteredLibraryMap, cnReady ? screeningCl[0] : null, searchOutput.essentialAdded)
        const MAGeCKOutput = _createMAGeCKOutput(searchOutput.filteredLibraryMap)

        // A new design starts a clean slate for the genomic-context feature,
        // so the methods text only mentions it for the run it was used on.
        if (typeof GC_newRun === "function") GC_newRun()
        outputTexts = {
            "textOutputFull": fullOutput,
            "textOutputNotFound": notFoundOutput,
            "textOutputAdapter": adapterOutput,
            "textOutputMAGeCK": MAGeCKOutput
        }
        _createDownloadLinkRaw(_toCsv(adapterOutput), _outName() + " with Adapters", document.getElementById("adapterDownload"), "text/csv;charset=utf-8", ".csv")
        _createDownloadLinkRaw(_toCsv(fullOutput), _outName() + " Output", document.getElementById("fullDownload"), "text/csv;charset=utf-8", ".csv")
        _createDownloadLinkRaw(_toCsv(notFoundOutput), _outName() + " not found", document.getElementById("notFoundDownload"), "text/csv;charset=utf-8", ".csv")
        _createDownloadLink(MAGeCKOutput, _outName() + " MAGeCK", document.getElementById("MAGeCKDownload"), "text/csv", ".csv")

        const cnRow = document.getElementById("cnAnnotationOutputRow")
        if (cnReady) {
            try {
                const cnOutput = _createCnAnnotationOutput(searchOutput.filteredLibraryMap, screeningCl)
                outputTexts["textOutputCn"] = cnOutput
                _createDownloadLinkRaw(_toCsv(cnOutput), _outName() + " copy number", document.getElementById("cnAnnotationDownload"), "text/csv;charset=utf-8", ".csv")
                if (cnRow) cnRow.style.display = ""
            } catch (e) {
                console.error("CN annotation failed:", e)
                if (cnRow) cnRow.style.display = "none"
            }
        } else if (cnRow) {
            cnRow.style.display = "none"
        }
    }
    catch (error) {
        console.error(`Screening failed:\n`, error);
    }

    //setStatus("fileContent", searchOutput.textOutputFull.replace(/(?:\r\n|\r|\n)/g, '<br>'))

    _toggleLigtBox()
    _statusSearchUpdate()

    statusText.classList.remove("pulse")
    document.getElementById("outputTable").style.display = "flex"
    document.getElementById("outputTable").classList.remove("statusFadeOut")
    document.getElementById("outputTable").classList.add("statusFadeIn")
    // Default the preview to "Oligos to order" once the run
    // completes — saves the user a click for the most-used output.
    if (outputTexts && outputTexts.textOutputAdapter) showAdapterOutput()
    // Which other libraries hold each guide is worth having on every run, and
    // Run is the deliberate act that justifies fetching the index for it.
    if (typeof LIBX_loadAfterRun === "function") LIBX_loadAfterRun()
    // The output rows are shown for the first time here, so the phone's
    // treatment of them has to be applied now rather than at load.
    if (typeof PHONE_apply === "function") PHONE_apply()
    _scrollToOutput()
}

// Scroll something into view and make sure it actually happened.
//
// A smooth scroll is a request, not an instruction: browsers decline it in a
// background tab, under reduced-motion settings, and in some embedded
// contexts, and when they do, scrollIntoView moves nothing at all and says
// nothing about it. That turns "take me to the answer" into silence. So the
// smooth one is asked for, and if the page has not moved a moment later it is
// done outright.
function APP_scrollIntoView(el) {
    if (!el) return
    const before = window.scrollY
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }) }
    catch (e) { el.scrollIntoView(true) }
    setTimeout(() => {
        if (Math.abs(window.scrollY - before) > 4) return   // it took
        const top = window.scrollY + el.getBoundingClientRect().top
        window.scrollTo(0, Math.max(0, Math.round(top)))
    }, 350)
}

// The results are at the foot of a page that is three columns on a desktop
// and one long column on a phone, so on a phone pressing Run left the user
// looking at the button they had just pressed with the answer several screens
// below. Scrolled into view once the table is drawn.
//
// Only when the outputs are actually below the fold: on a wide screen they
// often are not, and moving the page under someone who can already see the
// answer is worse than doing nothing.
function _scrollToOutput() {
    const table = document.getElementById("outputTable")
    if (!table) return
    requestAnimationFrame(() => {
        if (table.getBoundingClientRect().top < window.innerHeight * 0.75) return
        APP_scrollIntoView(table)
    })
}

// Copy-number warning for one gene in the screening cell line. Only the
// extremes are flagged, so the column holds nothing but things worth acting
// on:
//   Deep deletion — the gene is effectively absent, so its guides cannot
//     report a knockout phenotype and any signal from them is noise.
//   Amplification — the copy-number effect. Cas9 cuts once per copy, so in
//     an amplified region the cell takes many simultaneous double-strand
//     breaks and can die from the damage regardless of what the gene does.
//     That reads as dropout and is a classic false positive.
// Anything in between gets a blank cell. Control blocks are skipped, since a
// non-targeting guide has no locus to report.
function _cnAdapterFlag(symbol, cellLine, synonymMap) {
    if (typeof LIB_isControlSymbol === "function" && LIB_isControlSymbol(symbol)) return ""
    const { resolved } = CN_resolveSymbol(String(symbol).toUpperCase(), synonymMap)
    if (!resolved) return "no CN data"
    const v = CN_lookup(cellLine.id, resolved)
    if (v == null) return "no CN data"
    // Relative to the line's own ploidy, not converted to copies. "~6 copies"
    // reads as a lot until you remember the baseline here is four, and it
    // hides the very thing the heading is at pains to say. "1.43x" carries the
    // comparison in the number itself and does not have to be reinterpreted
    // for each cell line.
    //
    // A rounded figure, not a measurement. "0.26x" invites the reader to take
    // the second decimal seriously and there is nothing there to take: what
    // this column is for is which way a gene departs from the rest of the
    // genome and roughly how far, and the word in front of the number already
    // carries the first half of that. Below half an average gene it is not
    // worth rounding at all, since nothing anyone would do turns on whether it
    // is 0.26 or 0.4. The exact values are a column of the Copy number per
    // gene output.
    const detail = v < 0.5 ? "below 0.5x"
                 : v < 3   ? `about ${(Math.round(v * 2) / 2).toFixed(1)}x`
                 :           `about ${Math.round(v)}x`
    // What each of these means for a screen is said once, above the table, in
    // _cnColumnNote, rather than repeated on every row.
    if (v < 0.3)  return `DEEP DELETION, ${detail}`
    if (v >= 5.0) return `HIGHLY AMPLIFIED, ${detail}`
    if (v >= 3.0) return `AMPLIFIED, ${detail}`
    // Between the two extremes the column used to say nothing at all, so a
    // gene sitting at one copy looked the same as one at two. Neither state
    // invalidates a screen, but a loss or a gain is worth knowing when a guide
    // behaves oddly, so they are named without being called warnings.
    if (v < 0.7)  return `one-copy loss, ${detail}`
    if (v >= 2.0) return `gain, ${detail}`
    if (v >= 1.3) return `slight gain, ${detail}`
    // A gene sitting at the line's own ploidy has nothing to report. Saying
    // so anyway filled the column on every row, and in a doubled line it read
    // as a finding: A-375 is near-tetraploid, so an unremarkable gene came out
    // as "~4 copies" on every line of the file. The ploidy belongs in the
    // heading, once, and the column is left for departures from it.
    return ""
}

// Headings the on-screen table should draw as something richer than their own
// plain text. The plain text is what goes into the downloaded file and is what
// the lookup is keyed on; this only changes how the header cell is drawn.
var _headerHtml = {}

// The heading over that column. Short, because a table column is a bad place
// for a sentence: at this width the full explanation stacked five lines deep
// and made the header row taller than eight rows of data.
//
// It does name the ploidy, though. Every copy number under it is read against
// that baseline, and in a doubled line the baseline is four copies rather than
// two, which inverts what an ordinary-looking number means. That half is set
// in red, because it is the part a reader has to carry into the column.
function _cnColumnHeading(cl) {
    const name = _cnPlainName(cl)
    const doubled = cl.wgd === true
    // The unit, by example. "Copy number (A-375)" over a column of "1.4x" left
    // the reader to work out 1.4 of what, and the likeliest guess — copies —
    // is wrong. "1.0x = an average gene in A-375 cells" says it in the
    // heading, where it is read at the same moment as the number.
    const base = `Copy number, 1.0x = an average gene in ${name} cells`
    const plain = base + (doubled ? ", genome doubled" : "")
    // Three deliberate lines rather than one sentence left to wrap: a heading
    // this narrow broke wherever it ran out of room, and "A-375" came apart
    // across two rows. Each line is now a whole thought, and the cell line
    // itself cannot be split.
    _headerHtml[plain] = `<span class="cnHeadTop">Copy number</span>` +
        `<span class="cnHeadSub">1.0x = an average gene in ` +
        `<span class="cnHeadName">${_escapeHtml(name)} cells</span></span>` +
        (doubled ? `<span class="cnHeadWgd">genome doubled</span>` : "")
    return plain
}

function _cnColumnNote(cl) {
    const bits = []
    if (cl.ploidy != null && !isNaN(cl.ploidy)) bits.push(`${Number(cl.ploidy).toFixed(1)}n`)
    if (cl.wgd === true) bits.push("whole-genome doubled")
    else if (cl.wgd === false) bits.push("no whole-genome doubling")
    const name = _cnPlainName(cl)
    const line = bits.length ? `${name} cells are ${bits.join(", ")}` : `${name} cells`
    // Two short sentences, one per extreme, and the amplified one names the
    // cause: the damage from the cuts, not the gene.
    const plain = `Copy number: ${line}. 1.0x is an average gene in this line, and a blank cell means no change. ` +
                  `Guides for a deleted gene have nothing to cut. Guides for an amplified gene cut many times, ` +
                  `and the excessive DNA damage can affect the cells in ways unrelated to the target gene.`
    // The cell line and its ploidy are the part every number below is read
    // against, and set in the same grey as the rest of the paragraph they were
    // lost in it. The name also links to Correlate, where the same line has a
    // page of its own.
    _headerHtml[plain] = `<b class="cnNoteLine">Copy number: ${_escapeHtml(line)}.</b> ` +
        `1.0x is an average gene in this line, and a blank cell means no change. ` +
        `Guides for a deleted gene have nothing to cut. Guides for an amplified gene cut many times, and the ` +
        `excessive DNA damage can affect the cells in ways unrelated to the target gene. ` +
        `<a class="cnNoteLink" href="${_correlateCellUrl(name)}" target="_blank" rel="noopener noreferrer">` +
        `Look up ${_escapeHtml(name)} in Correlate</a>`
    return plain
}

// Cell-line names come from DepMap, and the lines above a rendered table are
// inserted as markup rather than escaped, so nothing that could be read as a
// tag goes into one.
// Correlate's cell-line browser, where every DepMap line has a page with its
// mutations, fusions, signatures and a wiki write-up. #cell=<name> opens that
// one line with its wiki on top; Correlate resolves A-375, A375 and the DepMap
// id alike, so the published name here is enough.
function _correlateCellUrl(name) {
    return "https://correlate.cmm.se/#cell=" + encodeURIComponent(String(name || "").trim())
}

// Correlate again, this time for one gene: #gene=<symbol> fills the gene box
// and runs, so the link lands on the gene's effect across the panel rather
// than on a form.
// Is this cell a gene that Correlate would know? Controls are not genes, and
// Correlate's panel is human, so a mouse symbol would land on a search that
// finds nothing.
function _geneLinkable(value) {
    const sym = String(value == null ? "" : value).trim()
    if (!sym || /\s/.test(sym)) return false
    if (typeof _gcIsControl === "function" && _gcIsControl(sym)) return false
    if (typeof _setsSpecies === "function" && _setsSpecies() !== "Human") return false
    return /^[A-Za-z][A-Za-z0-9._-]{0,20}$/.test(sym)
}

function _correlateGeneUrl(symbol) {
    return "https://correlate.cmm.se/#gene=" + encodeURIComponent(String(symbol || "").trim())
}

function _cnPlainName(cl) {
    return String(cl.name || "").replace(/[<>&\t]/g, "")
}

// Which rows are controls rather than genes anyone asked for.
//
// A non-targeting or safe-targeting control announces itself: its symbol is
// CutCtrl or NegCtrl and no gene is called that. An essential gene does not.
// RAN, RPS8 and PLK1 sit in the list looking exactly like the genes under
// study, and someone reading the file a month later has no way to tell that
// the app put them there as a positive control.
function _controlRole(symbol, essentialAdded) {
    const kind = (typeof LIB_controlKind === "function") ? LIB_controlKind(symbol) : null
    if (kind === "safeTargeting") return "safe-targeting control"
    if (kind === "nonTargeting") return "non-targeting control"
    const up = String(symbol || "").toUpperCase()
    if (essentialAdded && essentialAdded.some(g => String(g).toUpperCase() === up)) return "positive control"
    return ""
}

// How the guides for a gene are ordered, said in the file rather than left to
// be inferred from the row order.
//
// Every built-in library that carries a score is sorted by it, best first, so
// _1 is the library's own first pick. That is a prediction from the design
// algorithm, and a reader about to order the top two guides for each gene
// should know it was never tested at the bench. The libraries that carry no
// score are left in file order, which is not a ranking at all and has been
// read as one.
function _orderNote(headers) {
    const col = parseInt(settings.rankingColumn, 10)
    if (isNaN(col) || col <= 0) {
        return "Order: this library provides no score, so the sgRNAs for a gene are in the order the library file lists them. They are not ranked."
    }
    // The column is named in brackets rather than in the sentence: the
    // libraries call it anything from "Pick Order" to "Auto-pick top sgRNAs",
    // and only some of those read as part of a sentence.
    const name = (headers && headers[col - 1]) ? String(headers[col - 1]).trim() : ""
    return "Order: for each gene, the sgRNAs are listed best first, using the library's own ranking" +
           (name ? ` (${name})` : "") +
           ". That ranking comes from the design algorithm and is a prediction, not experimental validation."
}

function _createAdapterOutput(libraryMap, screeningCellLine, essentialAdded) {
    const date = new Date()
    // Each extra column appears only when it has something to say, so a plain
    // run keeps the familiar three-column shape.
    const cl = screeningCellLine || null
    const synonymMap = (typeof _library !== "undefined" && _library && _library.synonymMap) ? _library.synonymMap : null
    const roles = {}
    var anyRole = false
    for (const symbol of Object.keys(libraryMap)) {
        roles[symbol] = _controlRole(symbol, essentialAdded)
        if (roles[symbol]) anyRole = true
    }

    var out = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    out = out + _orderNote(typeof searchOutput !== "undefined" && searchOutput ? searchOutput.headers : null) + "\n"
    if (cl) out = out + _cnColumnNote(cl) + "\n"
    // "+ adapters" only when there are adapters on the sequence. With both
    // boxes empty the column is the bare spacer, and saying otherwise sends a
    // reader looking for vector sequence that is not there.
    const hasAdapters = !!(String(settings.adapterBefore || "").trim() ||
                           String(settings.adapterAfter || "").trim())
    out = out + `Symbol\tSymbol_ID\t${hasAdapters ? "spacer + adapters" : "spacer"}` +
          (anyRole ? "\tAdded as" : "") + `\t${_ESS_COLUMN}` +
          (cl ? `\t${_hotColumn(cl)}` : "") +
          (cl ? `\t${_cnColumnHeading(cl)}` : "") + "\n"

    for (var symbol of Object.keys(libraryMap)) {
        // One lookup per symbol rather than per guide — otherwise a large
        // design redoes the same resolve-and-lookup three or four times a row.
        const flag = cl ? _cnAdapterFlag(symbol, cl, synonymMap) : ""
        const essential = ESS_flag(symbol)
        const hot = cl ? _hotFlag(cl, symbol) : ""
        for (var i = 0; i < libraryMap[symbol].length; i++) {
            const row = libraryMap[symbol][i]
            const capitalizedSymbol = row[settings.symbolColumn - 1].trim()
            out = out + `${_spreadsheetSafe(capitalizedSymbol)}\t${_spreadsheetSafe(capitalizedSymbol + "_" + (i + 1))}\t${_spreadsheetSafe(_applyPostProcessing(row[settings.RNAColumn - 1]))}` +
                  (anyRole ? `\t${roles[symbol]}` : "") + `\t${essential}` +
                  (cl ? `\t${hot}` : "") + (cl ? `\t${flag}` : "") + "\n"
        }
    }
    return out
}


function _createMAGeCKOutput(libraryMap) {
    // MAGeCK count's library file format expects three lowercase columns:
    // sgRNA, sequence, gene (see the mageck-count docs). Keeping the
    // header in the documented canonical form means the file works
    // unmodified in `mageck count --list-seq` pipelines.
    var out = "sgRNA,sequence,gene\n"
    for (var symbol of Object.keys(libraryMap)) {
        for (var i = 0; i < libraryMap[symbol].length; i++) {
            const row = libraryMap[symbol][i]
            const capitalizedSymbol = row[settings.symbolColumn - 1].trim()
            out = out + `${_spreadsheetSafe(capitalizedSymbol + "_" + (i + 1))},${_spreadsheetSafe(_applyTrim(row[settings.RNAColumn - 1]))},${_spreadsheetSafe(capitalizedSymbol)}\n`
        }
    }
    return out
}

// Per-gene CN annotation TSV — one row per gene in the screening output,
// columns are (CN) and (~copies) for each selected cell line. Mirrors the
// layout of the standalone CN-mode TSV so users with both files can join
// them in Excel by gene symbol.
// Four labeled comment rows that head every CN TSV — kept identical
// between the standalone CN-mode TSV and the screening-annotation TSV,
// and in the same plain-text style as the full-matrix export. No HTML:
// these files get downloaded and opened in Excel / R / pandas, where
// tags and entities would sit in the data as literal characters.
// _renderTsvAsTable already styles lines starting with '#' as small gray
// paragraphs above the table, so the in-app preview stays readable
// without any markup of its own.
//
// Row order matches how a user typically reads the output:
//   1. Ploidy / WGD — the context everything else is relative to.
//   2. What the (CN) columns mean.
//   3. What the (~copies) columns mean.
//   4. Which cell line(s) this particular run used.
function _cnHeaderComments(cellLines) {
    // Three general-concept rows (titles are generic — not cell-line
    // specific — so they explain what the columns mean in any run),
    // then a run-specific banner with the actual cell-line ploidy.
    const ploidyConceptRow = `# Ploidy / WGD — ploidy is the line's average DNA content per cell, where 2.0n is diploid and ~4n is fully tetraploid. The WGD flag marks lines whose genome went through a whole-genome doubling event at some point in their history; subsequent chromosome loss often brings the current ploidy back below 4n, so WGD lines commonly sit anywhere from ~2.5n to ~4n.`
    const cnRow = `# Copy number / CN — relative copy number from DepMap's OmicsCNGene dataset (24Q4 release). Each value is relative to the line's own genome-wide baseline: 1.0 = typical, >= 3.0 = amplification, <= 0.5 = deletion. Variability — values like 0.7 or 1.3 instead of clean integers — usually reflects either sequencing noise or sub-clonal genotype heterogeneity within the cell-line population.`
    const copiesRow = `# Copies — estimated actual copy count per cell, snapped to whole numbers. Computed as round(CN x 2) for non-WGD lines and round(CN x 4) for WGD lines, so a typical (CN ~ 1) gene reads as 2 copies (or 4 if WGD), regardless of the line's measured fractional ploidy.`

    // Run-specific row — sits right above the table so the cell-line and
    // ploidy context for this particular file is unmissable.
    const ploidyParts = cellLines.map(c => {
        if (!c.knownPloidy) return `${c.name} — ploidy unknown (assumed 2.0n, treated as non-WGD)`
        const wgdNote = c.wgd ? `, whole-genome doubled (WGD)` : `, non-WGD`
        return `${c.name} — ploidy ${c.ploidy.toFixed(2)}n${wgdNote}`
    })
    const ploidyRow = `# THIS RUN: ${ploidyParts.join("; ")}`

    // The run banner goes first. It is the one line here that is specific to
    // this file rather than general explanation, so it should not be the
    // fourth paragraph of small print.
    return [ploidyRow, ploidyConceptRow, cnRow, copiesRow]
}

function _createCnAnnotationOutput(libraryMap, screeningCellLines) {
    const synonymMap = (typeof _library !== "undefined" && _library && _library.synonymMap) ? _library.synonymMap : null
    const headerLines = _cnHeaderComments(screeningCellLines)
    const colHeader = [
        "Gene",
        "ResolvedSymbol",
        ...screeningCellLines.map(c => `${c.name} (CN)`),
        ...screeningCellLines.map(c => `${c.name} (~copies)`)
    ].join("\t")
    const lines = [...headerLines, colHeader]
    // Use the screening output's gene order — these are the genes the
    // user actually got sgRNAs for (post-synonym resolution + library
    // intersection). Symbols come back capitalised but stored
    // lower-case in libraryMap; uppercase for the CN lookup either way.
    for (const sym of Object.keys(libraryMap)) {
        // Non-targeting controls have no genomic locus, so a copy-number
        // row for them would be a line of blanks. Skip the control block.
        if (typeof LIB_isControlSymbol === "function" && LIB_isControlSymbol(sym)) continue
        const upper = sym.toUpperCase()
        const { resolved } = CN_resolveSymbol(upper, synonymMap)
        const cnCells = screeningCellLines.map(cl => {
            if (!resolved) return ""
            const v = CN_lookup(cl.id, resolved)
            return v == null ? "" : v.toFixed(2)
        })
        const copyCells = screeningCellLines.map(cl => {
            if (!resolved) return ""
            const v = CN_lookup(cl.id, resolved)
            const c = CN_approxCopies(v, cl.ploidy, cl.wgd)
            return c == null ? "" : (Number.isInteger(c) ? c.toString() : c.toFixed(1))
        })
        lines.push([_spreadsheetSafe(upper), _spreadsheetSafe(resolved || ""), ...cnCells, ...copyCells].join("\t"))
    }
    return lines.join("\n") + "\n"
}

function showCnAnnotationOutput() {
    if (outputTexts && outputTexts.textOutputCn) {
        _setActiveShow("cnAnnotation")
        _showTableOutput(outputTexts.textOutputCn)
    }
}

function _createFullTxtOutput(libraryMap, headers) {
    const date = new Date()
    var out = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    if (settings.libraryName === "Jacquere (human)") {
        out += `# On-Target Efficacy Score: RS3seq-Chen2013+RS3target (higher = better). Range in library: -1.4 to 2.4. Guides ranked by Pick Order.\n`
        out += `# Aggregate CFD Score: cumulative off-target activity (lower = fewer off-targets). Range in library: 0 to 4.8 (design cutoff).\n`
    } else if (settings.libraryName === "Julianna (mouse)") {
        out += `# On-Target Efficacy Score: RS3seq-Chen2013+RS3target (higher = better). Range in library: -1.7 to 2.2. Guides ranked by Pick Order.\n`
        out += `# Aggregate CFD Score: cumulative off-target activity (lower = fewer off-targets). Range in library: 0 to 4.8 (design cutoff).\n`
    }
    const hotLine = (typeof _hotCellLine === "function") ? _hotCellLine() : null
    var out = out + headers.join("\t") + `\t${_ESS_COLUMN}` +
              (hotLine ? `\t${_hotColumn(hotLine)}` : "") + "\n" //the original headers are placed att the top of the output
    for (var symbol of Object.keys(libraryMap)) {
        const essential = ESS_flag(symbol)
        const hot = hotLine ? _hotFlag(hotLine, symbol) : null
        libraryMap[symbol].forEach(row => {
            out = out + `${row.map(_spreadsheetSafe).join("\t")}\t${essential}` +
                  (hotLine ? `\t${hot}` : "") + "\n"
        })
    }
    return out
}

function _createSymbolNotFound(usedSynonyms) {
    var out = ""
    for (var symbol of Object.keys(usedSynonyms)) {
        if (settings.enableSynonyms && (usedSynonyms[symbol].length > 0)) {
            for (var synonym of usedSynonyms[symbol]) {
                out = `${_spreadsheetSafe(symbol)}\t${_spreadsheetSafe(synonym)}\n` + out
            }
        }
        else {
            out = out + `${_spreadsheetSafe(symbol)}\t\n`
        }
    }
    out = "Symbol searched\t Symonym used\r\n" + out
    const date = new Date()
    var out = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n` + out
    return out
}


function _applyPostProcessing(text) {
    var newText = _applyTrim(text)
    newText = _applyAdapter(newText)
    return newText
}

function _applyTrim(text) {
    var newText = text.slice(settings.trimBefore)
    if (settings.trimAfter != 0) {
        newText = newText.slice(0, -settings.trimAfter)
    }
    return newText
}

// Adapters in lower case, spacer in upper. DNA is case-insensitive to a
// synthesiser, so this is presentation: it is how a finished oligo is set out,
// and it is the only thing in the string that says where the vector's own
// sequence stops and the guide begins. The boxes keep whatever case was typed,
// because that is the user's text; the oligo built from them does not.
function _applyAdapter(text) {
    const before = String(settings.adapterBefore || "").toLowerCase()
    const after = String(settings.adapterAfter || "").toLowerCase()
    return before + String(text).toUpperCase() + after
}

// show/hide lightbox - used to cover screen when running search
function _toggleLigtBox() {
    const box = document.getElementById('overlay')
    if (box.classList.contains("fazeIn")) {
        box.classList.remove("fazeIn")
        box.classList.add("fazeOut")
    }
    else {
        box.classList.remove("fazeOut")
        box.classList.add("fazeIn")
    }
}

function _createDownloadLink(text, name, element, filetype, fileEnding) {
    text = text.replace("    ", "\t")
    var blob = new Blob([text], { type: filetype })
    element.href = URL.createObjectURL(blob)
    element.download = name + fileEnding
}

// The delimited outputs are assembled tab-separated, because no library field
// contains a tab and that makes them safe to build by string concatenation.
// They are written to disk as CSV, because that is what opens in Excel on a
// double-click while a .tsv typically does not. Quoting follows RFC 4180: a
// field holding a comma, a quote or a newline is wrapped in quotes and its
// own quotes doubled, so the round trip is lossless.
// The output-name field is optional, so it is usually blank — without a
// fallback every download came out named " with Adapters.csv", leading space
// and all.
function _outName() {
    return (settings["outputName"] || "").trim() || "Green Listed"
}

function _toCsv(text) {
    if (!text) return text
    return text.split("\n").map(line => {
        if (line === "") return ""
        // Strip a trailing CR before splitting so it cannot land inside the
        // last field and force it to be quoted.
        const cr = line.endsWith("\r")
        const body = cr ? line.slice(0, -1) : line
        return body.split("\t").map(_csvField).join(",") + (cr ? "\r" : "")
    }).join("\n")
}

function _csvField(value) {
    const v = String(value == null ? "" : value)
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

// Same as _createDownloadLink but writes the text verbatim. The base
// version rewrites the first run of four spaces as a tab, which would
// shift a column in any TSV whose prose header happens to contain one.
// The CN outputs carry multi-sentence header comments, so they use this
// variant — as the full-matrix export already does with its own Blob.
function _createDownloadLinkRaw(text, name, element, filetype, fileEnding) {
    var blob = new Blob([text], { type: filetype })
    element.href = URL.createObjectURL(blob)
    element.download = name + fileEnding
}

function _showTextareaOutput(text) {
    _showOutputPane("fileContent")
    _setStatus("fileContent", text, false)
}

function showAdapterOutput() {
    _setActiveShow("adapter")
    _showTableOutput(outputTexts.textOutputAdapter, undefined, _guideRowExtras("adapter"))
}

// The per-guide buttons and the cross-library count, for whichever of the two
// guide views is being drawn. Kept in one place so the two stay identical.
function _guideRowExtras(which) {
    const extras = []
    // What is known about the guide comes first, then what you can do with
    // it. The buttons used to sit between two columns of information.
    if (typeof LIBX_columnFor === "function") {
        const spacerOf = (which === "adapter") ? _adapterSpacerOf() : _fullSpacerOf()
        if (spacerOf) {
            const col = LIBX_columnFor(spacerOf)
            if (col) extras.push(col)
        }
    }
    const ctx = (which === "adapter")
        ? (typeof GC_rowExtraAdapter === "function" ? GC_rowExtraAdapter() : null)
        : (typeof GC_rowExtraFull === "function" ? GC_rowExtraFull() : null)
    if (ctx) extras.push(ctx)
    return extras
}

// The clean spacer for a row of the adapter view. The sequence in the row has
// adapters on it, so it is read back out of the run's library map instead.
function _adapterSpacerOf() {
    if (typeof searchOutput === "undefined" || !searchOutput || !searchOutput.filteredLibraryMap) return null
    const map = searchOutput.filteredLibraryMap
    return cols => {
        const symbol = String(cols[0] || "").replace(/^'/, "").trim()
        const id = String(cols[1] || "").replace(/^'/, "").trim()
        const idx = parseInt(id.slice(id.lastIndexOf("_") + 1), 10) - 1
        const rows = map[symbol.toLowerCase()]
        const row = rows && rows[idx]
        return row ? String(row[settings.RNAColumn - 1] || "").trim().toUpperCase() : null
    }
}

// The full view's rows are the library rows themselves.
function _fullSpacerOf() {
    if (typeof settings === "undefined" || !settings.RNAColumn) return null
    return cols => String(cols[settings.RNAColumn - 1] || "").trim().toUpperCase()
}

function showMAGeCKOutput() {
    _setActiveShow("mageck")
    // Raw .csv view — comma-separated, monospaced, exactly as the file
    // would look opened in a text editor. MAGeCK count consumes this
    // format directly, so seeing the literal text is what users want
    // (a pretty HTML table hides the actual delimiter).
    _showTextareaOutput(outputTexts.textOutputMAGeCK)
}

function showFullOutput() {
    _setActiveShow("full")
    _showTableOutput(outputTexts.textOutputFull, undefined, _guideRowExtras("full"))
}

function showNotFoundOutput() {
    _setActiveShow("notFound")
    _showTableOutput(outputTexts.textOutputNotFound)
}

function showSettingsOutput() {
    _setActiveShow("settings")
    _showTextareaOutput(SET_settingsToStr())
}

function _generateZipName(prefix) {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const uid = Math.random().toString(36).slice(2, 6)
    return `${prefix}_${date}_${uid}`
}

// Each output, as a one-sheet workbook. Paired with the text download on the
// same row so the choice reads as a format, not as a different thing: the text
// file is what MAGeCK and other tools read, the workbook is what survives being
// opened in Excel.
const _XLS_OUTPUTS = {
    adapter:            { label: "With adapters",       get: () => outputTexts.textOutputAdapter, delimiter: "\t" },
    mageck:             { label: "MAGeCK",              get: () => outputTexts.textOutputMAGeCK,  delimiter: "," },
    full:               { label: "Full output",         get: () => outputTexts.textOutputFull,    delimiter: "\t" },
    cnAnnotation:       { label: "Copy number",         get: () => outputTexts.textOutputCn,      delimiter: "\t" },
    notFound:           { label: "Symbols not found",   get: () => outputTexts.textOutputNotFound, delimiter: "\t" },
    settings:           { label: "Run settings",        get: () => SET_settingsToStr(),           delimiter: "\t" },
    validation:         { label: "Validation results",  get: () => _validateState.resultsOutput,  delimiter: "\t" },
    validationNotFound: { label: "Sequences not found", get: () => _validateState.notFoundOutput, delimiter: "\t" },
    cnTable:            { label: "Copy number",         get: () => _cnState.tsvOutput,            delimiter: "\t" },
    methods:            { label: "Methods",             get: () => METH_text(),                   delimiter: "\t" }
}

async function XLS_download(key) {
    const spec = _XLS_OUTPUTS[key]
    if (!spec) return
    const text = spec.get()
    if (!text) {
        _setStatus("statusSearch", "Nothing to export yet — run first.")
        return
    }
    try {
        const blob = await XLSX_build([{ name: spec.label, rows: XLSX_rowsFromDelimited(text, spec.delimiter) }])
        const base = _outName()
        _downloadBlob(blob, `${_generateZipName(base)}_${spec.label.replace(/[^A-Za-z0-9]+/g, "_")}.xlsx`)
    } catch (e) {
        console.error("Excel export failed:", e)
        _setStatus("statusSearch", "Error: could not build the Excel file")
    }
}

// One workbook, each output on its own sheet. Offered alongside the delimited
// downloads rather than replacing them, because the .tsv and MAGeCK .csv files
// are what downstream tools read — this is for the copy a person opens.
async function downloadAllExcel() {
    const sheets = []
    const add = (name, text, delimiter) => {
        if (text) sheets.push({ name: name, rows: XLSX_rowsFromDelimited(text, delimiter) })
    }
    if (_validateState.isValidateMode) {
        add("Validation results", _validateState.resultsOutput, "\t")
        add("Sequences not found", _validateState.notFoundOutput, "\t")
    } else if (_cnState.isMode) {
        add("Copy number", _cnState.tsvOutput, "\t")
    } else {
        add("With adapters", outputTexts.textOutputAdapter, "\t")
        add("MAGeCK", outputTexts.textOutputMAGeCK, ",")
        add("Full output", outputTexts.textOutputFull, "\t")
        add("Copy number", outputTexts.textOutputCn, "\t")
        add("Symbols not found", outputTexts.textOutputNotFound, "\t")
        add("Run settings", SET_settingsToStr(), "\t")
    }
    // Every bundle gets the methods text, whichever tool produced the rest.
    if (typeof METH_text === "function") add("Methods", METH_text(), "\t")
    if (!sheets.length) {
        _setStatus("statusSearch", "Nothing to export yet — run a screening first.")
        return
    }
    try {
        const blob = await XLSX_build(sheets)
        _downloadBlob(blob, _generateZipName(_outName()) + ".xlsx")
    } catch (e) {
        console.error("Excel export failed:", e)
        _setStatus("statusSearch", "Error: could not build the Excel file")
    }
}

async function downloadAll() {
    if (_validateState.isValidateMode) {
        await downloadAllValidation()
    } else {
        await downloadAllDesign()
    }
}

function _downloadBlob(blob, filename) {
    var a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

async function downloadAllDesign() {
    const name = _outName()
    const folderName = _generateZipName(name)
    const zip = new JSZip()
    const folder = zip.folder(folderName)
    folder.file(name + " with Adapters.csv", _toCsv(outputTexts.textOutputAdapter))
    folder.file(name + " MAGeCK.csv", outputTexts.textOutputMAGeCK)
    folder.file(name + " Output.csv", _toCsv(outputTexts.textOutputFull))
    folder.file(name + " not found.csv", _toCsv(outputTexts.textOutputNotFound))
    folder.file(name + " Settings.txt", SET_settingsToStr())
    // Include the per-gene copy-number annotation if the user picked a
    // screening cell line in section 3 and the file was generated.
    if (outputTexts.textOutputCn) {
        folder.file(name + " copy number.csv", _toCsv(outputTexts.textOutputCn))
    }
    if (typeof METH_text === "function") folder.file(name + " Methods.txt", METH_text())
    const blob = await zip.generateAsync({ type: "blob" })
    _downloadBlob(blob, folderName + ".zip")
}

async function downloadAllValidation() {
    const name = document.getElementById("outputFileName").value || "validation"
    const folderName = _generateZipName(name)
    const zip = new JSZip()
    const folder = zip.folder(folderName)
    folder.file(name + " Validation Results.csv", _toCsv(_validateState.resultsOutput))
    folder.file(name + " Not Found.csv", _toCsv(_validateState.notFoundOutput))
    if (typeof METH_text === "function") folder.file(name + " Methods.txt", METH_text())
    const blob = await zip.generateAsync({ type: "blob" })
    _downloadBlob(blob, folderName + ".zip")
}

async function _displayLibraryCitation(libraryCitation) {
    const libraryInfoContainer = document.getElementById("libraryInfo")
    libraryInfoContainer.innerHTML = libraryCitation
    // The phone clamp measures the text, so it has to be re-measured whenever
    // the text changes; a citation five lines long and one two lines long
    // want different treatment.
    if (typeof PHONE_apply === "function") PHONE_apply()
}

async function changeLibrary() {
    //called when library changes through (droopdown under 1. Select library)
    //uppdates library to contin relevant information for the new library

    const libraryName = document.getElementById("libraries").value
    settings.libraryName = libraryName
    const customLibrarie = document.getElementById("User Upload")
    await _displayLibraryCitation("")

    // Trim only applies to an uploaded library: the built-in ones ship a
    // uniform guide length. Revealed by the .custom-only rule in index.css.
    document.body.classList.toggle("custom-library", libraryName == "custom")
    // A different species needs a different index; fetching it now means the
    // column is ready by the time a run finishes.
    if (typeof LIBX_prefetchWhenIdle === "function") LIBX_prefetchWhenIdle()

    if (libraryName == "custom") { //shows new input fields for custom library
        settings.librarySpecies = ""   // unknown; the picker falls back to the synonym list
        customLibrarie.classList.remove("inactive")
        changeLibraryColumn()
    }
    else { //uppdates library if it was not custom
        customLibrarie.classList.add("inactive")
        _setStatus("symbolsFound", "Fetching library from server...")
        await new Promise(r => setTimeout(r, 10)) //wait for status animation to end
        try {
            const librarySettings = await SER_selectLibrary(libraryName) //uppdates library
            // Species of the selected library, used to pick which curated gene
            // lists to offer. Built-in libraries declare it via their synonym list.
            settings.librarySpecies = librarySettings.synonymName || ""
            // Needed only by libraries that ship no controls of their own, but
            // it is 45 KB and the panel has to know what is on offer before the
            // user ticks anything.
            if (typeof LIB_loadBorrowedControls === "function") await LIB_loadBorrowedControls()
            await _displayLibraryCitation(SER_getLibraryCitation())
            SET_settingsSetIndexes(librarySettings.RNAColumn, librarySettings.symbolColumn, librarySettings.RankColumn)
            // Which way the library's score runs. This used to be a dropdown
            // the user could contradict; the built-in libraries have always
            // declared it themselves, so it comes straight from the library
            // now. 0 means a higher score is better, 1 means a lower one is.
            settings.rankingOrder = librarySettings.defaultRangingOrder == 1 ? "ascending" : "descending"

            const synonymNames = await SER_getSynonymNames()
            if (synonymNames.length != 0) {

                if (synonymNames.includes(librarySettings.synonymName)) {
                    document.getElementById("synonymSelect").value = librarySettings.synonymName
                }
            }
            // update the settings based on the values in the UI
            changeSettings()
        }
        catch (error) {
            _setStatus("symbolsFound", "Error failed to fetch library")
            throw error
        }

    }
    changeSymbols()
    // A loaded curated list follows the library's species.
    if (typeof SETS_syncToLibrary === "function") await SETS_syncToLibrary()
}

async function changeSynonyms() {
    const synonymName = document.getElementById("synonymSelect").value
    settings.synonymName = synonymName
    await SER_changeSynonyms(synonymName)
    _statusUpdateSymbols()
}

function changeSymbols() {
    if (typeof _setsUsedRender === "function") _setsUsedRender()
    if (_validateState.isValidateMode) {
        const lines = SYM_split(document.getElementById("searchSymbols").value)
        _setStatus("statusSearchSymbolsRows", `${lines.length} sequence(s) entered`)
        return
    }

    const partialMatches = document.getElementById("partialMatches").checked
    const enableSynonyms = document.getElementById("enableSynonyms").checked
    //sets everything to lower case and clears any extra spaces
    const searchSymbols = [...new Set(SYM_split(document.getElementById("searchSymbols").value).map(symbol => symbol.toLowerCase()))]

    SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms)
    _updateControlsStatus()   // the suggested control count tracks the symbol list
    _statusUpdateSymbols()
}

function changeLibraryColumn() {
    //User input fields only called when adding a custom library
    const symbolColumn = document.getElementById("GeneSymbolIndex").value
    const RNAColumn = document.getElementById("gRNAIndex").value
    // Blank means the file has no score to sort on, and its rows are left in
    // the order they arrived. The built-in libraries take both of these from
    // their own configuration instead; see changeLibrary().
    const rankingColumn = parseInt(document.getElementById("rankingIndex").value, 10)
    settings.rankingOrder = document.getElementById("rankingOrder").value === "ascending" ? "ascending" : "descending"

    SET_settingsSetIndexes(RNAColumn, symbolColumn, isNaN(rankingColumn) || rankingColumn <= 0 ? 0 : rankingColumn)
    updateCustomlibrary()
}

// An adapter is DNA that will be synthesized, so anything that is not a base
// cannot be part of one. Rather than accepting the typo and failing at the
// oligo supplier, the box refuses it as it is typed: everything outside ACGT
// is dropped and the rest is upper-cased, with a line saying what went.
//
// Done on input rather than on change so the box never holds something it
// will not keep, and the caret is put back where the user was typing instead
// of jumping to the end, which is what rewriting .value does by default.
function ADAPT_clean(el) {
    const before = el.value
    const caret = el.selectionStart
    // Case is left alone. Writing an adapter in lower case and the spacer in
    // upper is how the finished oligo is normally set out, and the preview and
    // the output both rely on it to show where the guide begins and ends.
    // Upper-casing here quietly threw that away.
    const clean = before.replace(/[^ACGTacgt]/g, "")
    if (clean !== before) {
        const removedBeforeCaret = before.slice(0, caret).replace(/[ACGTacgt]/g, "").length
        el.value = clean
        const at = Math.max(0, caret - removedBeforeCaret)
        try { el.setSelectionRange(at, at) } catch (e) { /* not all inputs support it */ }
        const dropped = [...new Set(before.replace(/[ACGTacgt]/g, "").split(""))]
            .filter(c => c.trim() !== "")
        _adapterNote(dropped.length
            ? `An adapter is DNA, so ${dropped.map(c => `"${c}"`).join(", ")} ` +
              `${dropped.length === 1 ? "was" : "were"} dropped. Only A, C, G and T are kept, in whatever case you type them.`
            : "")
    } else {
        _adapterNote("")
    }
    changeSettings()
}

function _adapterNote(text) {
    const el = document.getElementById("adapterNote")
    if (!el) return
    el.textContent = text
    el.hidden = !text
}

function changeSettings() {

    const trimBefore = document.getElementById("trimBefore").value

    const trimAfter = document.getElementById("trimAfter").value

    const adapterBefore = document.getElementById("adapterBefore").value
    const adapterAfter = document.getElementById("adapterAfter").value

    const outputName = document.getElementById("outputFileName").value

    const downloadName = document.getElementById("outputFileName").value

    SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, outputName, downloadName)
    // Must run after SET_settingsSetSettings — it sizes the suggested control
    // counts from the design, pre-fills the count boxes, and then syncs the
    // control settings from whatever the boxes ended up holding.
    _updateControlsStatus()
    _statusUpdateSettings()
}

// A count box is pre-filled with the suggested number and keeps tracking the
// suggestion as the gene list changes — until the user types in it, after
// which the box is theirs and nothing overwrites it. Emptying it counts as
// touching it, so the field stays empty while they retype rather than
// refilling under the cursor; an empty box still falls back to the
// suggestion at run time.
//   dataset.auto: unset = never touched, "1" = tracking the suggestion,
//                 "0" = user owns it.
// Put a count away while its control is off, and bring it back when the
// control is ticked again. Parking rather than clearing keeps a number the
// user chose, which they would otherwise have to type again after a stray
// click on the tick box.
function _ctrlPark(input) {
    const v = String(input.value || "").trim()
    if (v) input.dataset.kept = v
    input.value = ""
    input.placeholder = ""
}

function _ctrlRestore(input) {
    if (input.dataset.auto === "0" && !String(input.value || "").trim() && input.dataset.kept) {
        input.value = input.dataset.kept
    }
}

// A disabled box with live buttons beside it would still change a number
// nothing is using.
function _ctrlStepsEnabled(input, on) {
    const stepper = input.closest(".ctrlStepper")
    if (!stepper) return
    stepper.classList.toggle("ctrlStepperOff", !on)
    for (const b of stepper.querySelectorAll(".ctrlStep")) b.disabled = !on
}

// The - and + beside a control count. The native spinner arrows are small,
// appear only on hover and are drawn differently on every browser; these are
// the same stepper the flank control uses.
//
// An empty box is showing the suggestion in its placeholder, so stepping
// starts from that rather than from zero. Either button makes the number the
// user's own, which is what typing in the box does too.
function _ctrlNudge(id, delta) {
    const input = document.getElementById(id)
    if (!input || input.disabled) return
    const from = parseInt(input.value, 10)
    const base = isNaN(from) ? parseInt(input.placeholder, 10) : from
    const min = parseInt(input.min, 10)
    const max = parseInt(input.max, 10)
    var next = (isNaN(base) ? 0 : base) + delta
    if (!isNaN(min)) next = Math.max(min, next)
    if (!isNaN(max)) next = Math.min(max, next)
    input.value = String(next)
    input.dataset.auto = "0"
    changeSettings()
}

function _controlCountEdited(input) {
    input.dataset.auto = "0"
    changeSettings()
}

// Size of the design the user is currently describing: how many genes, and
// how many guides back each one. Both feed the suggested control count.
// Direct symbol matches only, since synonym and partial-match expansion
// happen at run time, so this is an estimate — the run itself recomputes
// from the real result.
function _estimateDesign() {
    const empty = { genes: 0, guidesPerGene: 3 }
    if (typeof _library === "undefined" || !_library || !_library.libraryMap) return empty
    const symbols = (settings && settings.searchSymbols) ? settings.searchSymbols : []
    const found = new Set()
    for (const s of symbols) if (_library.libraryMap[s]) found.add(s)
    // The essential-gene panel adds genes to the design too.
    const essCb = document.getElementById("includeEssential")
    if (essCb && essCb.checked && typeof LIB_essentialPanel === "function") {
        const raw = parseInt(document.getElementById("essentialCount").value, 10)
        const n = (isNaN(raw) || raw <= 0) ? _ESSENTIAL_DEFAULT : raw
        for (const g of LIB_essentialPanel(n)) if (_library.libraryMap[g]) found.add(g)
    }
    if (found.size === 0) return empty
    var guides = 0
    for (const g of found) guides += _library.libraryMap[g].length
    return { genes: found.size, guidesPerGene: guides / found.size }
}

// The two spike-in control rows in the UI. The long explanation of what
// each kind is lives in the label's title tooltip in index.html — this
// panel stays to one short line per row.
const _CONTROL_UI = [
    { id: "safeTargeting", checkbox: "includeSafeTargeting", count: "safeTargetingCount", label: "Safe" },
    { id: "nonTargeting",  checkbox: "includeNonTargeting",  count: "nonTargetingCount",  label: "Non-targeting" }
]

// Refreshes the "Controls" panel: what each kind offers in the selected
// library and how many will be added. Called whenever the library, the
// symbol list or any of the control fields changes.
function _updateControlsStatus() {
    setTimeout(_alignSymbolColumn, 0)
    const box = document.getElementById("controlsStatus")
    if (!box || typeof LIB_controlInfo !== "function") return
    const info = LIB_controlInfo()
    const design = _estimateDesign()

    // The status box carries only what isn't visible elsewhere: the library's
    // control inventory is already in the citation panel on the left, and the
    // number being added is in the box itself. So this is limited to the
    // essential-gene names and any warning that a request exceeds stock.
    //
    // Where each kind would come from has to be settled before any box can be
    // filled in, because the suggested number is a total budget split between
    // the kinds that are ticked. A borrowed kind counts towards that split
    // exactly like a stocked one — Brunello, Brie and both GeCKO v2 libraries
    // carry non-targeting controls but no safe-targeting ones, so ticking both
    // there means one of each source.
    const source = {}
    for (const ui of _CONTROL_UI) {
        if (info[ui.id]) { source[ui.id] = { avail: info[ui.id], borrowed: null }; continue }
        // The library ships none of this kind. Rather than disabling the
        // option, offer to take them from the species-matched donor —
        // ticking the box is the opt-in.
        const borrowed = (typeof LIB_borrowedControlRows === "function")
            ? LIB_borrowedControlRows(ui.id, settings.librarySpecies, 0) : null
        source[ui.id] = (borrowed && borrowed.available)
            ? { avail: { count: borrowed.available }, borrowed: borrowed }
            : null
    }
    const sharing = _CONTROL_UI.filter(ui => {
        const cb = document.getElementById(ui.checkbox)
        return cb && cb.checked && source[ui.id]
    }).map(ui => ui.id)

    const lines = []
    for (const ui of _CONTROL_UI) {
        const cb = document.getElementById(ui.checkbox)
        const countInput = document.getElementById(ui.count)
        if (!cb || !countInput) continue
        if (!source[ui.id]) {
            cb.checked = false
            cb.disabled = true
            countInput.disabled = true
            _ctrlStepsEnabled(countInput, false)
            countInput.value = ""
            countInput.placeholder = ""
            delete countInput.dataset.auto
            lines.push(`${ui.label}: none available`)
            continue
        }
        const avail = source[ui.id].avail
        const borrowed = source[ui.id].borrowed
        cb.disabled = false
        countInput.disabled = !cb.checked
        _ctrlStepsEnabled(countInput, cb.checked)
        if (!cb.checked) {
            // Nothing in the box while the kind is off: a number beside an
            // unticked control reads as a number that is being used. One the
            // user typed is remembered and put back when they tick again,
            // rather than left on screen to say so.
            _ctrlPark(countInput)
            continue
        }
        _ctrlRestore(countInput)
        // Put the suggested number in the box so the user sees a concrete
        // value they can edit. The placeholder carries the same number, so
        // clearing the box still shows what the run will fall back to.
        const suggested = SCR_suggestedControlCount(design.genes, design.guidesPerGene,
                                                    avail.count, sharing, ui.id)
        countInput.placeholder = String(suggested)
        if (countInput.dataset.auto !== "0") {
            countInput.value = String(suggested)
            countInput.dataset.auto = "1"
        }
        const raw = parseInt(countInput.value, 10)
        if (borrowed) {
            const n = (!isNaN(raw) && raw > 0) ? Math.min(raw, borrowed.available) : suggested
            lines.push(`${ui.label}: none in this library &mdash; adding <b>${n}</b> borrowed from ${_escapeHtml(borrowed.source)}` +
                       (borrowed.available < 50 ? ` (only ${borrowed.available} fit this library's guide design)` : ""))
        } else if (!isNaN(raw) && raw > avail.count) {
            lines.push(`${ui.label}: only ${avail.count} in this library &mdash; adding all ${avail.count}`)
        }
    }

    const essCb = document.getElementById("includeEssential")
    const essCount = document.getElementById("essentialCount")
    if (essCb && essCount) {
        essCount.disabled = !essCb.checked
        _ctrlStepsEnabled(essCount, essCb.checked)
        if (!essCb.checked) {
            _ctrlPark(essCount)
        } else if (typeof LIB_essentialPanel === "function") {
            _ctrlRestore(essCount)
            essCount.placeholder = String(_ESSENTIAL_DEFAULT)
            if (essCount.dataset.auto !== "0") {
                essCount.value = String(_ESSENTIAL_DEFAULT)
                essCount.dataset.auto = "1"
            }
            const n = parseInt(essCount.value, 10)
            const panel = LIB_essentialPanel(isNaN(n) || n <= 0 ? _ESSENTIAL_DEFAULT : n)
            lines.push(`Positive controls: ${panel.map(g => g.toUpperCase()).join(", ")}`)
        }
    }

    // Sync the control settings from whatever the boxes now hold — this runs
    // after the pre-fill above, so settings never lag a keystroke behind.
    SET_settingsSetControls({
        includeSafeTargeting: document.getElementById("includeSafeTargeting").checked,
        safeTargetingCount: document.getElementById("safeTargetingCount").value,
        includeNonTargeting: document.getElementById("includeNonTargeting").checked,
        nonTargetingCount: document.getElementById("nonTargetingCount").value,
        includeEssential: essCb ? essCb.checked : false,
        essentialCount: essCount ? essCount.value : ""
    })

    box.innerHTML = lines.join("<br>")
}

function updateCustomlibrary() {
    const fileInput = document.getElementById('customFile')
    const file = fileInput.files[0]

    if (file) {
        const reader = new FileReader()
        reader.onload = function (e) {
            var content = e.target.result
            if (file.name.endsWith(".csv")) {
                content = content.replaceAll(",", "\t")
            }

            SER_selectCustomLibrary(content, settings)
            _statusUpdateSymbols()
            //console.log("updateCustomlibrary() file")
        }

        reader.onerror = function (e) {
            console.error("Error reading file:", e)
        }

        reader.readAsText(file)
    } else {
        SER_selectCustomLibrary("", settings)
        //console.log("updateCustomlibrary() no file")
    }

}

function _updateExampleText() {
    // The preview's own height is fixed, but the panels around it are not.
    setTimeout(_alignSymbolColumn, 0)
    // Displays the word SPACER between the adapters, trimmed as a spacer
    // would be. It was SEQUENCE, which named nothing in particular: the whole
    // line is a sequence, and the part in the middle is the spacer.
    // Assembled from the parts rather than by searching the finished string,
    // so the guide stays highlighted even when a trim setting eats into it.
    const middle = _applyTrim("SPACER")
    const before = (settings.adapterBefore || "").toLowerCase()
    const after = (settings.adapterAfter || "").toLowerCase()
    // With no adapters entered there is nothing to preview, and the box goes
    // away rather than holding a line of text explaining itself. It used to
    // stay put because appearing and disappearing knocked this column out of
    // line with the one beside it; the alignment is measured now, and
    // measured again here, so the space can be given back.
    const el = document.getElementById("ExampleSequance")
    if (!before && !after) {
        el.className = ""
        el.textContent = ""
        if (typeof APP_realign === "function") APP_realign()
        return
    }
    el.className = ""
    el.innerHTML =
        `${_escapeHtml(before)}<span class="seqSlot">${_escapeHtml(middle)}</span>${_escapeHtml(after)}`
    if (typeof APP_realign === "function") APP_realign()
}

// =============================================================================
// Scrolling behind a popout
// =============================================================================
//
// Ten modals, each shown by putting `fazeIn` on its overlay and hidden by
// putting `fazeOut` there. With the page behind still scrollable, a finger
// that started on the overlay — or that reached the end of the popout's own
// scroll — carried on scrolling the app underneath, so closing the popout
// left the user somewhere else entirely.
//
// Watched rather than wired into each open and close: there are ten of them
// opened from six files, and a rule that has to be remembered at twenty call
// sites is a rule that will be missed at one of them.
//
// iOS needs more than `overflow: hidden`, which it ignores on the body, so
// the body is fixed in place and offset by the scroll position; that is also
// why the position has to be put back by hand afterwards.
var _modalScrollY = 0

function _modalAnyOpen() {
    return [...document.querySelectorAll(".upset-modal-overlay")].some(m => m.classList.contains("fazeIn"))
}

function _modalLockScroll(lock) {
    const body = document.body
    if (lock === body.classList.contains("modal-open")) return
    if (lock) {
        _modalScrollY = window.scrollY || window.pageYOffset || 0
        // Holding the page still means fixing the body, and a fixed body
        // measures its width against the window rather than the space it was
        // sitting in. With 10% padding either side that made the whole box 20%
        // wider than the window, and everything behind the popout jumped out
        // with it; taking the scrollbar away widened it again. Pinned here to
        // what the page measured a moment ago, with the rule for the class
        // treating that as the whole box rather than the content.
        const width = document.documentElement.clientWidth
        body.style.top = `-${_modalScrollY}px`
        body.style.width = width + "px"
        body.classList.add("modal-open")
    } else {
        body.classList.remove("modal-open")
        body.style.top = ""
        body.style.width = ""
        window.scrollTo(0, _modalScrollY)
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const sync = () => _modalLockScroll(_modalAnyOpen())
    const obs = new MutationObserver(sync)
    for (const m of document.querySelectorAll(".upset-modal-overlay")) {
        obs.observe(m, { attributes: true, attributeFilter: ["class"] })
    }
    sync()
})

// Names that mean more than one gene.
//
// "p14" is an alias of eight genes in the human table — CDKN2A (p14ARF) is
// almost certainly the one meant, but CDK2AP2, LAMTOR2, RPP14, S100A9, SF3B6,
// SUB1 and CTNNBL1 all answer to it too. Matching took every one of them, so
// a list of one symbol quietly became a design against eight genes, reported
// as "Symbols found in library: 1 of 1". The ambiguity is now on screen with
// the genes to choose between, and choosing one replaces the alias in the box
// with a name that means exactly one thing.
function _renderAmbiguousSymbols(synonymMap) {
    const box = document.getElementById("symbolAmbiguous")
    if (!box) return
    box.innerHTML = ""
    box.hidden = true
    if (!synonymMap || !settings.enableSynonyms) return

    const ambiguous = Object.keys(synonymMap).filter(sym => (synonymMap[sym] || []).length > 1)
    if (ambiguous.length === 0) return

    const head = document.createElement("div")
    head.className = "symAmbigHead"
    head.textContent = ambiguous.length === 1
        ? "One name, several genes"
        : `${ambiguous.length} names match several genes each`
    box.appendChild(head)

    for (const symbol of ambiguous) {
        const genes = [...synonymMap[symbol]]
        const row = document.createElement("div")
        row.className = "symAmbigRow"

        const lead = document.createElement("span")
        lead.className = "symAmbigLead"
        lead.textContent = `${symbol} matches ${genes.length} genes:`
        row.appendChild(lead)

        for (const gene of genes) {
            const name = (typeof LIB_displaySymbol === "function")
                ? LIB_displaySymbol(gene) : String(gene).toUpperCase()
            const btn = document.createElement("button")
            btn.type = "button"
            btn.className = "symAmbigBtn"
            btn.textContent = name
            btn.title = `Use ${name} only`
            btn.addEventListener("click", () => _applySymbolReplacements({ [symbol]: name }))
            row.appendChild(btn)
        }
        box.appendChild(row)
    }

    const foot = document.createElement("div")
    foot.className = "symAmbigFoot"
    foot.textContent = "Every one of them is in the design until you pick. Press a gene to use that one on its own."
    box.appendChild(foot)
    box.hidden = false
}

// Spelling suggestions for symbols that matched nothing.
//
// A typo is invisible in the current output: "To53" produces "Symbols found in
// library: 0 of 1" and a line reading "to53", with nothing to say that TP53 is
// one keystroke away. Suggestions come from the selected library, so every one
// of them is a name that would actually return guides, and each is a button
// that puts it in the box.
//
// A whole list that misses — the wrong species, or a library that targets
// something else — is not a set of typos, and scanning the library once per
// symbol to prove it would be slow as well as useless. Past a dozen the panel
// says nothing.
const _SUGGEST_MAX_SYMBOLS = 12

function _renderSymbolSuggestions(unmatched) {
    const box = document.getElementById("symbolSuggestions")
    if (!box) return
    box.innerHTML = ""
    box.hidden = true
    if (!unmatched || unmatched.length === 0 || unmatched.length > _SUGGEST_MAX_SYMBOLS) return
    if (typeof SER_suggestSymbols !== "function") return

    const suggestions = SER_suggestSymbols(unmatched, 3)
    const symbols = Object.keys(suggestions)
    if (symbols.length === 0) return

    // Built as nodes rather than markup: a symbol is whatever the user typed
    // into the box, and it ends up inside a click handler.
    const head = document.createElement("div")
    head.className = "symSuggestHead"
    head.textContent = "Did you mean?"
    box.appendChild(head)

    for (const symbol of symbols) {
        const row = document.createElement("div")
        row.className = "symSuggestRow"
        const from = document.createElement("span")
        from.className = "symSuggestFrom"
        from.textContent = symbol
        const arrow = document.createElement("span")
        arrow.className = "symSuggestArrow"
        arrow.textContent = "→"
        row.appendChild(from)
        row.appendChild(arrow)
        for (const name of suggestions[symbol]) {
            const btn = document.createElement("button")
            btn.type = "button"
            btn.className = "symSuggestBtn"
            btn.textContent = name
            btn.addEventListener("click", () => _applySymbolReplacements({ [symbol]: name }))
            row.appendChild(btn)
        }
        box.appendChild(row)
    }

    // One button for the common case of a list with several slips in it, each
    // taking the closest name. The individual buttons stay for anything where
    // the first guess is not the right one.
    if (symbols.length > 1) {
        const all = document.createElement("button")
        all.type = "button"
        all.className = "symSuggestAll"
        all.textContent = `Use the first suggestion for all ${symbols.length}`
        all.addEventListener("click", () => {
            const map = {}
            for (const [sym, names] of Object.entries(suggestions)) map[sym] = names[0]
            _applySymbolReplacements(map)
        })
        box.appendChild(all)
    }

    box.hidden = false
    // The panel starts folded on a phone, and a suggestion nobody can see is
    // no better than none.
    if (typeof PHONE_openPanel === "function") PHONE_openPanel(/^Symbols not found/i)
}

// Swap one or more symbols for suggested spellings, keeping everything else in
// the box as it was typed.
function _applySymbolReplacements(map) {
    const input = document.getElementById("searchSymbols")
    if (!input) return
    const lower = {}
    for (const [from, to] of Object.entries(map)) lower[String(from).toLowerCase()] = to
    const replaced = SYM_split(input.value).map(token => {
        const hit = lower[token.toLowerCase()]
        return hit == null ? token : hit
    })
    // Repeats can appear if the suggestion is already in the list further down.
    const seen = new Set()
    input.value = replaced.filter(t => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).join("\n")
    changeSymbols()
}

// The last matching pass, so a status line written by something else — the
// curated-list adder, say — can say how many of what it added actually exist
// in the library instead of only how many it put in the box.
var _lastSymbolMatch = null

async function _displaySymbolsNotFound(synonymMap) {
    //Creates and displays everything under the Symbols not found sub title under 2. Input symbols in HTMl
    if (settings.partialMatches) {
        _setStatus("statusSearchSymbolsRows", ``)
        const synonymsUsed = document.getElementById("displaySynonyms")
        synonymsUsed.value = "Not available"
        _renderSymbolSuggestions([])
        _renderAmbiguousSymbols(null)
        APP_realign()
    }
    else {
        const synonymsUsed = document.getElementById("displaySynonyms")
        var displayText = ""

        var numSynonyms = 0
        var numNotFound = 0
        const unmatched = []
        Object.keys(synonymMap).forEach(symbol => {
            if (settings.enableSynonyms && (synonymMap[symbol].length != 0)) {

                displayText = `${symbol} → ${[...synonymMap[symbol]].join(', ')}\n${displayText}`
                numSynonyms = numSynonyms + synonymMap[symbol].length
            }
            else {
                displayText = `${displayText}${symbol}\n`
                numNotFound++
                unmatched.push(symbol)
            }
        })
        synonymsUsed.value = displayText
        _renderSymbolSuggestions(unmatched)
        _renderAmbiguousSymbols(synonymMap)
        APP_realign()

    }

    settings.enableSynonyms ? _setStatus("statusNumSynonyms", `(used: ${numSynonyms})`) : _setStatus("statusNumSynonyms", ``)
    _lastSymbolMatch = settings.partialMatches ? null
        : { found: settings.searchSymbols.length - numNotFound, total: settings.searchSymbols.length }
    settings.partialMatches ? _setStatus("statusSearchSymbolsRows", ``) : _setStatus("statusSearchSymbolsRows", `Symbols found in library: ${settings.searchSymbols.length - numNotFound} of ${settings.searchSymbols.length}`)

}

/* ------------------ STATUS ----------------- */

// Symbols and sgRNA sequences can be pasted in whatever shape they arrive:
// one per line, comma separated out of a spreadsheet, semicolons, tabs or
// plain spaces, in any mixture. Splitting on those is safe because no gene
// symbol in any built-in library contains one — the only punctuation they
// carry is - | . and _, which are left intact.
function SYM_split(text) {
    return String(text == null ? "" : text)
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
}

function _statusUpdateSymbols() {
    const synonymMap = SER_getSynonymMap(settings.searchSymbols)
    _displaySymbolsNotFound(synonymMap)

    const statusSymbols = SER_statusLibrarySymbols()
    _setStatus("symbolsFound", statusSymbols)

    // Tidy the box — trim blanks and drop repeats — but keep the user's own
    // spelling. settings.searchSymbols is lower-cased for matching, and writing
    // that back turned every symbol into "tp53" or "trp53", against both HUGO
    // and MGI convention. Matching is case-insensitive, so the case here is
    // presentation only.
    const seen = new Set()
    const tidied = SYM_split(document.getElementById("searchSymbols").value)
        .filter(s => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    _setStatus("searchSymbols", tidied.join("\n"), false)

    document.getElementById("fileContentContainer").style.display = "none"

    document.getElementById("outputTable").classList.add("statusFadeOut")
}

function _statusUpdateSettings() {
    document.getElementById("outputTable").classList.add("statusFadeOut")
    document.getElementById("fileContentContainer").style.display = "none"
    _updateExampleText()
}

function _statusSearchUpdate() {
    _setStatus("statusSearch", LIB_statusScreening())
}


function _setStatus(elemId, text, isNotInnerHtml) {
    //console.log(`_setStatus(${elemId},${text})`)

    if (isNotInnerHtml == undefined) {
        isNotInnerHtml = true
    }
    const element = document.getElementById(elemId)
    if (!element) {
        console.error(`Index.js: _setStatus() Element with id '${elemId}' does not exist`)
        return
    }
    if ((element.textContent == text) && isNotInnerHtml) {
        return
    }
    if ((element.value == text) && !isNotInnerHtml) {
        return
    }
    // The new text is written when the fade-out finishes. Two things can stop
    // that event ever arriving: re-adding a class the element already carries
    // does not restart its animation, and an element that is hidden does not
    // animate at all. Either way the text would silently stay stale — which
    // is what used to leave the MAGeCK, run-settings and methods views empty.
    // So the animation is restarted explicitly, and a timer applies the text
    // regardless if the event does not come.
    var applied = false
    const apply = function () {
        if (applied) return
        applied = true
        if (isNotInnerHtml) {
            element.innerHTML = text;
        }
        else {
            element.value = text;
        }

        element.classList.remove("statusFadeOut"); // Remove class to fade in the new text
        element.classList.add("statusFadeIn"); // Add class to fade in the new text
    }

    element.classList.remove("statusFadeIn");
    element.classList.remove("statusFadeOut");
    void element.offsetWidth;                  // reflow, so the animation replays
    element.classList.add("statusFadeOut");    // Add class to fade out the old text

    element.addEventListener("animationend", apply, { once: true });
    // Just past the 0.2s animation, so the fade still plays when it can.
    setTimeout(apply, 250);

    if (text.includes("Failed") || text.includes("Error")) {
        element.style.color = "red";
    } else {
        element.style.color = "";
    }

}

// =============================================================================
// Validate sgRNA — species picker modal (consolidates the old Mouse / Human
// buttons into one button that asks which genome to validate against)
// =============================================================================

// Curated gene lists — starting sets for the symbol box, loaded lazily from
// geneSets.json the first time the picker is opened. Each set was resolved
// against the built-in human libraries when the file was built, so every
// symbol in it is one some library can actually target.
var _setsState = { bySpecies: null, loading: null, sets: null,
                   // Every curated list added to the box this session, so the
                   // run can say where its genes came from. What is actually
                   // reported is checked against the box at the time, since
                   // the list can be edited freely afterwards.
                   used: [] }

// The curated lists whose genes are still in the box, with how many of each
// survived. A list the user has since deleted from the box is dropped rather
// than claimed.
// Takes either the raw box contents or the array of symbols a run was given,
// since the methods text describes the run and the on-screen note describes
// the box.
function SETS_usedInText(symbols) {
    if (!_setsState.used || !_setsState.used.length) return []
    const list = Array.isArray(symbols)
        ? symbols
        : String(symbols || "").split(/\r?\n/)
    const inBox = new Set(list.map(x => String(x).trim().toUpperCase()).filter(Boolean))
    if (!inBox.size) return []
    const out = []
    for (const u of _setsState.used) {
        var present = 0
        for (const g of u.genes) if (inBox.has(g.toUpperCase())) present++
        if (present > 0) out.push({ label: u.label, source: u.source, total: u.genes.length, present: present })
    }
    return out
}

// The line above "Symbols not found".
function _setsUsedRender() {
    const el = document.getElementById("setsUsedNote")
    if (!el) return
    const box = document.getElementById("searchSymbols")
    const used = SETS_usedInText(box ? box.value : "")
    if (!used.length) { el.style.display = "none"; el.innerHTML = ""; return }
    el.style.display = ""
    el.innerHTML = `From curated ${used.length === 1 ? "list" : "lists"}: ` +
        used.map(u => `<b>${_escapeHtml(u.label)}</b> ` +
            `(${u.present === u.total ? `${u.total} genes` : `${u.present} of ${u.total} genes still in the box`})` +
            `<span class="setsUsedSrc"> — ${_escapeHtml(u.source)}</span>`).join("; ")
}

// Which species' lists to show. Every built-in library declares its species
// through the synonym list it uses; an uploaded library has none, so it falls
// back to whichever synonym list the user picked, and to human when that is
// the combined list or unset. A mouse library must never be offered human
// symbols — almost none of them would match.
function _setsSpecies() {
    var name = (settings && settings.librarySpecies) || ""
    if (!name) {
        const sel = document.getElementById("synonymSelect")
        name = sel ? sel.value : ""
    }
    return /mouse/i.test(name) && !/human/i.test(name) ? "Mouse" : "Human"
}

async function SETS_openModal() {
    document.getElementById("setsModal").className = "fazeIn upset-modal-overlay"
    const list = document.getElementById("setsList")
    if (!_setsState.bySpecies) {
        list.innerHTML = `<p style="font-size:0.85rem; color:#6b7280;">Loading&hellip;</p>`
        try {
            if (!_setsState.loading) _setsState.loading = FH_fetchJsonFile("geneSets.json")
            const data = await _setsState.loading
            _setsState.bySpecies = data.species || {}
        } catch (e) {
            console.error("Could not load geneSets.json:", e)
            list.innerHTML = `<p style="font-size:0.85rem; color:#b91c1c;">Could not load the curated lists.</p>`
            return
        }
    }
    const species = _setsSpecies()
    _setsState.sets = _setsState.bySpecies[species] || []
    const label = document.getElementById("setsSpecies")
    if (label) label.textContent = species.toLowerCase()
    _renderSetsList()
}

function SETS_closeModal() {
    document.getElementById("setsModal").className = "fazeOut upset-modal-overlay"
}

// Keep a loaded curated list in step with the library's species.
//
// A species mismatch is easy to miss, because matching is case-insensitive and
// most orthologues share their letters — a human kinase list run against a
// mouse library still resolves 456 of 468 symbols. The danger is the handful
// that do not: those fall through to the synonym table, which can resolve an
// ambiguous alias to a DIFFERENT gene, so the output quietly carries guides
// for something else. Swapping the list removes that whole class of error.
//
// Only a list the user has not edited is swapped; an edited one is theirs, so
// the mismatch is reported instead.
// Case- and whitespace-insensitive fingerprint of the symbol box, used to tell
// an untouched curated list from an edited one. The box gets tidied and may be
// re-cased after loading, so comparing the raw text would read every list as
// edited and the species swap would never fire.
function _setsSignature(text) {
    return text.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean).join("\n")
}

async function SETS_syncToLibrary() {
    const loaded = _setsState.loaded
    const box = document.getElementById("searchSymbols")
    if (!loaded || !box) return
    const species = _setsSpecies()
    if (species === loaded.species) return
    if (_setsSignature(box.value) !== loaded.text) {
        _setStatus("statusSearchSymbolsRows",
            `Note: these symbols were loaded as a ${loaded.species.toLowerCase()} list, but the library is ${species.toLowerCase()}.`)
        return
    }
    try {
        if (!_setsState.bySpecies) {
            if (!_setsState.loading) _setsState.loading = FH_fetchJsonFile("geneSets.json")
            _setsState.bySpecies = (await _setsState.loading).species || {}
        }
    } catch (e) {
        console.warn("Could not switch the curated list species:", e)
        return
    }
    const set = (_setsState.bySpecies[species] || []).find(s => s.key === loaded.key)
    if (!set) return
    box.value = set.genes.join("\n")
    _setsState.loaded = { key: set.key, species: species, text: _setsSignature(box.value) }
    _setsState.used = [{ key: set.key, label: set.label, source: set.source, genes: set.genes.slice() }]
    changeSymbols()
    _setStatus("statusSearchSymbolsRows",
        `${set.label}: switched to the ${species.toLowerCase()} list, ${set.genes.length} genes`)
}

function _renderSetsList() {
    const list = document.getElementById("setsList")
    list.innerHTML = _setsState.sets.map((s, i) => `
        <div class="gene-set-row">
            <div>
                <div><b>${_escapeHtml(s.label)}</b> <span class="gene-set-count">${s.genes.length} genes</span></div>
                <div class="gene-set-desc">${_escapeHtml(s.description)}</div>
                <div class="gene-set-src">Source: ${_escapeHtml(s.source)}</div>
            </div>
            <span style="display:flex; gap:6px; align-items:center; white-space:nowrap;">
                <button class="validate-btn" onclick="SETS_load(${i})">Add</button>
            </span>
        </div>`).join("")
}

// Put a set into the symbol box. "Add" merges with what's already there —
// building a screen from two or three classes is the common case, and
// retyping the first list to add a second would be tedious. Duplicates are
// dropped, so adding an overlapping set is safe.
// Adding is the only action: the box starts empty, so adding to an empty box
// is what "replace" used to do, and adding to a filled one is the only other
// thing anyone wanted. Duplicates are dropped either way.
function SETS_load(index) {
    const set = _setsState.sets[index]
    if (!set) return
    const box = document.getElementById("searchSymbols")
    const existing = box.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    // A list added to an empty box is still that list, so it can follow a
    // change of library species. Added to a filled one it becomes a mixture
    // that belongs to no set, and is not tracked.
    const wasEmpty = existing.length === 0
    const seen = new Set(existing.map(s => s.toUpperCase()))
    const merged = existing.slice()
    for (const g of set.genes) {
        if (seen.has(g.toUpperCase())) continue
        seen.add(g.toUpperCase())
        merged.push(g)
    }
    box.value = merged.join("\n")
    // Remember a whole list so it can follow a library species change. An
    // appended list leaves a mixture that is nobody's set, so forget it.
    _setsState.loaded = wasEmpty
        ? { key: set.key, species: _setsSpecies(), text: _setsSignature(box.value) }
        : null
    // Remember the list itself, for the note above "Symbols not found" and
    // for the methods text. Adding the same list twice records it once.
    if (!_setsState.used.some(u => u.key === set.key)) {
        _setsState.used.push({ key: set.key, label: set.label, source: set.source, genes: set.genes.slice() })
    }
    changeSymbols()
    SETS_closeModal()
    // changeSymbols has just rematched the box, so the counts are current.
    // Saying only how many genes went in was the least useful half of it:
    // a list of 3,309 surface genes may only have 2,800 in the library, and
    // that difference is the one worth seeing before pressing Run.
    const m = _lastSymbolMatch
    const n = x => x.toLocaleString("en-US")
    _setStatus("statusSearchSymbolsRows",
        `${set.label}: ${n(set.genes.length)} genes added, ${n(merged.length)} in the box` +
        (m ? `, ${n(m.found)} of ${n(m.total)} found in the library` : ""))
}

// Which build this page is running.
//
// Every script and stylesheet in index.html carries the release number as a
// ?v= on its src, bumped on each release so a browser holding the old file
// fetches the new one. index.html itself has no such marker, so a browser
// that has cached the page keeps serving the whole old app: the version in
// these URLs is the only statement of which build is on screen, and it is
// what a check for a newer one compares against.
function APP_version() {
    const el = document.querySelector('script[src*="index.js"]')
    const m = el && /[?&]v=([\d.]+)/.exec(el.getAttribute("src") || "")
    return m ? m[1] : null
}

// Is there a newer build on the server? Returns its version, or null.
//
// Fetches the page itself past the cache and reads the version out of it.
// Nothing is compared numerically: any difference means the server is serving
// something other than what is running here, which is what matters.
async function APP_newVersionAvailable() {
    const here = APP_version()
    if (!here) return null
    try {
        const res = await fetch(location.pathname + "?_=" + Date.now(), { cache: "no-store" })
        if (!res.ok) return null
        const m = /index\.js\?v=([\d.]+)/.exec(await res.text())
        return (m && m[1] !== here) ? m[1] : null
    } catch (e) {
        // Offline, or the page was opened from a file. Neither is a reason to
        // interrupt a reset.
        return null
    }
}

// "Reset app" in the tool strip — back to how the app opens, without a page
// reload. A reload would work too, but it would throw away the library file
// and the copy-number matrix, and re-fetching 62 MB to clear a form is not a
// reasonable trade. Everything reset here is cheap to retype; the expensive
// data stays in memory.
async function TOOL_resetApp() {
    if (typeof _validateState !== "undefined" && _validateState.isValidateMode) {
        toggleValidateMode(_validateState.activeSpecies)
    } else if (typeof _cnState !== "undefined" && _cnState.isMode) {
        _cnExitMode()
    }
    outputTexts = {}
    if (typeof _cnState !== "undefined") {
        _cnState.screeningCellLines = []
        _cnState.results = null
        _cnState.tsvOutput = null
        _cnState.selectedCellLines = []
    }
    if (typeof _setsState !== "undefined") { _setsState.loaded = null; _setsState.used = [] }
    const cellLine = document.getElementById("screeningCellLineInput")
    if (cellLine) cellLine.value = ""
    const cellLineStatus = document.getElementById("screeningCellLineStatus")
    if (cellLineStatus) cellLineStatus.textContent = ""
    // The count boxes go back to tracking the suggestion rather than keeping
    // whatever was typed.
    for (const id of ["safeTargetingCount", "nonTargetingCount", "essentialCount"]) {
        const el = document.getElementById(id)
        if (el) { el.value = ""; delete el.dataset.auto }
    }
    document.querySelectorAll("#outputTable button[data-show]").forEach(b => b.classList.remove("show-active"))
    const row = document.getElementById("cnAnnotationOutputRow")
    if (row) row.style.display = "none"
    document.getElementById("outputTable").style.display = "none"
    document.getElementById("fileContentContainer").style.display = "none"
    await init()
    _setStatus("statusSearch", "")
    _focusSymbolBox()

    // A reset is the one moment when reloading costs nothing: everything that
    // would be thrown away has just been thrown away deliberately. So it is
    // also where a browser sitting on a cached copy of the app can be moved on
    // to the current one. The check runs after the reset, so the button stays
    // instant whether or not there is an update, and does nothing at all when
    // the version on the server is the version already running.
    const newer = await APP_newVersionAvailable()
    if (!newer) return
    _setStatus("statusSearch", `Version ${newer} is available. Loading it now…`)
    // A new address rather than reload(), which is free to answer from the
    // same cache that is holding the old page.
    setTimeout(() => location.replace(location.pathname + "?v=" + encodeURIComponent(newer)), 900)
}

// "sgRNA design" in the tool strip — returns to the main flow from whichever
// takeover mode is running. Already being in design mode is a no-op, so the
// button is safe to click at any time. The highlight itself is pure CSS off
// the body mode class, so nothing here has to maintain it.
function TOOL_showDesign() {
    if (typeof _validateState !== "undefined" && _validateState.isValidateMode) {
        toggleValidateMode(_validateState.activeSpecies)
        return
    }
    if (typeof _cnState !== "undefined" && _cnState.isMode) {
        _cnExitMode()
    }
}

function openValidateSpeciesModal() {
    // Toggle off if already in validate mode — restores design mode.
    if (_validateState.isValidateMode) {
        toggleValidateMode(_validateState.activeSpecies)
        return
    }
    document.getElementById("validateSpeciesModal").className = "fazeIn upset-modal-overlay"
}
function closeValidateSpeciesModal() {
    document.getElementById("validateSpeciesModal").className = "fazeOut upset-modal-overlay"
}
function confirmValidateSpecies(species) {
    closeValidateSpeciesModal()
    toggleValidateMode(species)
}

// =============================================================================
// Copy-number reference (DepMap human) — picker modal + lookup mode
// =============================================================================

// Module-level state for the CN mode. Mirrors _validateState in shape.
var _cnState = {
    isMode: false,            // are we currently in CN-lookup mode?
    selectedCellLines: [],    // working set for the CN-mode modal picker
    screeningCellLines: [],   // section-3 single-line annotation slot (array of 0 or 1)
    fullCatalog: [],        // populated from CN_listCellLines() once loaded
    results: null,            // { rows: [{gene, perLine: {id: {value, tier}}}], notFound: [genes] }
    tsvOutput: ""             // TSV of the results table for download
}

// The run status line, as a progress readout for the copy-number download.
// _setStatus animates, which would make every chunk blink, so this writes the
// element directly.
function _cnRunProgress() {
    return p => {
        const el = document.getElementById("statusSearch")
        if (!el) return
        const mbR = (p.received / 1048576).toFixed(1)
        const mbT = p.total ? (p.total / 1048576).toFixed(1) : "60"
        const pct = p.total ? Math.round(100 * p.received / p.total) : 0
        if (p.phase === "downloading") {
            el.innerHTML = `<span class="cnLoadSpin"></span>Loading copy-number data — ${mbR} / ${mbT} MB (${pct}%)`
        } else if (p.phase === "decoding") {
            el.innerHTML = `<span class="cnLoadSpin"></span>Unpacking copy-number data…`
        }
    }
}

async function CN_openModal() {
    // Toggling off — leave CN mode and clear selection.
    if (_cnState.isMode) {
        _cnExitMode()
        return
    }
    const modal = document.getElementById("cnModal")
    modal.className = "fazeIn upset-modal-overlay"
    document.getElementById("cnPickerStatus").textContent = "Loading the cell-line list…"
    document.getElementById("cnPickerConfirmBtn").disabled = true
    _cnState.selectedCellLines = []
    _updateCnPickerSelectedCount()
    // Wire the download-progress bar — only meaningful on the first open
    // of this session (subsequent opens hit the warm cache and the bar
    // stays hidden because no "downloading" event fires).
    const progBox = document.getElementById("cnDownloadProgress")
    const progBar = document.getElementById("cnDownloadBar")
    const progEta = document.getElementById("cnDownloadEta")
    const progLbl = document.getElementById("cnDownloadLabel")
    if (CN_isLoaded() || !_CN_STATE.loading) {
        // No matrix fetch under way: the picker needs only the catalog, so
        // there is nothing to show a bar for. (A background prefetch that is
        // already running does light it up.)
        if (progBox) progBox.style.display = "none"
    } else {
        if (progBox) progBox.style.display = "block"
        if (progBar) progBar.style.width = "0%"
        if (progEta) progEta.textContent = "starting…"
        CN_onProgress(p => {
            if (!progBox) return
            const mbR = (p.received / 1048576).toFixed(1)
            const mbT = p.total ? (p.total / 1048576).toFixed(1) : "?"
            const pct = p.total ? Math.round(100 * p.received / p.total) : 0
            if (p.phase === "downloading") {
                progBar.style.width = pct + "%"
                progLbl.textContent = `Loading copy-number data — ${mbR} / ${mbT} MB (${pct}%)`
                if (p.received > 0 && p.elapsedMs > 200 && p.total > 0) {
                    const rateBps = p.received / (p.elapsedMs / 1000)
                    const remainSec = (p.total - p.received) / rateBps
                    progEta.textContent = remainSec < 1 ? "< 1 s left"
                                        : remainSec < 60 ? `~${Math.ceil(remainSec)} s left`
                                        : `~${Math.ceil(remainSec / 60)} min left`
                }
            } else if (p.phase === "decoding") {
                progBar.style.width = "100%"
                progLbl.textContent = `Decompressing & decoding (${mbR} MB)…`
                progEta.textContent = "almost there"
            } else if (p.phase === "done") {
                progLbl.textContent = `Loaded ${mbR} MB in ${(p.elapsedMs/1000).toFixed(1)} s`
                progEta.textContent = "✓"
                // Fade out after a short delay so the user sees the success state.
                setTimeout(() => { if (progBox) progBox.style.display = "none" }, 1500)
            }
        })
    }
    try {
        await CN_loadCatalogIfNeeded()
        _cnState.fullCatalog = CN_listCellLines()
        document.getElementById("cnPickerStatus").textContent =
            `${_cnState.fullCatalog.length} human cell lines available. Type to filter; click rows to (de)select.`
        _renderCnPicker(_cnState.fullCatalog)
        _renderCnPickerExamples()
    } catch (err) {
        document.getElementById("cnPickerStatus").textContent = "Failed to load: " + err.message
        if (progBox) progBox.style.display = "none"
    }
}
function CN_closeModal() {
    document.getElementById("cnModal").className = "fazeOut upset-modal-overlay"
}

// Escape text before it is interpolated into markup. Everything the app
// renders as a table has passed through a user's textarea, an uploaded
// library file, or a downloaded dataset, so none of it is guaranteed free of
// &, <, > or quotes. Safe for HTML and SVG text nodes and for double-quoted
// attribute values.
// Neutralise a value that a spreadsheet would treat as a formula. Excel and
// Sheets execute a cell beginning with = + - @ (or a leading tab/CR), so a
// gene symbol from a pasted list or an uploaded library could run when the
// designed library is opened — and these files get emailed to collaborators
// and to synthesis vendors. Real symbols and sgRNA sequences never start with
// those characters, so the leading apostrophe only ever appears on input that
// had no business being there.
function _spreadsheetSafe(value) {
    const v = String(value == null ? "" : value)
    if (!/^[=+\-@\t\r]/.test(v)) return v
    // A negative number is data, not a formula. Several libraries carry
    // negative on-target scores (Jacquere runs from -1.4), and quoting those
    // would land them in the spreadsheet as text and break sorting.
    if (v !== "" && Number.isFinite(Number(v))) return v
    return "'" + v
}

function _escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

function _sexGlyph(sex) {
    // ♀ / ♂ / ? glyph for the cell-line picker rows and result-table
    // headers, matching the visual language used elsewhere in the lab's
    // apps (Correlate, MouseCLB).
    const s = (sex || "").toLowerCase()
    if (s === "female") return `<span style="color:#db2777; font-weight:700;" title="Female">♀</span>`
    if (s === "male")   return `<span style="color:#1d4ed8; font-weight:700;" title="Male">♂</span>`
    return `<span style="color:#9ca3af; font-weight:700;" title="Sex unknown / not recorded">?</span>`
}

function _wgdBadge(wgd, ploidy) {
    // Small "WGD" pill for lines that have undergone whole-genome doubling
    // (the genome was duplicated at some point in the line's history, so
    // the baseline is ~tetraploid). Shown next to the cell-line name
    // everywhere the line appears so the user knows the "≈ N copies"
    // estimates were scaled against a tetraploid rather than diploid
    // baseline. The tooltip states the nominal ×4 rule that
    // CN_approxCopies actually applies — the measured ploidy shown next
    // to the pill is context, not the multiplier.
    if (wgd !== true) return ""
    return ` <span title="Whole-genome-doubled: this line's genome was duplicated at some point, so its baseline is roughly tetraploid (≈ 4 copies of each gene, not 2). DepMap reports CN relative to that line-specific baseline, and the &lsquo;≈ N copies&rsquo; column multiplies by a nominal 4 for WGD lines (round(CN × 4)) rather than by the line's measured fractional ploidy, so the estimate stays a whole number." style="font-size:0.65rem; padding:1px 4px; border-radius:6px; background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-weight:600; letter-spacing:0.03em;">WGD</span>`
}

// Canonical gene/line combinations the user can click to pre-fill the
// picker — chosen because they show CN values far from baseline and
// illustrate the kind of biology the feature is meant to surface.
// `cancerLine` is the DepMap canonical CellLineName. Verified against
// the current binary: every CN value listed in `note` is what the
// matrix actually returns at the time these examples were added.
const _CN_EXAMPLES = [
    { genes: ["MDM2"],   line: "SJSA-1",     note: "osteosarcoma, massive MDM2 amplification" },
    { genes: ["MYCN"],   line: "IMR-32",     note: "neuroblastoma, MYCN amplified" },
    { genes: ["ERBB2"],  line: "SK-BR-3",    note: "HER2-amplified breast cancer" },
    { genes: ["EGFR"],   line: "A-431",      note: "EGFR-amplified epidermoid carcinoma" },
    { genes: ["CDKN2A"], line: "U-87 MG",    note: "glioblastoma, CDKN2A deep deletion" },
    { genes: ["RB1"],    line: "WERI-Rb-1",  note: "retinoblastoma, RB1 homozygous deletion" },
]

function _renderCnPickerExamples() {
    const box = document.getElementById("cnPickerExamples")
    if (!box) return
    // Build an inline text list of headline combinations (e.g.
    // "MDM2 in SJSA-1, RB1 in WERI-Rb-1, …") for context, then a
    // single button that loads the whole panel — every example gene
    // across every example cell line — so the user sees the full
    // amp/del contrast in one click.
    const items = _CN_EXAMPLES.map(ex => `<b>${ex.genes.join(", ")}</b> in ${ex.line}`).join("; ")
    box.innerHTML = `
        <div style="font-size:0.78rem; color:#6b7280; margin-bottom:6px; line-height:1.5;">
            <span style="font-weight:600; color:#374151;">Classic examples to try:</span> ${items}.
        </div>
        <button class="validate-btn" onclick="CN_loadExamples()">Load examples &rarr;</button>`
}

function CN_loadExamples() {
    const list = _cnState.fullCatalog || []
    // Union of every gene and every cell line mentioned across all
    // _CN_EXAMPLES — one click loads the full panel.
    const allLineNames = new Set(_CN_EXAMPLES.map(e => e.line))
    const allGenes = [...new Set(_CN_EXAMPLES.flatMap(e => e.genes))]
    const matched = []
    const missed = []
    for (const name of allLineNames) {
        const cl = list.find(c => c.name === name) || list.find(c => c.stripped === name)
        if (cl) matched.push(cl); else missed.push(name)
    }
    if (missed.length) console.warn("CN examples: lines not found", missed)
    if (matched.length === 0) return
    _cnState.selectedCellLines = matched
    _cnState.pendingTestGenes = allGenes
    const search = document.getElementById("cnPickerSearch")
    if (search) search.value = ""
    CN_filterPicker()
    _updateCnPickerSelectedCount()
    CN_confirmSelection()
}

function _renderCnPicker(list) {
    // WGD is intentionally NOT shown in the picker — it only matters
    // once you're interpreting the CN values. The WGD pill + ploidy line
    // stay on the result-table headers.
    const selectedIds = new Set(_cnState.selectedCellLines.map(c => c.id))
    const html = list.map(c => {
        const sel = selectedIds.has(c.id)
        // Oncotree often duplicates the primaryDisease as the subtype when
        // there's no finer subclassification (Melanoma · Melanoma); skip
        // the subtype in that case so the row reads cleanly.
        const subtypeShown = c.subtype && c.subtype.toLowerCase() !== (c.disease || "").toLowerCase() ? c.subtype : ""
        const cancer = [c.disease, subtypeShown].filter(Boolean).join(" · ")
        return `<div class="cn-picker-row ${sel ? "selected" : ""}" onclick="CN_togglePickerRow('${c.id}')">
            <span>${sel ? "☑" : "☐"}</span>
            <span>
                <span class="cn-picker-name">${c.name}</span>
                <span class="cn-picker-meta">&nbsp;${_sexGlyph(c.sex)}${c.knownPloidy ? ` <span title="Measured ploidy (DepMap). ~2 for diploid, ~4 for whole-genome-doubled.">${c.ploidy.toFixed(1)}n${c.wgd ? " WGD" : ""}</span>` : ""}${c.lineage ? " &middot; " + c.lineage : ""}</span>
            </span>
            <span class="cn-picker-cancer" title="${cancer.replace(/"/g, "&quot;")}">${cancer}</span>
        </div>`
    }).join("")
    document.getElementById("cnPickerList").innerHTML = html
}

function CN_filterPicker() {
    const q = document.getElementById("cnPickerSearch").value.trim().toLowerCase()
    if (!q) { _renderCnPicker(_cnState.fullCatalog); return }
    // Word-prefix match per whitespace-separated token: the query must
    // align with the start of a word in the haystack. So "rectal" hits
    // "Rectal Adenocarcinoma" but not "Colorectal Adenocarcinoma"; "mel"
    // still works as a prefix for "Melanoma"; and "non small" matches
    // both "Non-" and "Small" in any order (hyphens, slashes, and
    // punctuation all count as word boundaries).
    const tokens = q.split(/\s+/).filter(Boolean)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const tokenRegexes = tokens.map(t => new RegExp("(^|[^a-z0-9])" + t, "i"))
    // Punctuation-insensitive fallback for the cell-line name/id: collapse
    // both the query and the name to bare alphanumerics so a user who omits
    // the hyphens/spaces still finds the line — "shsy5y" → "SH-SY5Y",
    // "u87mg" → "U-87 MG", "skbr3" → "SK-BR-3". Only kicks in for queries
    // of 2+ alphanumerics so a stray "-" doesn't match everything.
    const squash = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")
    const sq = squash(q)
    const filtered = _cnState.fullCatalog.filter(c => {
        const hay = [c.name, c.disease, c.subtype, c.lineage, c.id].join(" ")
        if (tokenRegexes.every(re => re.test(hay))) return true
        if (sq.length >= 2) {
            const names = [c.name, c.stripped, c.id].map(squash).join(" ")
            if (names.includes(sq)) return true
        }
        return false
    })
    _renderCnPicker(filtered)
}

function CN_togglePickerRow(id) {
    const idx = _cnState.selectedCellLines.findIndex(c => c.id === id)
    if (idx >= 0) {
        _cnState.selectedCellLines.splice(idx, 1)
    } else {
        const entry = _cnState.fullCatalog.find(c => c.id === id)
        if (entry) _cnState.selectedCellLines.push(entry)
    }
    _updateCnPickerSelectedCount()
    CN_filterPicker()  // re-render so the checkbox glyph flips
}

function _updateCnPickerSelectedCount() {
    const n = _cnState.selectedCellLines.length
    document.getElementById("cnPickerSelectedCount").textContent = String(n)
    document.getElementById("cnPickerConfirmBtn").disabled = (n === 0)
    const matrixBtn = document.getElementById("cnPickerMatrixBtn")
    if (matrixBtn) matrixBtn.disabled = (n === 0)
}

function CN_confirmSelection() {
    if (_cnState.selectedCellLines.length === 0) return
    CN_closeModal()
    _cnEnterMode()
}

// Typeahead handler for the "Pick cell line (human; optional)" input in
// section 3. Single cell line only. First keystroke triggers a lazy CN
// matrix load + datalist population; subsequent input is matched against
// the catalog and the screening-annotation slot is updated when an
// exact match is found.
let _screeningDatalistPopulated = false
function CN_handleScreeningCellLineInput() {
    // Wrap the body in a stored Promise so callers (notably runScreening)
    // can wait for the typeahead to finish resolving before deciding
    // whether a screening cell line was selected. Without this, pressing
    // "Load test data" and immediately "Run" can race past the still-
    // in-flight CN matrix load and skip the copy-number output.
    _cnState.screeningInputPromise = (async () => {
        const inp = document.getElementById("screeningCellLineInput")
        const status = document.getElementById("screeningCellLineStatus")
        const dl = document.getElementById("screeningCellLineList")
        if (!_screeningDatalistPopulated) {
            // Only the catalog — names, cancer types, ploidy. Typing here used
            // to pull the whole 62 MB matrix before the field would suggest
            // anything, which on a phone was a long dead pause and sometimes a
            // killed tab, for a step the user had not committed to yet. The
            // matrix now waits for Run. The spinner stays because even 1.5 MB
            // is a visible wait on a phone, and a still status line reads as a
            // hung app.
            if (status) {
                status.innerHTML = `<span class="cnLoadSpin"></span>` +
                    `<span id="screeningCellLineProgress">Loading the cell-line list…</span>`
            }
            try {
                await CN_loadCatalogIfNeeded()
            } catch (err) {
                if (status) status.textContent = "Could not load the cell-line list: " + err.message
                throw err
            }
            const list = CN_listCellLines()
            if (dl) {
                // One row per cell line, carrying the DepMap name. The
                // hyphen-stripped spelling used to be a second row of its own,
                // so PGA-1 and PGA1 read as two different lines when they are
                // one; it is now part of the row's description, which the
                // browser matches on as well, so typing either spelling still
                // finds it and what gets filled in is the real name.
                const opts = []
                for (const c of list) {
                    const alias = (c.stripped && c.stripped !== c.name) ? c.stripped + " · " : ""
                    const ann = [c.disease, c.lineage].filter(Boolean).join(" · ")
                    opts.push(`<option value="${_escapeHtml(c.name)}">${_escapeHtml(alias + ann)}</option>`)
                }
                dl.innerHTML = opts.join("")
            }
            _screeningDatalistPopulated = true
            if (status) status.textContent = ""
        }
        const val = inp.value.trim()
        const list = _cnState.fullCatalog && _cnState.fullCatalog.length
            ? _cnState.fullCatalog : CN_listCellLines()
        // Match the user's input against either the canonical name or the
        // stripped form (DepMap uses "A-375" / "A375" — both are correct).
        const key = val.toLowerCase()
        const match = list.find(c => c.name.toLowerCase() === key ||
                                     (c.stripped && c.stripped.toLowerCase() === key))
        const row = document.getElementById("cnAnnotationOutputRow")
        if (match) {
            // Put the DepMap spelling in the field. Typing "a375" or "A375"
            // finds the same line, but the name it is published under is
            // A-375, and that is the one to carry into an output file or a
            // methods section.
            if (val !== match.name) inp.value = match.name
            _cnState.screeningCellLines = [match]
            if (status) {
                const ploidy = match.knownPloidy ? ` &middot; ${match.ploidy.toFixed(1)}n${match.wgd ? " WGD" : ""}` : ""
                const cancer = [match.disease, match.lineage].filter(Boolean).join(" · ")
                // The 62 MB of copy-number values is not fetched until Run,
                // so say so here rather than letting the first Run look like a
                // stall.
                const pending = CN_isLoaded() ? ""
                    : `<div style="color:#6b7280;">Copy-number values (about 60 MB) load when you press Run.</div>`
                status.innerHTML = `<span style="color:var(--mainColor); font-weight:600;">✓ ${match.name}${ploidy}${cancer ? " &mdash; " + cancer : ""}</span>` + pending
            }
        } else {
            _cnState.screeningCellLines = []
            if (row) row.style.display = "none"
            if (status) status.textContent = val ? "No match yet. Pick a name from the suggestions." : ""
        }
    })()
    return _cnState.screeningInputPromise
}

function _cnEnterMode() {
    // Drop the user out of any other mode first.
    if (_validateState.isValidateMode) {
        toggleValidateMode(_validateState.activeSpecies)
    }
    _cnState.isMode = true
    document.body.classList.add("cn-mode")
    document.getElementById("outputTable").style.display = "none"
    document.getElementById("fileContentContainer").style.display = "none"
    const symbolsTitle = document.getElementById("symbolsTitle")
    const inputPlateTitle = document.getElementById("inputPlateTitle")
    _setSectionTitle("symbolsTitle",
        `Gene symbols (CN lookup in ${_cnState.selectedCellLines.length} cell line${_cnState.selectedCellLines.length === 1 ? "" : "s"}: ${_cnState.selectedCellLines.map(c => c.name).slice(0, 5).join(", ")}${_cnState.selectedCellLines.length > 5 ? ", …" : ""})`)
    _setSectionTitle("inputPlateTitle", "2. Input gene symbols")
    _setInputPlaceholder("cn")
    // If the user came in via a "classic example" chip, the gene list
    // was queued on _cnState.pendingTestGenes — pre-fill the textarea
    // and clear the queue so subsequent entries don't get stale.
    const pending = _cnState.pendingTestGenes
    if (pending && pending.length) {
        document.getElementById("searchSymbols").value = pending.join("\n")
        _cnState.pendingTestGenes = null
    } else {
        document.getElementById("searchSymbols").value = ""
    }
    _setStatus("statusSearchSymbolsRows", "")
}

function _cnExitMode() {
    _cnState.isMode = false
    _cnState.selectedCellLines = []
    document.body.classList.remove("cn-mode")
    const symbolsTitle = document.getElementById("symbolsTitle")
    const inputPlateTitle = document.getElementById("inputPlateTitle")
    _setSectionTitle("symbolsTitle", "Symbol matching")
    _setSectionTitle("inputPlateTitle", "2. Input symbols")
    _setInputPlaceholder("design")
    init()
}

async function CN_runLookup() {
    _toggleLigtBox()
    var statusText = document.getElementById("statusSearch")
    statusText.classList.add("pulse")
    await new Promise(r => setTimeout(r, 50))

    try {
        const raw = document.getElementById("searchSymbols").value
        const genes = [...new Set(SYM_split(raw))]
        if (genes.length === 0) {
            _setStatus("statusSearch", "Error: Please enter at least one gene symbol")
            _toggleLigtBox(); statusText.classList.remove("pulse"); return
        }
        if (!CN_isLoaded()) {
            _setStatus("statusSearch", "Loading copy-number data…")
            const onProgress = _cnRunProgress()
            CN_onProgress(onProgress)
            try { await CN_loadIfNeeded() } finally { CN_offProgress(onProgress) }
        }
        // Hand the active synonym map (loaded by the rest of the app) to
        // the CN service so unmapped symbols can still resolve. Without
        // this, MAGI3 → STK11 (or similar aliases) miss even though the
        // app's synonym mode is on.
        const synonymMap = (typeof _library !== "undefined" && _library && _library.synonymMap) ? _library.synonymMap : null
        // Make sure the CN-internal synonym index is loaded so aliases
        // like p53 → TP53 resolve even on a cold cache. await once here,
        // then sync-resolve each symbol inside the loop.
        await CN_loadSynonymsIfNeeded()
        const rows = []
        const notFound = []
        for (const g of genes) {
            const { resolved, viaSynonym } = CN_resolveSymbol(g, synonymMap)
            const perLine = {}
            let anyHit = false
            if (resolved) {
                for (const cl of _cnState.selectedCellLines) {
                    const v = CN_lookup(cl.id, resolved)
                    if (v != null) anyHit = true
                    perLine[cl.id] = { value: v, tier: CN_tier(v), copies: CN_approxCopies(v, cl.ploidy, cl.wgd) }
                }
            } else {
                for (const cl of _cnState.selectedCellLines) {
                    perLine[cl.id] = { value: null, tier: CN_tier(null), copies: null }
                }
            }
            if (!resolved) notFound.push(g)
            rows.push({ gene: g, resolved: resolved || g, viaSynonym, perLine })
        }
        _cnState.results = { rows, notFound }
        _cnState.tsvOutput = _cnBuildTsv(rows)
        _createDownloadLinkRaw(_toCsv(_cnState.tsvOutput), "CN lookup", document.getElementById("cnDownload"), "text/csv;charset=utf-8", ".csv")
        const hitGenes = rows.length - notFound.length
        const synN = rows.filter(r => r.viaSynonym).length
        const synNote = synN > 0 ? `, ${synN} via synonym` : ""
        _setStatus("statusSearch", `CN lookup complete: ${hitGenes}/${rows.length} genes found in ${_cnState.selectedCellLines.length} cell line(s)${synNote}${notFound.length ? `; ${notFound.length} symbol(s) not in matrix` : ""}.`)
        // Auto-show the results table.
        CN_showResults()
    } catch (err) {
        console.error("CN lookup failed:", err)
        _setStatus("statusSearch", "Error: " + err.message)
    }
    _toggleLigtBox()
    statusText.classList.remove("pulse")
    document.getElementById("outputTable").style.display = "flex"
    document.getElementById("outputTable").classList.remove("statusFadeOut")
    document.getElementById("outputTable").classList.add("statusFadeIn")
}

function _cnBuildTsv(rows) {
    if (!rows.length) return ""
    const headerLines = _cnHeaderComments(_cnState.selectedCellLines)
    const header = ["Gene", "ResolvedSymbol", "ViaSynonym", ..._cnState.selectedCellLines.map(c => c.name + " (CN)"), ..._cnState.selectedCellLines.map(c => c.name + " (~copies)")].join("\t")
    const lines = [...headerLines, header]
    for (const r of rows) {
        const cnCells = _cnState.selectedCellLines.map(cl => {
            const v = r.perLine[cl.id]?.value
            return v == null ? "" : v.toFixed(2)
        })
        const copyCells = _cnState.selectedCellLines.map(cl => {
            const c = r.perLine[cl.id]?.copies
            return c == null ? "" : String(c)
        })
        lines.push([_spreadsheetSafe(r.gene), _spreadsheetSafe(r.resolved || ""), _spreadsheetSafe(r.viaSynonym || ""), ...cnCells, ...copyCells].join("\t"))
    }
    return lines.join("\n")
}

// Full-matrix TSV: every gene in the DepMap matrix on rows, one column per
// selected cell line, raw relative CN in the cells (blank = no DepMap value).
// Unlike _cnBuildTsv (which is limited to the genes the user typed and pairs
// each line with a ~copies column), this is the analysis-friendly flat matrix
// for loading into R / pandas / Excel. Built straight off CN_matrixColumns so
// the ~20k rows are produced without a per-gene lookup. Rows carry the gene's
// chromosome / cytoband / coordinates and are ordered by genomic position, so
// runs of co-amplified neighbors (e.g. a 1p34 block) land on adjacent rows.
function _cnBuildMatrixTsv() {
    const cellLines = _cnState.selectedCellLines
    if (!cellLines.length || typeof CN_matrixColumns !== "function") return ""
    const { genes, values } = CN_matrixColumns(cellLines.map(c => c.id))
    if (!genes.length) return ""
    const cols = cellLines.map(c => values.get(c.id))
    const getLoc = (typeof CN_geneLocation === "function") ? CN_geneLocation : (() => null)
    const haveLoc = !!getLoc(genes[0]) || genes.some(g => getLoc(g))

    // Order rows by genomic position — chr 1..22, X, Y, MT, then start
    // coordinate — so physically adjacent genes are adjacent rows and
    // co-amplification blocks are obvious. Unmapped genes sort last.
    const chrRank = ch => {
        if (!ch) return 999
        if (ch === "X") return 23
        if (ch === "Y") return 24
        if (ch === "MT") return 25
        const n = parseInt(ch, 10)
        return isNaN(n) ? 998 : n
    }
    const rows = genes.map((g, gi) => ({ g, gi, loc: getLoc(g) }))
    if (haveLoc) {
        rows.sort((a, b) => {
            const ra = chrRank(a.loc && a.loc.chr), rb = chrRank(b.loc && b.loc.chr)
            if (ra !== rb) return ra - rb
            const sa = (a.loc && a.loc.start != null) ? a.loc.start : Infinity
            const sb = (b.loc && b.loc.start != null) ? b.loc.start : Infinity
            if (sa !== sb) return sa - sb
            return a.g < b.g ? -1 : a.g > b.g ? 1 : 0
        })
    }

    // Plain-text preamble — this file is downloaded and opened in
    // Excel/R/pandas, so (unlike the in-app _cnHeaderComments which render
    // as HTML) the comment lines must be clean text with no tags/entities.
    const lineNote = cellLines.map(c => {
        if (!c.knownPloidy) return `${c.name} (ploidy unknown, assumed 2.0n / non-WGD)`
        return `${c.name} (ploidy ${c.ploidy.toFixed(2)}n, ${c.wgd ? "WGD" : "non-WGD"})`
    }).join("; ")
    const headerLines = [
        `# THIS RUN: ${lineNote}`,
        `# Green Listed — copy-number matrix. Source: DepMap OmicsCNGene dataset, 24Q4 release (human cell lines).`,
        `# Values are raw relative copy number (CN): 1.0 = the line's own genome-wide baseline (typical copy level), >= 3.0 = amplification, <= 0.5 = deletion. A blank cell means DepMap has no CN value for that gene in that line.`,
        haveLoc
            ? `# Rows: all ${genes.length} genes, ordered by genomic position (GRCh38). Chromosome / Cytoband from Ensembl. Columns: the selected cell line(s). For the rounded "~ N copies" estimate and tier colors, use the on-screen table.`
            : `# Rows: all ${genes.length} genes in the matrix. Columns: the selected cell line(s). For the rounded "~ N copies" estimate and tier colors, use the on-screen table.`
    ]
    const baseCols = haveLoc ? ["Gene", "Chromosome", "Cytoband"] : ["Gene"]
    const header = [...baseCols, ...cellLines.map(c => c.name)].join("\t")
    const lines = [...headerLines, header]
    for (const { g, gi, loc } of rows) {
        let line = g
        if (haveLoc) {
            line += "\t" + ((loc && loc.chr) || "")
                  + "\t" + ((loc && loc.band) || "")
        }
        for (const col of cols) {
            const v = col[gi]
            line += "\t" + ((v == null || isNaN(v)) ? "" : v.toFixed(3))
        }
        lines.push(line)
    }
    return lines.join("\n")
}

// Download the full gene × cell-line CN matrix. Loads gene locations first
// (lazy — only this export needs them), then writes via a direct Blob (not
// _createDownloadLink, whose space→tab replace would corrupt the body) and a
// filename that names the lines when there are only a few of them.
async function CN_exportMatrixTsv() {
    const btn = document.getElementById("cnPickerMatrixBtn")
    const restore = btn ? btn.textContent : null
    if (btn) { btn.disabled = true; btn.textContent = "Preparing matrix…" }
    try {
        if (typeof CN_loadLocationsIfNeeded === "function") await CN_loadLocationsIfNeeded()
    } catch (_) { /* export proceeds without location columns */ }
    if (btn) { btn.textContent = restore; btn.disabled = (_cnState.selectedCellLines.length === 0) }
    const tsv = _cnBuildMatrixTsv()
    if (!tsv) return
    const lines = _cnState.selectedCellLines
    const slug = lines.length <= 3
        ? lines.map(c => c.name.replace(/[^A-Za-z0-9._-]+/g, "_")).join("_")
        : `${lines.length}_lines`
    const blob = new Blob([_toCsv(tsv)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `copy_number_matrix_${slug}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CN_showResults() {
    if (!_cnState.results) return
    _setActiveShow("cnTable")

    // Header row with download buttons for figure export.
    const exportButtons = `
        <div style="display:flex; gap:8px; margin-bottom:10px;">
            <button class="validate-btn" onclick="CN_exportResultsSvg()">Download SVG</button>
            <button class="validate-btn" onclick="CN_exportResultsPng()">Download PNG (high-res)</button>
        </div>`

    // Header note + table layout. Per-cell-line columns are fixed-width
    // (90px) and headers are centered over the data cells, so 2 cell lines
    // doesn't blow the table out to full page width. Each result cell
    // shows the biological copy estimate ("≈ 3 copies") on the first
    // line and the raw relative-CN number on a small second line.
    const headerCells = _cnState.selectedCellLines.map(cl => {
        // Oncotree often duplicates the primaryDisease as the subtype when
        // there's no finer subclassification; skip it in that case.
        const subtypeShown = cl.subtype && cl.subtype.toLowerCase() !== (cl.disease || "").toLowerCase() ? cl.subtype : ""
        const cancer = [cl.disease, subtypeShown].filter(Boolean).join(" · ")
        // Ploidy line carries the numeric value only; the WGD pill drawn
        // next to the cell-line name via _wgdBadge() already conveys the
        // doubling status, so repeating " · WGD" here was duplication.
        const ploidyNote = cl.knownPloidy ? `ploidy ${cl.ploidy.toFixed(1)}n` : ""
        const sourceTag = ""
        return `<th style="min-width:115px; max-width:170px; padding:6px 8px; vertical-align:top;" title="${_escapeHtml(cancer)}">
            <div style="text-align:center; font-weight:600; white-space:nowrap;">${_sexGlyph(cl.sex)} ${_escapeHtml(cl.name)}${_wgdBadge(cl.wgd, cl.ploidy)}${sourceTag}</div>
            <div style="font-size:0.7rem; color:#6b7280; font-weight:400; text-align:center; line-height:1.25; margin-top:2px; word-break:break-word; white-space:normal;">${_escapeHtml(cancer) || "&mdash;"}</div>
            ${ploidyNote ? `<div style="font-size:0.65rem; color:#9ca3af; text-align:center; margin-top:2px;">${ploidyNote}</div>` : ""}
        </th>`
    }).join("")

    // Wrap the table in a horizontally-scrollable container so the
    // results never overflow their parent — wide panels (many cell
    // lines × many genes) scroll instead of pushing the page sideways.
    let tableHtml = `<div style="overflow-x:auto; width:100%; max-width:100%;"><table class="cn-results-table" style="width:auto;">`
    tableHtml += `<thead><tr><th style="text-align:left;">Gene</th>${headerCells}</tr></thead><tbody>`
    for (const r of _cnState.results.rows) {
        const synNote = r.viaSynonym
            ? ` <span title="Matched via synonym" style="font-size:0.65rem; color:#92400e; background:#fef3c7; padding:1px 4px; border-radius:6px; border:1px solid #fde68a; margin-left:4px;">via ${_escapeHtml(r.resolved)}</span>`
            : ""
        // Human gene-symbol convention: uppercase + italic. CN data is
        // human-only (DepMap doesn't publish mouse CN), so always use
        // the canonical uppercase resolved symbol when we have it.
        const displayGene = (r.resolved || r.gene || "").toUpperCase()
        tableHtml += `<tr><td style="font-weight:600; font-style:italic; white-space:nowrap;">${_escapeHtml(displayGene)}${synNote}</td>`
        for (const cl of _cnState.selectedCellLines) {
            const cell = r.perLine[cl.id]
            const v = cell?.value, t = cell?.tier, copies = cell?.copies
            if (v == null) {
                tableHtml += `<td class="cn-tier" style="color:#9ca3af; background:#fff; min-width:115px; max-width:170px; padding:6px 8px;">—</td>`
            } else {
                const copyStr = copies != null
                    ? (copies === Math.floor(copies)
                        ? `≈ ${copies} cop${copies === 1 ? 'y' : 'ies'}`
                        : `≈ ${copies} copies`)
                    : ""
                tableHtml += `<td class="cn-tier" style="color:${t.fg}; background:${t.bg}; min-width:115px; max-width:170px; padding:6px 8px;">
                    <div style="font-weight:600;">${copyStr}</div>
                    <div style="font-size:0.7rem; opacity:0.75; margin-top:2px;">${t.label} · CN ${v.toFixed(1)}</div>
                </td>`
            }
        }
        tableHtml += "</tr>"
    }
    tableHtml += "</tbody></table></div>"
    if (_cnState.results.notFound.length) {
        tableHtml += `<div style="font-size:0.85rem; color:#7f1d1d; margin-top:10px;"><b>Not found</b> in DepMap matrix (no direct hit, no synonym match): <code>${_cnState.results.notFound.map(_escapeHtml).join(", ")}</code></div>`
    }
    // Footer: data source + ploidy / WGD explanation + tier legend + link.
    const wgdLines = _cnState.selectedCellLines.filter(c => c.wgd === true)
    const wgdNote = wgdLines.length > 0
        ? `<div style="margin-bottom:6px;"><b>Whole-genome-doubled (WGD) lines in this selection:</b> ${wgdLines.map(c => _escapeHtml(c.name)).join(", ")}. The baseline for these lines is approximately tetraploid, so a relative CN of 1.0 corresponds to ~4 actual copies rather than ~2. The &ldquo;≈ N copies&rdquo; column already accounts for this.</div>`
        : ""
    // Per-line WGS / WES badge in the column header already conveys
    // sequencing modality, so a separate listing of WES lines in the
    // footer would just be redundant. The introductory "Data:" sentence
    // explains what the badge means.
    const wesNote = ""
    tableHtml += `<div style="font-size:0.8rem; color:#374151; margin-top:14px; padding:8px 12px; background:#f9fafb; border-left:3px solid var(--mainColor); border-radius:0 4px 4px 0; line-height:1.5;">
        <div style="margin-bottom:6px;"><b>Data:</b> Gene-level copy number from DepMap&rsquo;s <a href="https://depmap.org/portal/data_page/?tab=allData" target="_blank" rel="noopener">OmicsCNGene dataset</a> (24Q4 release). Copy number values are relative, normalized to each line&rsquo;s own genome-wide baseline: <b>CN = 1.0 represents the line&rsquo;s typical copy count</b> &mdash; <b>2</b> for a non-WGD line and <b>4</b> for a whole-genome-doubled line. The &ldquo;≈ N copies&rdquo; column is rounded to a whole number: <code>round(CN × 2)</code> for non-WGD lines and <code>round(CN × 4)</code> for WGD lines.</div>
        ${wgdNote}
        ${wesNote}
        <div style="margin-bottom:6px;"><b>Why the CN value can be non-integer.</b> Inside any single cell, a gene has a whole-number copy count (0, 1, 2, 3, &hellip;) &mdash; but a cell line is not a single cell. It&rsquo;s millions of cells that have drifted apart genetically over many generations. Sequencing reads the average across that population, so a CN value of, say, 1.1 or 0.7 typically means the cells are not all in the same state &mdash; some have gained or lost a copy and others haven&rsquo;t. The &ldquo;≈ N copies&rdquo; column rounds this to a single whole number for readability, but the underlying CN value preserves the nuance, so a line at CN 0.6 is more genetically mixed for that gene than a line at CN 1.0 even though both might round to the same copy count. For CRISPR knockout this matters: a mixed line can need more cuts in some cells than others to fully lose the gene.</div>
        <div style="margin-bottom:6px;"><b>Tier scale</b> (relative CN, independent of ploidy):
            <span style="background:#fee2e2; color:#7f1d1d; padding:1px 5px; border-radius:8px;">deep del</span> CN &lt; 0.3 &nbsp;
            <span style="background:#fef2f2; color:#991b1b; padding:1px 5px; border-radius:8px;">het loss</span> 0.3&ndash;0.7 &nbsp;
            <span style="background:#f3f4f6; color:#6b7280; padding:1px 5px; border-radius:8px;">WT</span> 0.7&ndash;1.3 &nbsp;
            <span style="background:#eef2ff; color:#3730a3; padding:1px 5px; border-radius:8px;">low gain</span> 1.3&ndash;2.0 &nbsp;
            <span style="background:#dbeafe; color:#1e40af; padding:1px 5px; border-radius:8px;">gain</span> 2.0&ndash;3.0 &nbsp;
            <span style="background:#bfdbfe; color:#1e3a8a; padding:1px 5px; border-radius:8px;">amp</span> 3.0&ndash;5.0 &nbsp;
            <span style="background:#93c5fd; color:#1e3a8a; padding:1px 5px; border-radius:8px;">strong amp</span> &ge; 5.0
        </div>
        <div>For deeper exploration of human cell line data see <a href="https://depmap.org" target="_blank" rel="noopener">depmap.org</a> or the cell line browser in <a href="https://correlate.cmm.se/#cell" target="_blank" rel="noopener">Correlate</a>, Green Listed&rsquo;s linked sister app.</div>
    </div>`
    _showOutputPane("cnResultsDiv").innerHTML = exportButtons + tableHtml
}

// SVG export of the CN results table — independent of the HTML layout so
// it renders cleanly into Illustrator / Inkscape / Keynote without any
// browser-specific styling artefacts. Layout is computed pixel-precise:
// gene column on the left, one cell-line column per selected line, each
// cell shows tier-colored background + "≈ N copies" + tier · CN x.x.
function _cnBuildResultsSvg() {
    if (!_cnState.results) return ""
    const cellLines = _cnState.selectedCellLines
    const rows = _cnState.results.rows
    const COL_W = 150          // per-cell-line column width
    const GENE_W = 130         // gene-label column width
    const ROW_H = 50           // data-row height
    const HEADER_H = 78        // column-header height (name + cancer + ploidy)
    const W = GENE_W + COL_W * cellLines.length + 2
    const H = HEADER_H + ROW_H * rows.length + 2
    const esc = _escapeHtml

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">`
    svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`

    // Header row — corner cell + per-line headers.
    svg += `<rect x="0" y="0" width="${GENE_W}" height="${HEADER_H}" fill="#f9fafb" stroke="#e5e7eb"/>`
    svg += `<text x="10" y="${HEADER_H/2+5}" font-size="12" font-weight="700" fill="#15803d">Gene</text>`
    cellLines.forEach((cl, i) => {
        const x = GENE_W + i * COL_W
        svg += `<rect x="${x}" y="0" width="${COL_W}" height="${HEADER_H}" fill="#f9fafb" stroke="#e5e7eb"/>`
        const sex = cl.sex && cl.sex.toLowerCase() === "male" ? "♂" : cl.sex && cl.sex.toLowerCase() === "female" ? "♀" : "?"
        const sexColor = cl.sex && cl.sex.toLowerCase() === "male" ? "#1d4ed8" : cl.sex && cl.sex.toLowerCase() === "female" ? "#db2777" : "#9ca3af"
        // Name line — sex glyph + cell-line name + optional amber WGD
        // pill rendered to the right of the name. Width of the name
        // text is estimated by character count so the pill can be
        // positioned just after. Long names (PE/CA-PJ34 (clone C12),
        // Ishikawa (Heraklio) 02 ER-) push that estimate past the column
        // edge, so the pill is clamped to stay inside its own column —
        // otherwise it lands on the neighboring header, or off-canvas
        // entirely when a single line is selected, silently dropping the
        // WGD marker from the exported figure.
        const nameStr = `${sex} ${cl.name}`
        const nameW = nameStr.length * 7.4
        const nameCenterX = x + COL_W / 2
        const nameRightX = nameCenterX + nameW / 2
        svg += `<text x="${nameCenterX}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#15803d"><tspan fill="${sexColor}">${sex}</tspan> ${esc(cl.name)}</text>`
        if (cl.wgd === true) {
            const pillW = 30, pillH = 13
            const pillX = Math.max(x + 2, Math.min(nameRightX + 4, x + COL_W - pillW - 2))
            const pillY = 9
            svg += `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="3" fill="#fef3c7" stroke="#fde68a"/>`
            svg += `<text x="${pillX + pillW/2}" y="${pillY + 9}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#92400e" letter-spacing="0.4">WGD</text>`
        }
        // Cancer-type — wrap up to two lines if needed.
        const subtypeShown = cl.subtype && cl.subtype.toLowerCase() !== (cl.disease || "").toLowerCase() ? cl.subtype : ""
        const cancer = [cl.disease, subtypeShown].filter(Boolean).join(" · ")
        // Greedy fill of line 1, then everything after the first overflow
        // goes to line 2. Once a word has spilled, later words must follow
        // it — without that check a short trailing word would jump back up
        // to line 1 and the disease name would read out of order
        // ("B-Cell Acute Leukemia" / "Lymphoblastic").
        const words = cancer.split(/\s+/)
        let l1 = "", l2 = ""
        for (const w of words) {
            const candidate = (l1 ? l1 + " " : "") + w
            if (!l2 && candidate.length <= 22) l1 = candidate
            else l2 = (l2 ? l2 + " " : "") + w
        }
        if (l2.length > 24) l2 = l2.slice(0, 22) + "…"
        svg += `<text x="${x + COL_W/2}" y="38" text-anchor="middle" font-size="10" fill="#6b7280">${esc(l1)}</text>`
        if (l2) svg += `<text x="${x + COL_W/2}" y="51" text-anchor="middle" font-size="10" fill="#6b7280">${esc(l2)}</text>`
        // Ploidy line — WGD repetition removed (the pill above carries
        // that information). Just the numeric ploidy here.
        if (cl.knownPloidy) {
            svg += `<text x="${x + COL_W/2}" y="68" text-anchor="middle" font-size="9" fill="#9ca3af">ploidy ${cl.ploidy.toFixed(1)}n</text>`
        }
    })

    // Data rows.
    rows.forEach((r, ri) => {
        const y = HEADER_H + ri * ROW_H
        svg += `<rect x="0" y="${y}" width="${GENE_W}" height="${ROW_H}" fill="#ffffff" stroke="#e5e7eb"/>`
        const displayGene = (r.resolved || r.gene || "").toUpperCase()
        svg += `<text x="10" y="${y + ROW_H/2 + 5}" font-size="12" font-weight="700" font-style="italic" fill="#374151">${esc(displayGene)}</text>`
        cellLines.forEach((cl, i) => {
            const x = GENE_W + i * COL_W
            const cell = r.perLine[cl.id]
            const v = cell?.value, t = cell?.tier, copies = cell?.copies
            if (v == null) {
                svg += `<rect x="${x}" y="${y}" width="${COL_W}" height="${ROW_H}" fill="#ffffff" stroke="#e5e7eb"/>`
                svg += `<text x="${x + COL_W/2}" y="${y + ROW_H/2 + 5}" text-anchor="middle" font-size="13" fill="#9ca3af">—</text>`
            } else {
                svg += `<rect x="${x}" y="${y}" width="${COL_W}" height="${ROW_H}" fill="${t.bg}" stroke="#e5e7eb"/>`
                const copyStr = copies != null
                    ? (copies === Math.floor(copies)
                        ? `≈ ${copies} cop${copies === 1 ? 'y' : 'ies'}`
                        : `≈ ${copies} copies`)
                    : ""
                svg += `<text x="${x + COL_W/2}" y="${y + 21}" text-anchor="middle" font-size="13" font-weight="700" fill="${t.fg}">${esc(copyStr)}</text>`
                svg += `<text x="${x + COL_W/2}" y="${y + 38}" text-anchor="middle" font-size="11" fill="${t.fg}" fill-opacity="0.8">${esc(t.label)} · CN ${v.toFixed(1)}</text>`
            }
        })
    })

    svg += `</svg>`
    return svg
}

function CN_exportResultsSvg() {
    const svg = _cnBuildResultsSvg()
    if (!svg) return
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "copy_number_table.svg"
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CN_exportResultsPng() {
    // Rasterise at 4× scale for a publication-quality PNG. Two changes
    // vs the previous version: (1) the SVG itself is overridden to
    // declare the scaled width/height (viewBox preserved) so the
    // browser rasterises directly at the target resolution — no canvas
    // upscaling of a small bitmap, which is what made earlier exports
    // look soft. (2) Canvas image-smoothing set to "high" for the small
    // amount of resampling that still happens at the final draw.
    const baseSvg = _cnBuildResultsSvg()
    if (!baseSvg) return
    const m = baseSvg.match(/width="(\d+)" height="(\d+)"/)
    const w = m ? parseInt(m[1]) : 1200
    const h = m ? parseInt(m[2]) : 600
    const scale = 4
    const scaledSvg = baseSvg.replace(
        /width="\d+" height="\d+"/,
        `width="${w * scale}" height="${h * scale}"`
    )
    const blob = new Blob([scaledSvg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = w * scale
        canvas.height = h * scale
        const ctx = canvas.getContext("2d")
        ctx.imageSmoothingEnabled = true
        if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high"
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(pngBlob => {
            const pngUrl = URL.createObjectURL(pngBlob)
            const a = document.createElement("a")
            a.href = pngUrl
            a.download = "copy_number_table.png"
            document.body.appendChild(a); a.click(); a.remove()
            setTimeout(() => URL.revokeObjectURL(pngUrl), 1000)
        }, "image/png")
        URL.revokeObjectURL(url)
    }
    img.onerror = err => {
        console.error("PNG export failed:", err)
        URL.revokeObjectURL(url)
    }
    img.src = url
}