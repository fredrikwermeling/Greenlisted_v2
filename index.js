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
    human: "GAGCGCTGCTCAGATAGCGA\nAAGATGAAGAATGCCCACAA\nGTGGAGTGGACTTCCAGCTA",
    mouse: "GTGTAATAGCTCCTGCATGG\nACAGGTAGAAGCCCCCCATA\nGTTGCATGGAGCAGCTACTA"
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

    if (symbolsTitle) symbolsTitle.textContent = "Enter 1-10 sgRNA sequences"
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

        // Validate: max 10 sequences
        if (sequences.length > 10) {
            _setStatus("statusSearch", "Error: Maximum 10 sgRNA sequences allowed")
            _toggleLigtBox()
            statusText.classList.remove("pulse")
            return
        }

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

function _renderTsvAsTable(tsv) {
    const lines = tsv.trim().split("\n").filter(l => l.length > 0)
    if (lines.length === 0) return "<p>No data</p>"
    var html = '<table class="validationResultsTable"><thead><tr>'
    const headers = lines[0].split("\t")
    for (const h of headers) {
        html += `<th>${h}</th>`
    }
    html += '</tr></thead><tbody>'
    for (var i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t")
        html += '<tr>'
        for (const c of cols) {
            html += `<td>${c}</td>`
        }
        html += '</tr>'
    }
    html += '</tbody></table>'
    return html
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
    tableDiv.innerHTML = _renderTsvAsTable(_validateState.resultsOutput)
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
    var out = ""
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
    _showTextareaOutput(outputTexts.textOutputAdapter)
}

function showMAGeCKOutput() {
    _showTextareaOutput(outputTexts.textOutputMAGeCK)
}

function showFullOutput() {
    _showTextareaOutput(outputTexts.textOutputFull)
}

function showNotFoundOutput() {
    _showTextareaOutput(outputTexts.textOutputNotFound)
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
    var a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = folderName + ".zip"
    a.click()
}

async function downloadAllValidation() {
    const name = document.getElementById("outputFileName").value || "validation"
    const folderName = _generateZipName(name)
    const zip = new JSZip()
    const folder = zip.folder(folderName)
    folder.file(name + " Validation Results.tsv", _validateState.resultsOutput)
    folder.file(name + " Not Found.tsv", _validateState.notFoundOutput)
    const blob = await zip.generateAsync({ type: "blob" })
    var a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = folderName + ".zip"
    a.click()
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
        _setStatus("statusSearchSymbolsRows", `${lines.length} sequence(s) entered (max 10)`)
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