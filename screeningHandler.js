
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
        const panel = LIB_essentialPanel(isNaN(requested) || requested <= 0 ? _ESSENTIAL_DEFAULT : requested)
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
// number: 20% of the targeting guides, floored at 50 and capped at 200,
// then capped again at what the library ships.
//
// Why a targeted library needs its own controls at all: in a genome-wide
// screen the null comes from the 85-90% of genes with no phenotype, which
// is why the built-in libraries all ship about 1000 controls regardless of
// size (0.8-2.4% of their guides) — those are a normalisation anchor, not
// the null. A focused library has no neutral majority to borrow from, since
// its genes were chosen precisely for their expected effect, so the
// controls have to define the null themselves.
//
// Where 50 and 200 come from. Two things degrade when the control set is
// small. The null SD is estimated from n controls, so the test follows a t
// distribution with n-1 df and its critical value sits above the ideal z.
// And the control median is the normalisation anchor, with SE 1.2533*sd/√n,
// which adds noise to every gene-vs-control comparison. Combining both, for
// 3 guides/gene and Bonferroni over 500 genes, the effective detection
// threshold relative to an unlimited control set is:
//
//     n=25  1.30x     n=50  1.14x     n=100  1.07x
//     n=200 1.03x     n=500 1.01x
//
// So 25 controls makes a hit ~30% harder to call, 50 costs ~14%, and past
// 200 there is essentially nothing left to buy. The floor keeps a compact
// screen out of the steep part of that curve; the cap stops a large design
// from spending reads on guides that no longer add power.
function SCR_suggestedControlCount(nTargetingGuides, nAvailable) {
    const scaled = Math.min(Math.max(50, Math.round(nTargetingGuides * 0.2)), 200)
    return Math.min(scaled, nAvailable)
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



