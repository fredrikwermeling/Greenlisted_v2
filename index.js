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

    document.getElementById("numberToRank").value = data.rankingTop
    document.getElementById("numberToRank").defaultValue = ""


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
    SET_settingsSetAll(data.searchSymbols, data.partialMatches, data.trimBefore, data.trimAfter, data.adaptorBefore, data.adaptorAfter, data.rankingTop, rankingOrder, data.outputName, data.enableSynonyms, data.defaultSynonyms)

    //uppdates wich synonym list to use
    changeSynonyms()

    // load the library
    changeLibrary()

    // update example sequence
    _updateExampleText()
}



var _testSequences = {
    human: "GAAGGTGCGTTCGATGACAG\nCCTGCACTCGGAGAAGAACG\nTGTGCCGCAAAAGGTCTTCA\nAAGATGAAGAATGCCCACAA\nGACTGGGAATAGTTACTCCC\nTTTGGATTACTTACTCAAGT",
    mouse: "GCAGCGTTACCTCTATCGTA\nCTCACCCAGTGACAACTCAG\nCGACGATGACCTCCTTCTTG\nGAACCTCTGTACTACAACGC\nGATGTACAACAACTGTGAAG\nGAACGACGTAGCCATTGTGA"

    // Human: AKT1(4 libs), AKT1(Brunello only), AKT1(GeCKO only), CD19(Brunello+Jacquere), PTEN(Jacquere+MinLibCas9), BRAF(MinLibCas9 only)
    // Mouse: Kras(4 libs), Akt1(Brie only), Akt1(GeCKO only), Braf(Julianna+VBC), Egfr(VBC+mTKO), Akt1(mTKO only)
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
        _setSectionTitle("symbolsTitle", "Symbols")
        _setSectionTitle("inputPlateTitle", "2. Input symbols")
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
            rawInput.split("\n")
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
        _createDownloadLink(_validateState.resultsOutput, outputName + " Validation Results", document.getElementById("validationDownload"), "text/tab-separated-values", ".tsv")
        _createDownloadLink(_validateState.notFoundOutput, outputName + " Not Found", document.getElementById("validationNotFoundDownload"), "text/tab-separated-values", ".tsv")

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

function _renderTsvAsTable(tsv, delimiter) {
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
            infoHtml += `<p style="font-size: 0.8rem; color: #666; margin-bottom: 2px;">${displayText}</p>`
            dataStart = i + 1
        } else {
            break
        }
    }

    if (dataStart >= lines.length) return infoHtml + "<p>No tabular data</p>"

    var html = infoHtml + '<table class="validationResultsTable"><thead><tr>'
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
    for (const h of headers) {
        html += `<th>${h}</th>`
    }
    html += '</tr></thead><tbody>'
    for (var i = dataStart + 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter)
        html += '<tr>'
        for (let j = 0; j < cols.length; j++) {
            const cell = italicCols.has(j) ? `<i>${cols[j]}</i>` : cols[j]
            html += `<td>${cell}</td>`
        }
        html += '</tr>'
    }
    html += '</tbody></table>'
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
    html += `<th>${headers[0]}</th><th># Libraries</th>`
    for (var h = 1; h < headers.length; h++) {
        html += `<th>${headers[h]}</th>`
    }
    html += '</tr></thead><tbody>'

    const seen = new Set()
    for (const cols of rows) {
        const seq = cols[0]
        const isFirst = !seen.has(seq)
        seen.add(seq)

        html += '<tr>'
        if (isFirst) {
            html += `<td>${seq}</td><td>${countMap.get(seq)}</td>`
        } else {
            html += `<td></td><td></td>`
        }
        for (var c = 1; c < cols.length; c++) {
            html += `<td>${cols[c]}</td>`
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

function _showTableOutput(text, delimiter) {
    _showOutputPane("validationTableDiv").innerHTML = _renderTsvAsTable(text, delimiter)
}

function showValidationOutput() {
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
                    _setStatus("statusSearch", `Loading copy-number data for ${screeningCl.length} cell line(s)…`)
                    await CN_loadIfNeeded()
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

        const fullOutput = _createFullTxtOutput(searchOutput.filteredLibraryMap, searchOutput.headers)
        const notFoundOutput = _createSymbolNotFound(searchOutput.usedSynonyms)
        const adapterOutput = _createAdapterOutput(searchOutput.filteredLibraryMap, cnReady ? screeningCl[0] : null)
        const MAGeCKOutput = _createMAGeCKOutput(searchOutput.filteredLibraryMap)

        outputTexts = {
            "textOutputFull": fullOutput,
            "textOutputNotFound": notFoundOutput,
            "textOutputAdapter": adapterOutput,
            "textOutputMAGeCK": MAGeCKOutput
        }
        _createDownloadLink(adapterOutput, settings["outputName"] + " with Adapters", document.getElementById("adapterDownload"), "text/tab-separated-values", ".tsv")
        _createDownloadLink(fullOutput, settings["outputName"] + " Output", document.getElementById("fullDownload"), "text/tab-separated-values", ".tsv")
        _createDownloadLink(notFoundOutput, settings["outputName"] + " not found", document.getElementById("notFoundDownload"), "text/tab-separated-values", ".tsv")
        _createDownloadLink(MAGeCKOutput, settings["outputName"] + " MAGeCK", document.getElementById("MAGeCKDownload"), "text/csv", ".csv")

        const cnRow = document.getElementById("cnAnnotationOutputRow")
        if (cnReady) {
            try {
                const cnOutput = _createCnAnnotationOutput(searchOutput.filteredLibraryMap, screeningCl)
                outputTexts["textOutputCn"] = cnOutput
                _createDownloadLinkRaw(cnOutput, settings["outputName"] + " copy number", document.getElementById("cnAnnotationDownload"), "text/tab-separated-values;charset=utf-8", ".tsv")
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
    // Default the preview to "Output with adapters" once the run
    // completes — saves the user a click for the most-used output.
    if (outputTexts && outputTexts.textOutputAdapter) showAdapterOutput()
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
    // Two decimals, not one: the deletion threshold is 0.3, and a CN of 0.26
    // rendered as "CN 0.3" reads as if it shouldn't have been flagged.
    const copies = CN_approxCopies(v, cellLine.ploidy, cellLine.wgd)
    const detail = `CN ${v.toFixed(2)}, ~${copies} cop${copies === 1 ? "y" : "ies"}`
    if (v < 0.3)  return `DEEP DELETION (${detail}) - gene likely absent, guides uninformative`
    if (v >= 5.0) return `STRONG AMPLIFICATION (${detail}) - copy-number effect likely, dropout may be a false positive`
    if (v >= 3.0) return `AMPLIFIED (${detail}) - copy-number effect possible, interpret dropout with care`
    return ""
}

function _createAdapterOutput(libraryMap, screeningCellLine) {
    const date = new Date()
    // The warning column only appears when a screening cell line was picked,
    // so the file keeps its familiar three-column shape otherwise.
    const cl = screeningCellLine || null
    const synonymMap = (typeof _library !== "undefined" && _library && _library.synonymMap) ? _library.synonymMap : null
    var out = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    var out = out + "Symbol\tSymbol_ID\tsgRNA + adapter(s)" + (cl ? `\tCopy-number warning (${cl.name})\n` : "\n")

    for (var symbol of Object.keys(libraryMap)) {
        // One lookup per symbol rather than per guide — otherwise a large
        // design redoes the same resolve-and-lookup three or four times a row.
        const flag = cl ? _cnAdapterFlag(symbol, cl, synonymMap) : ""
        for (var i = 0; i < libraryMap[symbol].length; i++) {
            const row = libraryMap[symbol][i]
            const capitalizedSymbol = row[settings.symbolColumn - 1].trim()
            out = out + `${capitalizedSymbol}\t${capitalizedSymbol}_${i + 1}\t${_applyPostProcessing(row[settings.RNAColumn - 1])}` + (cl ? `\t${flag}\n` : "\n")

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
            out = out + `${capitalizedSymbol}_${i + 1},${_applyTrim(row[settings.RNAColumn - 1])},${capitalizedSymbol}\n`
        }
    }
    return out
}

// Per-gene CN annotation TSV — one row per gene in the screening output,
// columns are (CN) and (~copies) for each selected cell line. Mirrors the
// layout of the standalone CN-mode TSV so users with both files can join
// them in Excel by gene symbol.
// Four labelled comment rows that head every CN TSV — kept identical
// between the standalone CN-mode TSV and the screening-annotation TSV,
// and in the same plain-text style as the full-matrix export. No HTML:
// these files get downloaded and opened in Excel / R / pandas, where
// tags and entities would sit in the data as literal characters.
// _renderTsvAsTable already styles lines starting with '#' as small grey
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
    const ploidyRow = `# This run: ${ploidyParts.join("; ")}`

    return [ploidyConceptRow, cnRow, copiesRow, ploidyRow]
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
        lines.push([upper, resolved || "", ...cnCells, ...copyCells].join("\t"))
    }
    return lines.join("\n") + "\n"
}

function showCnAnnotationOutput() {
    if (outputTexts && outputTexts.textOutputCn) {
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
    var out = out + headers.join("\t") + "\n" //the original headers are placed att the top of the output
    for (var symbol of Object.keys(libraryMap)) {
        libraryMap[symbol].forEach(row => {
            out = out + `${row.join("\t")}\n`
        })
    }
    return out
}

function _createSymbolNotFound(usedSynonyms) {
    var out = ""
    for (var symbol of Object.keys(usedSynonyms)) {
        if (settings.enableSynonyms && (usedSynonyms[symbol].length > 0)) {
            for (var synonym of usedSynonyms[symbol]) {
                out = `${symbol}\t${synonym}\n` + out
            }
        }
        else {
            out = out + `${symbol}\t\n`
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

function _applyAdapter(text) {
    if (settings.adapterAfter.lenth == 0) {
        adaptoerAfter = ""
    }
    if (settings.adapterBefore.lenth == 0) {
        adapterBefore = ""
    }
    text = settings.adapterBefore + text + settings.adapterAfter
    return text

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
    _showTableOutput(outputTexts.textOutputAdapter)
}

function showMAGeCKOutput() {
    // Raw .csv view — comma-separated, monospaced, exactly as the file
    // would look opened in a text editor. MAGeCK count consumes this
    // format directly, so seeing the literal text is what users want
    // (a pretty HTML table hides the actual delimiter).
    _showTextareaOutput(outputTexts.textOutputMAGeCK)
}

function showFullOutput() {
    _showTableOutput(outputTexts.textOutputFull)
}

function showNotFoundOutput() {
    _showTableOutput(outputTexts.textOutputNotFound)
}

function showSettingsOutput() {
    _showTextareaOutput(SET_settingsToStr())
}

function dowloadSettingsOutput() {
    element = document.getElementById("settingsDowload")
    _createDownloadLink(SET_settingsToStr(), settings["outputName"] + " Settings", element, "text", ".txt")
}

function _generateZipName(prefix) {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const uid = Math.random().toString(36).slice(2, 6)
    return `${prefix}_${date}_${uid}`
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
    const name = settings["outputName"] || "output"
    const folderName = _generateZipName(name)
    const zip = new JSZip()
    const folder = zip.folder(folderName)
    folder.file(name + " with Adapters.tsv", outputTexts.textOutputAdapter)
    folder.file(name + " MAGeCK.csv", outputTexts.textOutputMAGeCK)
    folder.file(name + " Output.tsv", outputTexts.textOutputFull)
    folder.file(name + " not found.tsv", outputTexts.textOutputNotFound)
    folder.file(name + " Settings.txt", SET_settingsToStr())
    // Include the per-gene copy-number annotation if the user picked a
    // screening cell line in section 3 and the file was generated.
    if (outputTexts.textOutputCn) {
        folder.file(name + " copy number.tsv", outputTexts.textOutputCn)
    }
    const blob = await zip.generateAsync({ type: "blob" })
    _downloadBlob(blob, folderName + ".zip")
}

async function downloadAllValidation() {
    const name = document.getElementById("outputFileName").value || "validation"
    const folderName = _generateZipName(name)
    const zip = new JSZip()
    const folder = zip.folder(folderName)
    folder.file(name + " Validation Results.tsv", _validateState.resultsOutput)
    folder.file(name + " Not Found.tsv", _validateState.notFoundOutput)
    const blob = await zip.generateAsync({ type: "blob" })
    _downloadBlob(blob, folderName + ".zip")
}

async function _displayLibraryCitation(libraryCitation) {
    const libraryInfoContainer = document.getElementById("libraryInfo")
    libraryInfoContainer.innerHTML = libraryCitation
}

async function changeLibrary() {
    //called when library changes through (droopdown under 1. Select library)
    //uppdates library to contin relevant information for the new library

    const libraryName = document.getElementById("libraries").value
    settings.libraryName = libraryName
    const customLibrarie = document.getElementById("User Upload")
    await _displayLibraryCitation("")

    // Ranking order and Trim only apply to an uploaded library: the built-in
    // ones already declare which direction their score ranks and ship a
    // uniform guide length. Revealed by the .custom-only rule in index.css.
    document.body.classList.toggle("custom-library", libraryName == "custom")

    if (libraryName == "custom") { //shows new input fields for custom library
        customLibrarie.classList.remove("inactive")
        changeLibraryColumn()
    }
    else { //uppdates library if it was not custom
        customLibrarie.classList.add("inactive")
        _setStatus("symbolsFound", "Fetching library from server...")
        await new Promise(r => setTimeout(r, 10)) //wait for status animation to end
        try {
            const librarySettings = await SER_selectLibrary(libraryName) //uppdates library
            await _displayLibraryCitation(SER_getLibraryCitation())
            SET_settingsSetIndexes(librarySettings.RNAColumn, librarySettings.symbolColumn, librarySettings.RankColumn)

            const synonymNames = await SER_getSynonymNames()
            if (synonymNames.length != 0) {

                if (synonymNames.includes(librarySettings.synonymName)) {
                    document.getElementById("synonymSelect").value = librarySettings.synonymName
                }
            }
            //console.log(librarySettings.defaultRangingOrder)
            if (librarySettings.defaultRangingOrder == 0) {
                document.getElementById("rankingOrder").value = "descending"
            }
            if (librarySettings.defaultRangingOrder == 1) {
                document.getElementById("rankingOrder").value = "ascending"
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
}

async function changeSynonyms() {
    const synonymName = document.getElementById("synonymSelect").value
    settings.synonymName = synonymName
    await SER_changeSynonyms(synonymName)
    _statusUpdateSymbols()
}

function changeSymbols() {
    if (_validateState.isValidateMode) {
        const lines = document.getElementById("searchSymbols").value.split("\n").filter(s => s.trim().length > 0)
        _setStatus("statusSearchSymbolsRows", `${lines.length} sequence(s) entered`)
        return
    }

    const partialMatches = document.getElementById("partialMatches").checked
    const enableSynonyms = document.getElementById("enableSynonyms").checked
    //sets everything to lower case and clears any extra spaces
    const searchSymbols = [...new Set(document.getElementById("searchSymbols").value.split("\n").filter(item => { return item.trim() }).map(symbol => symbol.trim().toLowerCase()))]

    SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms)
    _updateControlsStatus()   // the suggested control count tracks the symbol list
    _statusUpdateSymbols()
}

function changeLibraryColumn() {
    //User input fields only called when adding a custom library
    const symbolColumn = document.getElementById("GeneSymbolIndex").value
    const RNAColumn = document.getElementById("gRNAIndex").value
    const rankingIndex = document.getElementById("rankingIndex").value

    SET_settingsSetIndexes(RNAColumn, symbolColumn, rankingIndex)
    updateCustomlibrary()
}

function changeSettings() {

    const trimBefore = document.getElementById("trimBefore").value

    const trimAfter = document.getElementById("trimAfter").value

    const adapterBefore = document.getElementById("adapterBefore").value
    const adapterAfter = document.getElementById("adapterAfter").value

    const rankingTop = document.getElementById("numberToRank").value
    const outputName = document.getElementById("outputFileName").value

    const rankingOrder = document.getElementById("rankingOrder").value

    const downloadName = document.getElementById("outputFileName").value

    SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, rankingTop, rankingOrder, outputName, downloadName)
    // Must run after SET_settingsSetSettings — it sizes the suggested control
    // counts from rankingTop, pre-fills the count boxes, and then syncs the
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
    // "Limit to top" caps how many guides each gene actually contributes.
    const top = parseInt(settings.rankingTop, 10)
    var guides = 0
    for (const g of found) {
        const rows = _library.libraryMap[g].length
        guides += (!isNaN(top) && top > 0) ? Math.min(rows, top) : rows
    }
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
    const box = document.getElementById("controlsStatus")
    if (!box || typeof LIB_controlInfo !== "function") return
    const info = LIB_controlInfo()
    const design = _estimateDesign()

    // The status box carries only what isn't visible elsewhere: the library's
    // control inventory is already in the citation panel on the left, and the
    // number being added is in the box itself. So this is limited to the
    // essential-gene names and any warning that a request exceeds stock.
    // The suggested number is a total budget shared by whichever kinds are
    // both ticked and stocked, so that has to be counted before any box can
    // be filled in.
    const sharing = _CONTROL_UI.filter(ui => {
        const cb = document.getElementById(ui.checkbox)
        return cb && cb.checked && info[ui.id]
    }).map(ui => ui.id)

    const lines = []
    for (const ui of _CONTROL_UI) {
        const cb = document.getElementById(ui.checkbox)
        const countInput = document.getElementById(ui.count)
        if (!cb || !countInput) continue
        const avail = info[ui.id]
        if (!avail) {
            // Clear the box as well as disabling it — switching from a library
            // that has this control type to one that doesn't would otherwise
            // leave a stale number sitting in a greyed-out field.
            cb.checked = false
            cb.disabled = true
            countInput.disabled = true
            countInput.value = ""
            countInput.placeholder = ""
            delete countInput.dataset.auto
            continue
        }
        cb.disabled = false
        countInput.disabled = !cb.checked
        if (!cb.checked) {
            // Blank a suggested number while the kind is off, so a disabled
            // box never shows a figure that isn't being used. A number the
            // user typed themselves is kept, ready for when they tick again.
            if (countInput.dataset.auto !== "0") {
                countInput.value = ""
                countInput.placeholder = ""
            }
            continue
        }
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
        if (!isNaN(raw) && raw > avail.count) {
            lines.push(`${ui.label}: only ${avail.count} in this library &mdash; adding all ${avail.count}`)
        }
    }

    const essCb = document.getElementById("includeEssential")
    const essCount = document.getElementById("essentialCount")
    if (essCb && essCount) {
        essCount.disabled = !essCb.checked
        if (!essCb.checked) {
            // Same rule as the two spike-in boxes: a suggested number is
            // blanked while its checkbox is off, so nothing shows a figure
            // that isn't being used. A number the user typed is kept.
            if (essCount.dataset.auto !== "0") {
                essCount.value = ""
                essCount.placeholder = ""
            }
        } else if (typeof LIB_essentialPanel === "function") {
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
    //Displays the text SEQUENCE modified by trim and adapter sequences
    const example = _applyPostProcessing("SEQUENCE")
    document.getElementById("ExampleSequance").innerHTML = example
}

async function _displaySymbolsNotFound(synonymMap) {
    //Creates and displays everything under the Symbols not found sub title under 2. Input symbols in HTMl
    if (settings.partialMatches) {
        _setStatus("statusSearchSymbolsRows", ``)
        const synonymsUsed = document.getElementById("displaySynonyms")
        synonymsUsed.value = "Not available"
    }
    else {
        const synonymsUsed = document.getElementById("displaySynonyms")
        var displayText = ""

        var numSynonyms = 0
        var numNotFound = 0
        Object.keys(synonymMap).forEach(symbol => {
            if (settings.enableSynonyms && (synonymMap[symbol].length != 0)) {

                displayText = `${symbol} → ${[...synonymMap[symbol]].join(', ')}\n${displayText}`
                numSynonyms = numSynonyms + synonymMap[symbol].length
            }
            else {
                displayText = `${displayText}${symbol}\n`
                numNotFound++
            }
        })
        synonymsUsed.value = displayText

    }

    settings.enableSynonyms ? _setStatus("statusNumSynonyms", `(used: ${numSynonyms})`) : _setStatus("statusNumSynonyms", ``)
    settings.partialMatches ? _setStatus("statusSearchSymbolsRows", ``) : _setStatus("statusSearchSymbolsRows", `Symbols found in library: ${settings.searchSymbols.length - numNotFound} of ${settings.searchSymbols.length}`)

}

/* ------------------ STATUS ----------------- */

function _statusUpdateSymbols() {
    const synonymMap = SER_getSynonymMap(settings.searchSymbols)
    _displaySymbolsNotFound(synonymMap)

    const statusSymbols = SER_statusLibrarySymbols()
    _setStatus("symbolsFound", statusSymbols)

    _setStatus("searchSymbols", Array.from(settings.searchSymbols).join("\n"), false)

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
    element.classList.add("statusFadeOut"); // Add class to fade out the old text

    element.addEventListener("animationend", function () {    // Listen for the "transitionend" event
        if (isNotInnerHtml) {
            element.innerHTML = text;
        }
        else {
            element.value = text;
        }

        element.classList.remove("statusFadeOut"); // Remove class to fade in the new text
        element.classList.add("statusFadeIn"); // Add class to fade in the new text
    }, { once: true }); // Ensure the event listener is called only once

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
var _setsState = { sets: null, loading: null }

async function SETS_openModal() {
    document.getElementById("setsModal").className = "fazeIn upset-modal-overlay"
    const list = document.getElementById("setsList")
    if (!_setsState.sets) {
        list.innerHTML = `<p style="font-size:0.85rem; color:#6b7280;">Loading&hellip;</p>`
        try {
            if (!_setsState.loading) _setsState.loading = FH_fetchJsonFile("geneSets.json")
            const data = await _setsState.loading
            _setsState.sets = data.sets || []
        } catch (e) {
            console.error("Could not load geneSets.json:", e)
            list.innerHTML = `<p style="font-size:0.85rem; color:#b91c1c;">Could not load the curated lists.</p>`
            return
        }
    }
    _renderSetsList()
}

function SETS_closeModal() {
    document.getElementById("setsModal").className = "fazeOut upset-modal-overlay"
}

function _renderSetsList() {
    const list = document.getElementById("setsList")
    list.innerHTML = _setsState.sets.map((s, i) => `
        <div class="gene-set-row">
            <div>
                <div><b>${_cnEsc(s.label)}</b> <span class="gene-set-count">${s.genes.length} genes</span></div>
                <div class="gene-set-desc">${_cnEsc(s.description)}</div>
                <div class="gene-set-src">Source: ${_cnEsc(s.source)}</div>
            </div>
            <span style="display:flex; gap:6px; align-items:center; white-space:nowrap;">
                <button class="validate-btn" onclick="SETS_load(${i}, false)">Replace</button>
                <button class="validate-btn" onclick="SETS_load(${i}, true)">Add</button>
            </span>
        </div>`).join("")
}

// Put a set into the symbol box. "Add" merges with what's already there —
// building a screen from two or three classes is the common case, and
// retyping the first list to add a second would be tedious. Duplicates are
// dropped, so adding an overlapping set is safe.
function SETS_load(index, append) {
    const set = _setsState.sets[index]
    if (!set) return
    const box = document.getElementById("searchSymbols")
    const existing = append
        ? box.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        : []
    const seen = new Set(existing.map(s => s.toUpperCase()))
    const merged = existing.slice()
    for (const g of set.genes) {
        if (seen.has(g.toUpperCase())) continue
        seen.add(g.toUpperCase())
        merged.push(g)
    }
    box.value = merged.join("\n")
    changeSymbols()
    SETS_closeModal()
    _setStatus("statusSearchSymbolsRows",
        `${set.label}: ${set.genes.length} genes ${append ? "added" : "loaded"} (${merged.length} in the box)`)
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
    fullCatalogue: [],        // populated from CN_listCellLines() once loaded
    results: null,            // { rows: [{gene, perLine: {id: {value, tier}}}], notFound: [genes] }
    tsvOutput: ""             // TSV of the results table for download
}

async function CN_openModal() {
    // Toggling off — leave CN mode and clear selection.
    if (_cnState.isMode) {
        _cnExitMode()
        return
    }
    const modal = document.getElementById("cnModal")
    modal.className = "fazeIn upset-modal-overlay"
    document.getElementById("cnPickerStatus").textContent = "Loading catalogue (cell-line metadata + CN matrix)…"
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
    if (CN_isLoaded()) {
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
        await CN_loadIfNeeded()
        _cnState.fullCatalogue = CN_listCellLines()
        document.getElementById("cnPickerStatus").textContent =
            `${_cnState.fullCatalogue.length} human cell lines available. Type to filter; click rows to (de)select.`
        _renderCnPicker(_cnState.fullCatalogue)
        _renderCnPickerExamples()
    } catch (err) {
        document.getElementById("cnPickerStatus").textContent = "Failed to load: " + err.message
        if (progBox) progBox.style.display = "none"
    }
}
function CN_closeModal() {
    document.getElementById("cnModal").className = "fazeOut upset-modal-overlay"
}

// Escape text that gets interpolated into the CN result markup. Gene
// symbols come straight from the user's textarea and cell-line names and
// disease strings come from DepMap, so neither is guaranteed free of
// &, <, > or quotes. Safe for both HTML and SVG text nodes, and for
// double-quoted attribute values.
function _cnEsc(s) {
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
    const list = _cnState.fullCatalogue || []
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
    if (!q) { _renderCnPicker(_cnState.fullCatalogue); return }
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
    const filtered = _cnState.fullCatalogue.filter(c => {
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
        const entry = _cnState.fullCatalogue.find(c => c.id === id)
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
// the catalogue and the screening-annotation slot is updated when an
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
            if (status) status.textContent = "Loading cell-line catalogue…"
            await CN_loadIfNeeded()
            const list = CN_listCellLines()
            if (dl) {
                // Emit both the DepMap canonical form ("A-375") AND the
                // hyphen-stripped form ("A375") when they differ — typing
                // either gets an autocomplete suggestion.
                const opts = []
                for (const c of list) {
                    const ann = [c.disease, c.lineage].filter(Boolean).join(" · ")
                    opts.push(`<option value="${c.name}">${ann}</option>`)
                    if (c.stripped && c.stripped !== c.name) {
                        opts.push(`<option value="${c.stripped}">${c.name} &mdash; ${ann}</option>`)
                    }
                }
                dl.innerHTML = opts.join("")
            }
            _screeningDatalistPopulated = true
            if (status) status.textContent = ""
        }
        const val = inp.value.trim()
        const list = _cnState.fullCatalogue && _cnState.fullCatalogue.length
            ? _cnState.fullCatalogue : CN_listCellLines()
        // Match the user's input against either the canonical name or the
        // stripped form (DepMap uses "A-375" / "A375" — both are correct).
        const match = list.find(c => c.name === val || (c.stripped && c.stripped === val))
        const row = document.getElementById("cnAnnotationOutputRow")
        if (match) {
            _cnState.screeningCellLines = [match]
            if (status) {
                const ploidy = match.knownPloidy ? ` &middot; ${match.ploidy.toFixed(1)}n${match.wgd ? " WGD" : ""}` : ""
                const cancer = [match.disease, match.lineage].filter(Boolean).join(" · ")
                status.innerHTML = `<span style="color:var(--mainColor); font-weight:600;">✓ ${match.name}${ploidy}${cancer ? " &mdash; " + cancer : ""}</span>`
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
    _setSectionTitle("symbolsTitle", "Symbols")
    _setSectionTitle("inputPlateTitle", "2. Input symbols")
    init()
}

async function CN_runLookup() {
    _toggleLigtBox()
    var statusText = document.getElementById("statusSearch")
    statusText.classList.add("pulse")
    await new Promise(r => setTimeout(r, 50))

    try {
        const raw = document.getElementById("searchSymbols").value
        const genes = [...new Set(
            raw.split(/[\s,;\n\r\t]+/).map(s => s.trim()).filter(Boolean)
        )]
        if (genes.length === 0) {
            _setStatus("statusSearch", "Error: Please enter at least one gene symbol")
            _toggleLigtBox(); statusText.classList.remove("pulse"); return
        }
        if (!CN_isLoaded()) {
            _setStatus("statusSearch", "Loading CN matrix...")
            await CN_loadIfNeeded()
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
        _createDownloadLinkRaw(_cnState.tsvOutput, "CN lookup", document.getElementById("cnDownload"), "text/tab-separated-values;charset=utf-8", ".tsv")
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
        lines.push([r.gene, r.resolved || "", r.viaSynonym || "", ...cnCells, ...copyCells].join("\t"))
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
// runs of co-amplified neighbours (e.g. a 1p34 block) land on adjacent rows.
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
        `# Green Listed — copy-number matrix. Source: DepMap OmicsCNGene dataset, 24Q4 release (human cell lines).`,
        `# Values are raw relative copy number (CN): 1.0 = the line's own genome-wide baseline (typical copy level), >= 3.0 = amplification, <= 0.5 = deletion. A blank cell means DepMap has no CN value for that gene in that line.`,
        haveLoc
            ? `# Rows: all ${genes.length} genes, ordered by genomic position (GRCh38). Chromosome / Cytoband from Ensembl. Columns: the selected cell line(s). For the rounded "~ N copies" estimate and tier colours, use the on-screen table.`
            : `# Rows: all ${genes.length} genes in the matrix. Columns: the selected cell line(s). For the rounded "~ N copies" estimate and tier colours, use the on-screen table.`,
        `# This run: ${lineNote}`
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
    const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `copy_number_matrix_${slug}.tsv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CN_showResults() {
    if (!_cnState.results) return

    // Header row with download buttons for figure export.
    const exportButtons = `
        <div style="display:flex; gap:8px; margin-bottom:10px;">
            <button class="validate-btn" onclick="CN_exportResultsSvg()">Download SVG</button>
            <button class="validate-btn" onclick="CN_exportResultsPng()">Download PNG (high-res)</button>
        </div>`

    // Header note + table layout. Per-cell-line columns are fixed-width
    // (90px) and headers are centred over the data cells, so 2 cell lines
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
        return `<th style="min-width:115px; max-width:170px; padding:6px 8px; vertical-align:top;" title="${_cnEsc(cancer)}">
            <div style="text-align:center; font-weight:600; white-space:nowrap;">${_sexGlyph(cl.sex)} ${_cnEsc(cl.name)}${_wgdBadge(cl.wgd, cl.ploidy)}${sourceTag}</div>
            <div style="font-size:0.7rem; color:#6b7280; font-weight:400; text-align:center; line-height:1.25; margin-top:2px; word-break:break-word; white-space:normal;">${_cnEsc(cancer) || "&mdash;"}</div>
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
            ? ` <span title="Matched via synonym" style="font-size:0.65rem; color:#92400e; background:#fef3c7; padding:1px 4px; border-radius:6px; border:1px solid #fde68a; margin-left:4px;">via ${_cnEsc(r.resolved)}</span>`
            : ""
        // Human gene-symbol convention: uppercase + italic. CN data is
        // human-only (DepMap doesn't publish mouse CN), so always use
        // the canonical uppercase resolved symbol when we have it.
        const displayGene = (r.resolved || r.gene || "").toUpperCase()
        tableHtml += `<tr><td style="font-weight:600; font-style:italic; white-space:nowrap;">${_cnEsc(displayGene)}${synNote}</td>`
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
        tableHtml += `<div style="font-size:0.85rem; color:#7f1d1d; margin-top:10px;"><b>Not found</b> in DepMap matrix (no direct hit, no synonym match): <code>${_cnState.results.notFound.map(_cnEsc).join(", ")}</code></div>`
    }
    // Footer: data source + ploidy / WGD explanation + tier legend + link.
    const wgdLines = _cnState.selectedCellLines.filter(c => c.wgd === true)
    const wgdNote = wgdLines.length > 0
        ? `<div style="margin-bottom:6px;"><b>Whole-genome-doubled (WGD) lines in this selection:</b> ${wgdLines.map(c => _cnEsc(c.name)).join(", ")}. The baseline for these lines is approximately tetraploid, so a relative CN of 1.0 corresponds to ~4 actual copies rather than ~2. The &ldquo;≈ N copies&rdquo; column already accounts for this.</div>`
        : ""
    // Per-line WGS / WES badge in the column header already conveys
    // sequencing modality, so a separate listing of WES lines in the
    // footer would just be redundant. The introductory "Data:" sentence
    // explains what the badge means.
    const wesNote = ""
    tableHtml += `<div style="font-size:0.8rem; color:#374151; margin-top:14px; padding:8px 12px; background:#f9fafb; border-left:3px solid var(--mainColor); border-radius:0 4px 4px 0; line-height:1.5;">
        <div style="margin-bottom:6px;"><b>Data:</b> Gene-level copy number from DepMap&rsquo;s <a href="https://depmap.org/portal/data_page/?tab=allData" target="_blank" rel="noopener">OmicsCNGene dataset</a> (24Q4 release). Copy number values are relative, normalised to each line&rsquo;s own genome-wide baseline: <b>CN = 1.0 represents the line&rsquo;s typical copy count</b> &mdash; <b>2</b> for a non-WGD line and <b>4</b> for a whole-genome-doubled line. The &ldquo;≈ N copies&rdquo; column is rounded to a whole number: <code>round(CN × 2)</code> for non-WGD lines and <code>round(CN × 4)</code> for WGD lines.</div>
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
// cell shows tier-coloured background + "≈ N copies" + tier · CN x.x.
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
    const esc = _cnEsc

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
        // otherwise it lands on the neighbouring header, or off-canvas
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