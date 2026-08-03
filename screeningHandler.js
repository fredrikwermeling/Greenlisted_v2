
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
    // The suggestion curve is driven by how many hypotheses are being tested
    // and how many guides back each one. At this point filteredLibraryMap
    // holds only genes; the control blocks are added below.
    const nGenes = Object.keys(filteredLibraryMap).length
    var nGuides = 0
    for (const symbol in filteredLibraryMap) nGuides += filteredLibraryMap[symbol].length
    const guidesPerGene = nGenes > 0 ? nGuides / nGenes : 3
    // Only kinds that are both requested and actually stocked by this library
    // share the control budget — otherwise ticking a kind the library lacks
    // would silently halve the controls the other kind contributes.
    const wanted = [
        { id: "safeTargeting", on: settings.includeSafeTargeting, count: settings.safeTargetingCount },
        { id: "nonTargeting",  on: settings.includeNonTargeting,  count: settings.nonTargetingCount }
    ].filter(k => k.on)
     .map(k => ({ id: k.id, count: k.count, key: LIB_findControlKey(library.libraryMap, k.id) }))
     .filter(k => k.key)
    var controlsAdded = { nonTargeting: 0, safeTargeting: 0 }
    for (var ki = 0; ki < wanted.length; ki++) {
        const kind = wanted[ki]
        const available = library.libraryMap[kind.key].length
        const requested = parseInt(kind.count, 10)
        const n = (isNaN(requested) || requested <= 0)
            ? SCR_suggestedControlCount(nGenes, guidesPerGene, available, wanted.length, ki)
            : Math.min(requested, available)
        filteredLibraryMap[kind.key] = _randomSample(library.libraryMap[kind.key], n)
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

// How many controls of one kind to suggest, from the number of genes in the
// design.
//
// Why a targeted library needs its own controls at all: in a genome-wide
// screen the null comes from the 85-90% of genes with no phenotype, which
// is why the built-in libraries all ship about 1000 controls regardless of
// size (0.8-2.4% of their guides) — those are a normalisation anchor, not
// the null. A focused library has no neutral majority to borrow from, since
// its genes were chosen precisely for their expected effect, so the
// controls have to define the null themselves.
//
// Two things degrade as the control set shrinks. The null SD is estimated
// from n controls, so the test follows a t distribution with n-1 df and its
// critical value sits above the ideal z. And the control median is the
// normalisation anchor, with SE 1.2533*sd/sqrt(n), which adds noise to
// every gene-vs-control comparison. Combining both gives the factor by
// which a hit gets harder to call than with an unlimited control set. For
// 3 guides/gene, Bonferroni over k genes:
//
//              k=20    k=50   k=100   k=500
//     n=25     1.22    1.24    1.26    1.30
//     n=50     1.10    1.11    1.12    1.14
//     n=100    1.05    1.05    1.06    1.07
//
// Screen size matters surprisingly little: the normalisation term does not
// depend on k at all, and the t-vs-z term grows only slowly.
//
// Guides per gene matters MORE, and in the direction people find backwards.
// The control-noise term is sqrt(1 + 1.571*G/n) — it rises with G, because
// more guides sharpen the gene's own estimate and that makes the baseline's
// noise relatively more important. A sharper measurement needs a sharper
// thing to compare against. The built-in libraries span G=2 (Gattinara,
// Gouda) through 3 (Jacquere, Julianna) and 4 (Brunello, Brie) to 6 (VBC,
// GeCKO v2), so this is not a detail.
//
// Controls needed to hold the penalty under 10%:
//
//     genes    G=2   G=3   G=4   G=6
//        50     49    57    64    79
//       500     61    68    76    91
//
// That surface is near-perfectly linear in log10(genes) and in G, which is
// the fit below — accurate to 0.6 controls from 5 to 20 000 genes and G=2
// to 6. Clamped to [50, 120]: below 50 the curve enters its steep section
// (25 controls costs ~24% even on a 50-gene screen), and above 120 there is
// almost nothing left to buy.
// This is a TOTAL control budget, not a per-kind figure. What the maths
// above cares about is how many guides define the baseline, regardless of
// which flavour they are, so ticking both kinds splits this number rather
// than doubling it.
function SCR_suggestedControlTotal(nGenes, guidesPerGene) {
    const genes = Math.max(1, nGenes)
    const G = (guidesPerGene > 0) ? guidesPerGene : 3
    const curve = Math.round(13.6 + 11.9 * Math.log10(genes) + 7.5 * G)
    return Math.min(Math.max(50, curve), 120)
}

// One kind's share of that budget, when nKinds are being added. The split is
// even, with any remainder going to the earlier kind — safe-targeting is
// listed first, so it wins the odd guide, which suits it being the better
// null. Capped at what the library actually stocks.
function SCR_suggestedControlCount(nGenes, guidesPerGene, nAvailable, nKinds, kindIndex) {
    const total = SCR_suggestedControlTotal(nGenes, guidesPerGene)
    const k = Math.max(1, nKinds || 1)
    const share = Math.floor(total / k) + ((kindIndex || 0) < (total % k) ? 1 : 0)
    return Math.min(share, nAvailable)
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



