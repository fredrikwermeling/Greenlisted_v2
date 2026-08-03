
// 
// GRNA 2.0 - 2024
//
// Library screening logic
// used by the library so execute a search
//


function SCR_startScreening(library, settings, usedSynonyms) {
    var machingSymbols = []
    if (!settings.partialMatches) {
        machingSymbols = settings.searchSymbols.filter(symbol => library.librarySymbolSet.has(symbol)) //maches without synonyms
        machingSymbols.push(...Object.values(usedSynonyms).flat()) //synonym maches
    }
    else {
        machingSymbols = Object.keys(library.libraryMap).filter(librarySymbol =>
            settings.searchSymbols.some(searchSymbol => librarySymbol.includes(searchSymbol))
        )
    }

    //machingSymbols now contains all symbols found in library maching the searched symbols
    //creates map containing maching symbols
    var filteredLibraryMap = {}
    for (let i = 0; i < machingSymbols.length; i++) {
        filteredLibraryMap[machingSymbols[i]] = [...library.libraryMap[machingSymbols[i]]]  //creates copy
    }

    if ((settings.rankingColumn != 0) || (settings.rankingColumn == null)) {
        filteredLibraryMap = _sortOnScore(filteredLibraryMap, settings.rankingOrder, settings.rankingColumn)
    }

    if (settings.rankingTop > 0) {
        filteredLibraryMap = _getTopRankingElements(filteredLibraryMap, settings.rankingTop)
    }

    // Controls are spiked in after ranking and top-N slicing. They carry no
    // on-target score to rank by, and "limit to top N" is meant to thin each
    // gene's guides — applying it to a control block would silently cut a
    // 900-guide control set down to N.
    const nTargeting = _countGuides(filteredLibraryMap)
    const wanted = [
        { id: "nonTargeting",  on: settings.includeNonTargeting,  count: settings.nonTargetingCount },
        { id: "safeTargeting", on: settings.includeSafeTargeting, count: settings.safeTargetingCount }
    ].filter(k => k.on)
    var controlsAdded = { nonTargeting: 0, safeTargeting: 0 }
    for (const kind of wanted) {
        const key = LIB_findControlKey(library.libraryMap, kind.id)
        if (!key) continue
        const available = library.libraryMap[key].length
        const requested = parseInt(kind.count, 10)
        const n = (isNaN(requested) || requested <= 0)
            ? SCR_suggestedControlCount(nTargeting, available, wanted.length)
            : Math.min(requested, available)
        // Deterministic slice from the top of the control block, so the same
        // settings always regenerate an identical library file.
        filteredLibraryMap[key] = library.libraryMap[key].slice(0, n)
        controlsAdded[kind.id] = n
    }

    searchOutput = {
        "headers": library.headers,
        "filteredLibraryMap": filteredLibraryMap,
        "usedSynonyms": usedSynonyms,
        "controlsAdded": controlsAdded
    }
    return searchOutput
}

// Total sgRNAs across every symbol in a library map.
function _countGuides(libraryMap) {
    var n = 0
    for (const symbol in libraryMap) n += libraryMap[symbol].length
    return n
}

// How many controls of one kind to spike in when the user hasn't named a
// number: 10% of the targeting guides, divided across the control kinds
// selected, floored at 10 per kind so a small pilot list still gets enough
// controls to estimate a null distribution from, and capped at what the
// library actually ships. The floor dominates for small designs — a 200-gene
// screen is where the 10% starts to matter.
function SCR_suggestedControlCount(nTargetingGuides, nAvailable, nKinds) {
    const share = nTargetingGuides * 0.1 / (nKinds > 0 ? nKinds : 1)
    return Math.min(Math.max(10, Math.round(share)), nAvailable)
}

function _sortOnScore(libraryMap, rankingOrder, rankingColumn) {
    for (const symbol in libraryMap) {
        if (rankingOrder == "ascending") {
            libraryMap[symbol].sort((a, b) => a[rankingColumn - 1] - b[rankingColumn - 1])
        }
        else {
            libraryMap[symbol].sort((a, b) => b[rankingColumn - 1] - a[rankingColumn - 1])
        }
    }
    return libraryMap
}

function _getTopRankingElements(libraryMap, n) {
    for (let symbol in libraryMap) {
        libraryMap[symbol] = libraryMap[symbol].slice(0, n)
    }
    return libraryMap
}



