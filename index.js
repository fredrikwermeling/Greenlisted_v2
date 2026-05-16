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
    try {
        await CN_loadIfNeeded()
        _cnState.fullCatalogue = CN_listCellLines()
        document.getElementById("cnPickerStatus").textContent =
            `${_cnState.fullCatalogue.length} human cell lines available. Type to filter; click rows to (de)select.`
        _renderCnPicker(_cnState.fullCatalogue)
    } catch (err) {
        document.getElementById("cnPickerStatus").textContent = "Failed to load: " + err.message
    }
}
function CN_closeModal() {
    document.getElementById("cnModal").className = "fazeOut upset-modal-overlay"
}

function _renderCnPicker(list) {
    const selectedIds = new Set(_cnState.selectedCellLines.map(c => c.id))
    const html = list.slice(0, 500).map(c => {
        const sel = selectedIds.has(c.id)
        const sex = c.sex ? `<span style="color:${c.sex.toLowerCase() === "female" ? "#db2777" : c.sex.toLowerCase() === "male" ? "#1d4ed8" : "#9ca3af"};">${c.sex.charAt(0).toUpperCase()}</span>` : ""
        const cancer = [c.disease, c.subtype].filter(Boolean).join(" · ")
        return `<div class="cn-picker-row ${sel ? "selected" : ""}" onclick="CN_togglePickerRow('${c.id}')">
            <span>${sel ? "☑" : "☐"}</span>
            <span>
                <span class="cn-picker-name">${c.name}</span>
                <span class="cn-picker-meta">${sex ? " &middot; " + sex : ""} ${c.lineage ? " &middot; " + c.lineage : ""}</span>
            </span>
            <span class="cn-picker-cancer" title="${cancer.replace(/"/g, "&quot;")}">${cancer}</span>
        </div>`
    }).join("")
    const overflow = list.length > 500
        ? `<div style="padding:6px 10px; font-size:0.75rem; color:#9ca3af; text-align:center;">Showing first 500 of ${list.length}. Type to narrow.</div>`
        : ""
    document.getElementById("cnPickerList").innerHTML = html + overflow
}

function CN_filterPicker() {
    const q = document.getElementById("cnPickerSearch").value.trim().toLowerCase()
    if (!q) { _renderCnPicker(_cnState.fullCatalogue); return }
    const filtered = _cnState.fullCatalogue.filter(c => {
        const hay = [c.name, c.disease, c.subtype, c.lineage, c.id].join(" ").toLowerCase()
        return hay.includes(q)
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
        const rows = []
        const notFound = []
        for (const g of genes) {
            const perLine = {}
            let anyHit = false
            for (const cl of _cnState.selectedCellLines) {
                const v = CN_lookup(cl.id, g)
                if (v != null) anyHit = true
                perLine[cl.id] = { value: v, tier: CN_tier(v) }
            }
            if (!anyHit) notFound.push(g)
            rows.push({ gene: g, perLine })
        }
        _cnState.results = { rows, notFound }
        _cnState.tsvOutput = _cnBuildTsv(rows)
        _createDownloadLink(_cnState.tsvOutput, "CN lookup", document.getElementById("cnDownload"), "text/tab-separated-values", ".tsv")
        const hitGenes = rows.length - notFound.length
        _setStatus("statusSearch", `CN lookup complete: ${hitGenes}/${rows.length} genes found in ${_cnState.selectedCellLines.length} cell line(s)${notFound.length ? `; ${notFound.length} symbol(s) not in matrix` : ""}.`)
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
    const header = ["Gene", ..._cnState.selectedCellLines.map(c => c.name)].join("\t")
    const lines = [header]
    for (const r of rows) {
        const cells = [r.gene]
        for (const cl of _cnState.selectedCellLines) {
            const v = r.perLine[cl.id]?.value
            cells.push(v == null ? "" : v.toFixed(3))
        }
        lines.push(cells.join("\t"))
    }
    return lines.join("\n")
}

function CN_showResults() {
    if (!_cnState.results) return
    const container = document.getElementById("fileContentContainer")
    container.style.display = "block"
    // Replace the <textarea#fileContent> contents with a coloured HTML
    // table when in CN mode. We wrap the table in a div so the textarea
    // can be restored later when leaving CN mode.
    let tableHtml = '<table class="cn-results-table">'
    tableHtml += "<thead><tr><th>Gene</th>"
    for (const cl of _cnState.selectedCellLines) {
        const sex = cl.sex ? ` <span style="color:#9ca3af; font-weight:400;">(${cl.sex.charAt(0).toUpperCase()})</span>` : ""
        const cancer = cl.disease || cl.lineage || ""
        tableHtml += `<th title="${cancer.replace(/"/g, "&quot;")}">${cl.name}${sex}</th>`
    }
    tableHtml += "</tr></thead><tbody>"
    for (const r of _cnState.results.rows) {
        tableHtml += `<tr><td style="font-family:ui-monospace, monospace; font-weight:600;">${r.gene}</td>`
        for (const cl of _cnState.selectedCellLines) {
            const cell = r.perLine[cl.id]
            const v = cell?.value, t = cell?.tier
            if (v == null) {
                tableHtml += `<td class="cn-tier" style="color:#9ca3af; background:#fff;">—</td>`
            } else {
                tableHtml += `<td class="cn-tier" style="color:${t.fg}; background:${t.bg};">${t.label} <span class="cn-num">${v.toFixed(2)}</span></td>`
            }
        }
        tableHtml += "</tr>"
    }
    tableHtml += "</tbody></table>"
    if (_cnState.results.notFound.length) {
        tableHtml += `<div style="font-size:0.8rem; color:#9ca3af; margin-top:8px;">Not in matrix: ${_cnState.results.notFound.join(", ")}</div>`
    }
    tableHtml += `<div style="font-size:0.75rem; color:#9ca3af; margin-top:6px;">CN values are DepMap OmicsCNGeneWGS relative to diploid (1.0 = WT). Tiers: deep del &lt; 0.3 · het loss 0.3&ndash;0.7 · WT 0.7&ndash;1.3 · low gain 1.3&ndash;2.0 · gain 2.0&ndash;3.0 · amp 3.0&ndash;5.0 · strong amp &ge; 5.0.</div>`
    container.innerHTML = tableHtml
}