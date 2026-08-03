
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

    // Essential-gene positive controls are ordinary genes, so they join the
    // symbol list here rather than being spiked in later — that way they are
    // ranked and top-N sliced exactly like a gene the user typed.
    var essentialAdded = []
    if (settings.includeEssential) {
        const requested = parseInt(settings.essentialCount, 10)
        const panel = LIB_essentialPanel(isNaN(requested) || requested <= 0 ? 5 : requested)
        for (const gene of panel) {
            if (!library.librarySymbolSet.has(gene)) continue
            if (machingSymbols.indexOf(gene) === -1) machingSymbols.push(gene)
            essentialAdded.push(gene)
        }
    }

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
        { id: "safeTargeting", on: settings.includeSafeTargeting, count: settings.safeTargetingCount },
        { id: "nonTargeting",  on: settings.includeNonTargeting,  count: settings.nonTargetingCount }
    ].filter(k => k.on)
    var controlsAdded = { nonTargeting: 0, safeTargeting: 0 }
    for (const kind of wanted) {
        const key = LIB_findControlKey(library.libraryMap, kind.id)
        if (!key) continue
        const available = library.libraryMap[key].length
        const requested = parseInt(kind.count, 10)
        const n = (isNaN(requested) || requested <= 0)
            ? SCR_suggestedControlCount(nTargeting, available)
            : Math.min(requested, available)
        filteredLibraryMap[key] = _randomSample(library.libraryMap[key], n)
        controlsAdded[kind.id] = n
    }

    searchOutput = {
        "headers": library.headers,
        "filteredLibraryMap": filteredLibraryMap,
        "usedSynonyms": usedSynonyms,
        "controlsAdded": controlsAdded,
        "essentialAdded": essentialAdded
    }
    return searchOutput
}

// A random subset of n rows, drawn fresh on every run so two designs built
// from the same settings don't ship the identical control guides. Partial
// Fisher-Yates over the indices (no full shuffle of a 900-row block), then
// sorted so the picked guides still appear in library order in the output.
function _randomSample(rows, n) {
    if (n >= rows.length) return rows.slice()
    const idx = rows.map((_, i) => i)
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (idx.length - i))
        const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp
    }
    return idx.slice(0, n).sort((a, b) => a - b).map(i => rows[i])
}

// Total sgRNAs across every symbol in a library map.
function _countGuides(libraryMap) {
    var n = 0
    for (const symbol in libraryMap) n += libraryMap[symbol].length
    return n
}

// How many controls of one kind to spike in when the user hasn't named a
// number: 20% of the targeting guides, floored at 50, capped at what the
// library ships.
//
// The floor matters more than the percentage. In a genome-wide screen the
// null distribution comes from the ~85-90% of genes with no phenotype, and
// the control block is a normalisation anchor — which is why the built-in
// libraries all ship about 1000 controls regardless of size (0.8-2.4%). A
// targeted library has no neutral majority to borrow from, because its
// genes were picked precisely for their expected effect, so the controls
// have to define the null on their own. The error on an estimated null SD
// is roughly 1/sqrt(2(n-1)): ~24% at n=10, ~10% at n=50, ~7% at n=100. The
// floor keeps a small focused screen out of the range where the threshold
// itself is guesswork.
function SCR_suggestedControlCount(nTargetingGuides, nAvailable) {
    return Math.min(Math.max(50, Math.round(nTargetingGuides * 0.2)), nAvailable)
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



