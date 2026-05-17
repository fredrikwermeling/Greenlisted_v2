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
    return false
}




async function insertData(data) {
    console.log(data)
    document.getElementById("trimBefore").min = 0
    document.getElementById("trimBefore").value = data.trimBefore

    document.getElementById("trimAfter").min = 0
    document.getElementById("trimAfter").value = data.trimAfter

    document.getElementById("adapterBefore").defaultValue = data.adaptorBefore;
    document.getElementById("adapterAfter").defaultValue = data.adaptorAfter;

    document.getElementById("numberToRank").value = data.rankingTop
    document.getElementById("numberToRank").defaultValue = ""


    document.getElementById("searchSymbols").value = data.searchSymbols.join("\n")
    document.getElementById("outputFileName").value = data.outputName
    document.getElementById("outputFileName").defaultValue = ""

    document.getElementById("partialMatches").checked = data.partialMatches
    document.getElementById("enableSynonyms").checked = data.enableSynonyms

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
        if (symbolsTitle) symbolsTitle.textContent = "Symbols"
        if (inputPlateTitle) inputPlateTitle.textContent = "2. Input symbols"
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

    if (symbolsTitle) symbolsTitle.textContent = "Enter sgRNA sequences"
    if (inputPlateTitle) inputPlateTitle.textContent = "2. Input sgRNA"
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
    for (const h of headers) {
        html += `<th>${h}</th>`
    }
    html += '</tr></thead><tbody>'
    for (var i = dataStart + 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter)
        html += '<tr>'
        for (const c of cols) {
            html += `<td>${c}</td>`
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

function _showTableOutput(text, delimiter) {
    const container = document.getElementById("fileContentContainer")
    container.style.display = "flex"
    document.getElementById("fileContent").style.display = "none"
    var tableDiv = document.getElementById("validationTableDiv")
    if (!tableDiv) {
        tableDiv = document.createElement("div")
        tableDiv.id = "validationTableDiv"
        tableDiv.style.overflowX = "auto"
        tableDiv.style.width = "100%"
        container.appendChild(tableDiv)
    }
    tableDiv.style.display = "block"
    tableDiv.innerHTML = _renderTsvAsTable(text, delimiter)
}

function showValidationOutput() {
    const container = document.getElementById("fileContentContainer")
    container.style.display = "flex"
    document.getElementById("fileContent").style.display = "none"
    var tableDiv = document.getElementById("validationTableDiv")
    if (!tableDiv) {
        tableDiv = document.createElement("div")
        tableDiv.id = "validationTableDiv"
        tableDiv.style.overflowX = "auto"
        tableDiv.style.width = "100%"
        container.appendChild(tableDiv)
    }
    tableDiv.style.display = "block"
    tableDiv.innerHTML = _renderValidationTsvAsTable(_validateState.resultsOutput)
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
    const container = document.getElementById("fileContentContainer")
    container.style.display = "flex"
    document.getElementById("fileContent").style.display = "none"
    var tableDiv = document.getElementById("validationTableDiv")
    if (!tableDiv) {
        tableDiv = document.createElement("div")
        tableDiv.id = "validationTableDiv"
        tableDiv.style.overflowX = "auto"
        tableDiv.style.width = "100%"
        container.appendChild(tableDiv)
    }
    tableDiv.style.display = "block"
    tableDiv.innerHTML = _renderTsvAsTable(_validateState.notFoundOutput)
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
        const fullOutput = _createFullTxtOutput(searchOutput.filteredLibraryMap, searchOutput.headers)
        const notFoundOutput = _createSymbolNotFound(searchOutput.usedSynonyms)
        const adapterOutput = _createAdapterOutput(searchOutput.filteredLibraryMap)
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
}

function _createAdapterOutput(libraryMap) {
    const date = new Date()
    var out = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    var out = out + "Symbol\tSymbol_ID\tsgRNA + adapter(s)\n"

    for (var symbol of Object.keys(libraryMap)) {
        for (var i = 0; i < libraryMap[symbol].length; i++) {
            const row = libraryMap[symbol][i]
            const capitalizedSymbol = row[settings.symbolColumn - 1].trim()
            out = out + `${capitalizedSymbol}\t${capitalizedSymbol}_${i + 1}\t${_applyPostProcessing(row[settings.RNAColumn - 1])}\n`

        }
    }
    return out
}


function _createMAGeCKOutput(libraryMap) {
    var out = "sgRNA_ID,Sequence,Gene\n"
    for (var symbol of Object.keys(libraryMap)) {

        for (var i = 0; i < libraryMap[symbol].length; i++) {
            const row = libraryMap[symbol][i]
            const capitalizedSymbol = row[settings.symbolColumn - 1].trim()
            out = out + `${capitalizedSymbol}_${i + 1},${_applyTrim(row[settings.RNAColumn - 1])},${capitalizedSymbol}\n`

        }
    }
    return out
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

function _showTextareaOutput(text) {
    document.getElementById("fileContentContainer").style.display = "flex"
    document.getElementById("fileContent").style.display = ""
    var tableDiv = document.getElementById("validationTableDiv")
    if (tableDiv) tableDiv.style.display = "none"
    _setStatus("fileContent", text, false)
}

function showAdapterOutput() {
    _showTableOutput(outputTexts.textOutputAdapter)
}

function showMAGeCKOutput() {
    _showTableOutput(outputTexts.textOutputMAGeCK, ",")
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
    _statusUpdateSettings()
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
    selectedCellLines: [],    // [{id, name, sex, disease, lineage}, ...]
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
    } catch (err) {
        document.getElementById("cnPickerStatus").textContent = "Failed to load: " + err.message
        if (progBox) progBox.style.display = "none"
    }
}
function CN_closeModal() {
    document.getElementById("cnModal").className = "fazeOut upset-modal-overlay"
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
    // estimates have been scaled to the line's actual ploidy.
    if (wgd !== true) return ""
    return ` <span title="Whole-genome-doubled: this line's genome was duplicated at some point, so its baseline is roughly tetraploid (≈ 4 copies of each gene, not 2). DepMap reports CN relative to that line-specific baseline, and the &lsquo;≈ N copies&rsquo; column already multiplies by the measured ploidy to give a true copy count." style="font-size:0.65rem; padding:1px 4px; border-radius:6px; background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-weight:600; letter-spacing:0.03em;">WGD</span>`
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
    const filtered = _cnState.fullCatalogue.filter(c => {
        const hay = [c.name, c.disease, c.subtype, c.lineage, c.id].join(" ")
        return tokenRegexes.every(re => re.test(hay))
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
}

function CN_confirmSelection() {
    if (_cnState.selectedCellLines.length === 0) return
    CN_closeModal()
    _cnEnterMode()
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
    if (symbolsTitle) symbolsTitle.textContent =
        `Gene symbols (CN lookup in ${_cnState.selectedCellLines.length} cell line${_cnState.selectedCellLines.length === 1 ? "" : "s"}: ${_cnState.selectedCellLines.map(c => c.name).slice(0, 5).join(", ")}${_cnState.selectedCellLines.length > 5 ? ", …" : ""})`
    if (inputPlateTitle) inputPlateTitle.textContent = "2. Input gene symbols"
    document.getElementById("searchSymbols").value = ""
    _setStatus("statusSearchSymbolsRows", "")
}

function _cnExitMode() {
    _cnState.isMode = false
    _cnState.selectedCellLines = []
    document.body.classList.remove("cn-mode")
    const symbolsTitle = document.getElementById("symbolsTitle")
    const inputPlateTitle = document.getElementById("inputPlateTitle")
    if (symbolsTitle) symbolsTitle.textContent = "Symbols"
    if (inputPlateTitle) inputPlateTitle.textContent = "2. Input symbols"
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
                    perLine[cl.id] = { value: v, tier: CN_tier(v), copies: CN_approxCopies(v, cl.ploidy) }
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
        _createDownloadLink(_cnState.tsvOutput, "CN lookup", document.getElementById("cnDownload"), "text/tab-separated-values", ".tsv")
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
    // Prefix-row: cell-line ploidy / WGD context so TSV is self-describing.
    const ploidyHeader = "# Cell-line ploidy: " + _cnState.selectedCellLines.map(c =>
        `${c.name} = ${c.knownPloidy ? c.ploidy.toFixed(2) + (c.wgd ? " WGD" : "") : "unknown"}`
    ).join("; ")
    const sourceLine = "# Data: Gene-level copy number from DepMap OmicsCNGene dataset (24Q4 release). Copy number values are relative where 1.0 = each line's own genome-wide baseline. The '~copies' column rescales by the line's measured ploidy: round(CN × ploidy × 2) / 2."
    const header = ["Gene", "ResolvedSymbol", "ViaSynonym", ..._cnState.selectedCellLines.map(c => c.name + " (CN)"), ..._cnState.selectedCellLines.map(c => c.name + " (~copies)")].join("\t")
    const lines = [sourceLine, ploidyHeader, header]
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

function CN_showResults() {
    if (!_cnState.results) return
    const container = document.getElementById("fileContentContainer")
    container.style.display = "block"

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
        const ploidyNote = cl.knownPloidy
            ? `ploidy ${cl.ploidy.toFixed(1)}${cl.wgd ? " · WGD" : ""}`
            : ""
        const sourceTag = ""
        return `<th style="min-width:170px; max-width:240px; padding:6px 10px; vertical-align:top;" title="${cancer.replace(/"/g, "&quot;")}">
            <div style="text-align:center; font-weight:600; white-space:nowrap;">${_sexGlyph(cl.sex)} ${cl.name}${_wgdBadge(cl.wgd, cl.ploidy)}${sourceTag}</div>
            <div style="font-size:0.72rem; color:#6b7280; font-weight:400; text-align:center; line-height:1.3; margin-top:2px; word-break:break-word; white-space:normal;">${cancer || "&mdash;"}</div>
            ${ploidyNote ? `<div style="font-size:0.65rem; color:#9ca3af; text-align:center; margin-top:2px;">${ploidyNote}</div>` : ""}
        </th>`
    }).join("")

    let tableHtml = `<table class="cn-results-table" style="width:auto;">`
    tableHtml += `<thead><tr><th style="text-align:left;">Gene</th>${headerCells}</tr></thead><tbody>`
    for (const r of _cnState.results.rows) {
        const synNote = r.viaSynonym
            ? ` <span title="Matched via synonym" style="font-size:0.65rem; color:#92400e; background:#fef3c7; padding:1px 4px; border-radius:6px; border:1px solid #fde68a; margin-left:4px;">via ${r.resolved}</span>`
            : ""
        tableHtml += `<tr><td style="font-family:ui-monospace, monospace; font-weight:600; white-space:nowrap;">${r.gene}${synNote}</td>`
        for (const cl of _cnState.selectedCellLines) {
            const cell = r.perLine[cl.id]
            const v = cell?.value, t = cell?.tier, copies = cell?.copies
            if (v == null) {
                tableHtml += `<td class="cn-tier" style="color:#9ca3af; background:#fff; min-width:170px; max-width:240px; padding:6px 10px;">—</td>`
            } else {
                const copyStr = copies != null
                    ? (copies === Math.floor(copies)
                        ? `≈ ${copies} cop${copies === 1 ? 'y' : 'ies'}`
                        : `≈ ${copies} copies`)
                    : ""
                tableHtml += `<td class="cn-tier" style="color:${t.fg}; background:${t.bg}; min-width:170px; max-width:240px; padding:6px 10px;">
                    <div style="font-weight:600;">${copyStr}</div>
                    <div style="font-size:0.7rem; opacity:0.75; margin-top:2px;">${t.label} · CN ${v.toFixed(1)}</div>
                </td>`
            }
        }
        tableHtml += "</tr>"
    }
    tableHtml += "</tbody></table>"
    if (_cnState.results.notFound.length) {
        tableHtml += `<div style="font-size:0.85rem; color:#7f1d1d; margin-top:10px;"><b>Not found</b> in DepMap matrix (no direct hit, no synonym match): <code>${_cnState.results.notFound.join(", ")}</code></div>`
    }
    // Footer: data source + ploidy / WGD explanation + tier legend + link.
    const wgdLines = _cnState.selectedCellLines.filter(c => c.wgd === true)
    const wgdNote = wgdLines.length > 0
        ? `<div style="margin-bottom:6px;"><b>Whole-genome-doubled (WGD) lines in this selection:</b> ${wgdLines.map(c => c.name).join(", ")}. The baseline for these lines is approximately tetraploid, so a relative CN of 1.0 corresponds to ~4 actual copies rather than ~2. The &ldquo;≈ N copies&rdquo; column already accounts for this.</div>`
        : ""
    // Per-line WGS / WES badge in the column header already conveys
    // sequencing modality, so a separate listing of WES lines in the
    // footer would just be redundant. The introductory "Data:" sentence
    // explains what the badge means.
    const wesNote = ""
    tableHtml += `<div style="font-size:0.8rem; color:#374151; margin-top:14px; padding:8px 12px; background:#f9fafb; border-left:3px solid var(--mainColor); border-radius:0 4px 4px 0; line-height:1.5;">
        <div style="margin-bottom:6px;"><b>Data:</b> Gene-level copy number from DepMap&rsquo;s <a href="https://depmap.org/portal/data_page/?tab=allData" target="_blank" rel="noopener">OmicsCNGene dataset</a> (24Q4 release). Copy number values are relative, normalised to each line&rsquo;s own genome-wide baseline: <b>CN = 1.0 represents the line&rsquo;s typical copy count</b> &mdash; roughly 2 for a diploid line and roughly 4 for a whole-genome-doubled line. The &ldquo;≈ N copies&rdquo; column rescales by the line&rsquo;s measured ploidy &mdash; <code>round(CN × ploidy × 2) / 2</code> &mdash; to estimate the actual copy count.</div>
        ${wgdNote}
        ${wesNote}
        <div style="margin-bottom:6px;"><b>Why some copies aren&rsquo;t whole numbers.</b> Inside any single cell a gene has a whole-number copy count (0, 1, 2, 3, &hellip;), but a cell line growing in a flask is not a single cell &mdash; it&rsquo;s millions of cells that have drifted apart genetically over many generations. Sequencing reads the average across that population, so a reported value of, say, 1.5 copies usually means roughly half the cells have lost a copy of the gene (1 copy) while the other half still have both (2 copies). For CRISPR knockout this matters: the line is a mixed substrate, with some cells needing one cut and others needing two to lose the gene entirely.</div>
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
    container.innerHTML = tableHtml
}