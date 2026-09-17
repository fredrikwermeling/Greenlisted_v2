// 
// GRNA 2.0 - 2024
//
// Logic for handling a session
// This corresponds to a server-side service API
// Used by the UI

//const SETTINGS_URL = 'settingsDefault.json'
const SETTINGS_URL = 'settingsDefault.json'
const LIBRARIES_URL = 'settingsLibraries.json'
const SYNONYM_URL = 'settingsSynonyms.json'
const TEST_SETTINGS_URL = 'settingsTestData.json' //loads when user requests test data

// Selects/activates a library
// does pre-processing of the library to optimaze search
// returns a library structure see settingsLibraries.json
async function SER_selectLibrary(libraryName) {
    //all library files (library data, synonyms and citation info) are in the directory "libraries"
    try {
        var libraries = {}
        try {
            //console.log(`grnaService.selectLibrary(${libraryName}) reading....`)

            // Read library data - can be 80000 rows...
            libraries = await FH_fetchJsonFile(LIBRARIES_URL)
        }
        catch (error) {
            throw new Error(`Could not find library settings file:\n${LIBRARIES_URL}`)
        }

        const libSettings = libraries.find(library => library.name == libraryName)
        if (!libSettings) {
            throw new Error(`Could not find library with name: ${libraryName}`)
        }

        var libraryCitation = ""
        try { //get citation .HTML file
            libraryCitation = await FH_fetchHTMLFile(libSettings.citationFileName)
            libraryCitation = libraryCitation.body.innerHTML
        }
        catch {
            console.log(`Could not find citation file with name: \n${libSettings.citationFileName}\nfor library ${libSettings.name}`)
            libraryCitation = "No citation file found"
        }


        var libData = ""
        try { //get library .txt file
            libData = await FH_fetchTextFile(libSettings.fileName)
        }
        catch {
            throw new Error(`Could not find library file named: ${libSettings.fileName}`)
        }

        /*        var synonymData = ""
                try { //get synonyme .txt file
                    if (libSettings.synonymFileName) {
                        synonymData = await FH_fetchTextFile(libSettings.synonymFileName)
                    }
                }
                catch {
                    throw new Error(`Could not find synonym file named: ${libSettings.synonymFileName}`)
                }*/
        // read synonyms
        // pre-process to create search structure
        LIB_setLibraryData(libSettings, libData, libraryCitation)

        //console.log(`grnaService.selectLibrary(${libraryName}) done.`)
        return libSettings

    } catch (error) {
        throw error
    }
}

async function SER_changeSynonyms(synonymName) {
    var synonymList = []
    try {
        synonymList = await FH_fetchJsonFile(SYNONYM_URL)
    }
    catch {
        throw new Error(`Could not find synonym file named: ${SYNONYM_URL}`)
    }
    const synonymInfo = synonymList.find(synonym => synonym.name == synonymName).fileName
    var synonymData = ""
    try { //get synonyme .txt file
        synonymData = await FH_fetchTextFile(synonymInfo)
    }
    catch {
        throw new Error(`Could not find synonym file named: ${synonymInfo} for name ${synonymName}`)
    }
    LIB_changeSynonyms(synonymData)
}

function SER_selectCustomLibrary(data, settings) {
    return LIB_setLibraryCustomData(data, settings)
}

// returns settings json, see settingsDefault.json for an example
async function SER_getDefaultSettings() {
    try {
        const settings = await FH_fetchJsonFile(SETTINGS_URL)
        return settings
    }
    catch (error) {
        throw new Error(`GRNAService.getDefaultSettings(${SETTINGS_URL}) invalid callback: \n ${error.message}`)
    }

}

// returns settings json, see settingsDefault.json for an example
async function SER_getTestSettings() {
    try {
        const settings = await FH_fetchJsonFile(TEST_SETTINGS_URL)
        return settings
    }
    catch (error) {
        throw new Error(`GRNAService.getDefaultSettings(${TEST_SETTINGS_URL}) invalid callback: \n ${error.message}`)
    }

}

async function SER_getLibraryNames() {
    const libraries = await FH_fetchJsonFile(LIBRARIES_URL)
    const libraryNames = libraries.map(library => library.name)
    return libraryNames
}

async function SER_getSynonymNames() {
    const synonyms = await FH_fetchJsonFile(SYNONYM_URL)
    const synonymNames = synonyms.map(synonymSetting => synonymSetting.name)
    return synonymNames
}
// Start the screening. 
// Settings contains all param, see default settings in settingsDefault.json
function SER_runScreening(settings) {
    try {
        return LIB_startScreening(settings)
    }
    catch (error) {
        throw error
    }
}


function SER_getLibraryCitation() {
    return LIB_libraryCitation()
}

// Closest spellings in the selected library for symbols that matched nothing.
// { symbol: [display names] }, only for symbols with at least one candidate.
function SER_suggestSymbols(searchSymbols, perSymbol) {
    return LIB_suggestSymbols(searchSymbols, perSymbol)
}

// Return a map with symbols not found (keys) and an synonym used (value - often Null)
function SER_getSynonymMap(searchSymbols) {
    return LIB_statusSynonyms(searchSymbols)
}

function SER_getSynonymMapOLD(searchSymbols) {
    return LIB_statusSynonymsOLD(searchSymbols)
}

// ---------------------------- Status functions ------------------------------------------------

// Return a string describing the library status - for example "Unique symbols found: 19674"
function SER_statusLibrarySymbols() {
    return LIB_statusLibrarySymbols()
}

// Return string with status of screening run- for example "Done. Time to complete: 0.2s"
function SER_statusScreening() {
    return LIB_statusScreening()
}