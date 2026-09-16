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

    // Not a user setting. Set from the selected library, and read only to put
    // each gene's guides in the library's own preferred order.
    "rankingOrder": null,

    "outputName": null,

    "searchSymbols": null,

    "includeSafeTargeting": null,
    "safeTargetingCount": null,
    "includeNonTargeting": null,
    "nonTargetingCount": null,
    "includeEssential": null,
    "essentialCount": null,

    "synonyms": null
}

function SET_settingsSetAll(searchSymbols, partialMatches, trimBefore, trimAfter, adapterBefore, adapterAfter, outputName, enableSynonyms, defaultSynonym) {
    SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, outputName)
    SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms)
    settings["synonymName"] = defaultSynonym
}

function SET_settingsSetLibrary(searchSymbols, partialMatches, enableSynonyms) {
    settings["searchSymbols"] = searchSymbols
    settings["partialMatches"] = partialMatches
    settings["enableSynonyms"] = enableSynonyms
}

function SET_settingsSetSettings(trimBefore, trimAfter, adapterBefore, adapterAfter, outputName) {
    settings["trimBefore"] = trimBefore
    settings["trimAfter"] = trimAfter
    settings["adapterBefore"] = adapterBefore
    settings["adapterAfter"] = adapterAfter
    settings["outputName"] = outputName
}

// Control spike-in, per kind. The count fields are left as raw field
// values: blank means "use the suggested 10% share / minimum 10", a number
// means that many exactly (capped at what the library actually has).
function SET_settingsSetControls(c) {
    settings["includeSafeTargeting"] = c.includeSafeTargeting
    settings["safeTargetingCount"] = c.safeTargetingCount
    settings["includeNonTargeting"] = c.includeNonTargeting
    settings["nonTargetingCount"] = c.nonTargetingCount
    settings["includeEssential"] = c.includeEssential
    settings["essentialCount"] = c.essentialCount
}

// rankingColumn is no longer a user setting. It survives because the built-in
// libraries declare which of their columns carries the on-target score, and
// the guides for each gene are still listed best first, so that _1 is the
// library's own first pick. An uploaded library passes 0: nothing declares
// what its columns mean, so its rows are left in the order they arrived.
function SET_settingsSetIndexes(RNAColumn, symbolColumn, rankingColumn) {
    settings["RNAColumn"] = RNAColumn
    settings["symbolColumn"] = symbolColumn
    settings["rankingColumn"] = rankingColumn == null ? 0 : rankingColumn
}


function SET_settingsToStr() {
    const date = new Date()
    var text = `Library: ${settings.libraryName}, Date: ${date.toLocaleString()}\n`
    for (const setting in settings) {
        // rankingOrder and rankingColumn come from the selected library, not
        // from anything the user set, and listing them here read as though a
        // ranking control were still hiding somewhere. What they do — guides
        // listed best first — is stated in the methods text instead.
        if (["synonyms", "usedSynonyms", "rankingOrder", "rankingColumn"].includes(setting)) {
            continue
        }
        text = text + ` ${setting} = ${settings[setting]}\n`
    }
    return `${text}`
}
