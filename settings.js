// 
// GRNA 2.0 - 2024
//
// Settings for the UI - essentially all the fields in the UI
// Used in index.js - NOT the service side of the app
//


settings = {
    "trimBefore": null,
    "trimAfter": null,
    "adapterBefore": null,
    "adapterAfter": null,

    "partialMatches": null,

    "rankingTop": null,
    "rankingOrder": null,

    "outputName": null,

    "searchSymbols": null,

    "includeNonTargeting": null,
    "nonTargetingCount": null,
    "includeSafeTargeting": null,
    "safeTargetingCount": null,

    "synonyms": null
}

function SET_settingsSetAll(searchSymbols, partialMatches, trimBefore, trimAfter, adapterBefore, adapterAfter, rankingTop, rankingOrder, outputName, enableSynonyms, defaultSynonym) {
    SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, rankingTop, rankingOrder, outputName)
    SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms)
    settings["synonymName"] = defaultSynonym
}

function SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms) {
    settings["searchSymbols"] = searchSymbols
    settings["partialMatches"] = partialMatches
    settings["enableSynonyms"] = enableSynonyms
}

function SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, rankingTop, rankingOrder, outputName) {
    settings["trimBefore"] = trimBefore
    settings["trimAfter"] = trimAfter
    settings["adapterBefore"] = adapterBefore
    settings["adapterAfter"] = adapterAfter

    settings["rankingTop"] = rankingTop
    settings["rankingOrder"] = rankingOrder
    settings["outputName"] = outputName
}

// Control spike-in, per kind. The count fields are left as raw field
// values: blank means "use the suggested 10% share / minimum 10", a number
// means that many exactly (capped at what the library actually has).
function SET_settingsSetControls(includeNonTargeting, nonTargetingCount, includeSafeTargeting, safeTargetingCount) {
    settings["includeNonTargeting"] = includeNonTargeting
    settings["nonTargetingCount"] = nonTargetingCount
    settings["includeSafeTargeting"] = includeSafeTargeting
    settings["safeTargetingCount"] = safeTargetingCount
}

function SET_settingsSetIndexes(RNAColumn, symbolColumn, rankingColumn) {
    settings["RNAColumn"] = RNAColumn
    settings["symbolColumn"] = symbolColumn
    settings["rankingColumn"] = rankingColumn
}


function SET_settingsToStr() {
    const date = new Date()
    var text = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    for (const setting in settings) {
        if (["synonyms", "usedSynonyms"].includes(setting)) {
            continue
        }
        text = text + ` ${setting} = ${settings[setting]}\n`
    }
    return `${text}`
}
