
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
    // Every ticked kind shares the control budget, whether this library stocks
    // it or it has to be borrowed from the species-matched donor — what the
    // budget measures is how many guides define the baseline, not where they
    // came from.
    const wanted = [
        { id: "safeTargeting", on: settings.includeSafeTargeting, count: settings.safeTargetingCount },
        { id: "nonTargeting",  on: settings.includeNonTargeting,  count: settings.nonTargetingCount }
    ].filter(k => k.on)
     .map(k => ({ id: k.id, count: k.count, key: LIB_findControlKey(library.libraryMap, k.id) }))
    const sharingIds = wanted.map(k => k.id)
    var controlsAdded = { nonTargeting: 0, safeTargeting: 0 }
    // Per kind, not per run: a library can stock one kind and borrow the
    // other, as Brunello, Brie and both GeCKO v2 libraries do.
    var controlsBorrowedFrom = {}
    for (var ki = 0; ki < wanted.length; ki++) {
        const kind = wanted[ki]
        const requested = parseInt(kind.count, 10)
        if (kind.key) {
            const available = library.libraryMap[kind.key].length
            const n = (isNaN(requested) || requested <= 0)
                ? SCR_suggestedControlCount(nGenes, guidesPerGene, available, sharingIds, kind.id)
                : Math.min(requested, available)
            filteredLibraryMap[kind.key] = _randomSample(library.libraryMap[kind.key], n)
            controlsAdded[kind.id] = n
        } else {
            // This library ships none of this kind, so take them from the
            // species-matched donor. LIB_borrowedControlRows drops any guide
            // that would break the host library's own design convention.
            const probe = LIB_borrowedControlRows(kind.id, settings.librarySpecies, 0)
            if (!probe.symbol || !probe.available) continue
            const n = (isNaN(requested) || requested <= 0)
                ? SCR_suggestedControlCount(nGenes, guidesPerGene, probe.available, sharingIds, kind.id)
                : Math.min(requested, probe.available)
            const borrowed = LIB_borrowedControlRows(kind.id, settings.librarySpecies, n)
            if (!borrowed.rows.length) continue
            filteredLibraryMap[borrowed.symbol.toLowerCase()] = borrowed.rows
            controlsAdded[kind.id] = borrowed.rows.length
            controlsBorrowedFrom[kind.id] = borrowed.source
        }
    }

    searchOutput = {
        "headers": library.headers,
        "filteredLibraryMap": filteredLibraryMap,
        "usedSynonyms": usedSynonyms,
        "controlsAdded": controlsAdded,
        "controlsBorrowedFrom": controlsBorrowedFrom,
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
// Rounded to the nearest 5. The curve is an estimate resting on assumed
// guide-level noise, so its last digit is false precision — 50 and 52 do
// not differ in any way a screen would notice, and a round number reads as
// the judgement call it is.
function SCR_suggestedControlTotal(nGenes, guidesPerGene) {
    const genes = Math.max(1, nGenes)
    const G = (guidesPerGene > 0) ? guidesPerGene : 3
    const curve = 13.6 + 11.9 * Math.log10(genes) + 7.5 * G
    return Math.min(Math.max(50, Math.round(curve / 5) * 5), 120)
}

// Safe-targeting controls cut the genome, so they carry the same
// double-strand-break cost as a real guide and make the honest baseline;
// non-targeting controls never cut and so flatter it. When both are added
// the budget is therefore weighted 2:1 toward safe-targeting, which keeps
// the primary null usable if the analysis leans on it alone.
const _CONTROL_WEIGHT = { safeTargeting: 2, nonTargeting: 1 }

// One kind's share of the budget. kindIds lists every kind sharing it, in
// display order. Capped at what the library actually stocks.
function SCR_suggestedControlCount(nGenes, guidesPerGene, nAvailable, kindIds, kindId) {
    const total = SCR_suggestedControlTotal(nGenes, guidesPerGene)
    const ids = (kindIds && kindIds.length) ? kindIds : [kindId]
    const weight = id => _CONTROL_WEIGHT[id] || 1
    const sum = ids.reduce((s, id) => s + weight(id), 0)
    var share
    if (ids[ids.length - 1] === kindId) {
        // The last kind takes what's left, so the shares total exactly.
        var used = 0
        for (var i = 0; i < ids.length - 1; i++) used += Math.round(total * weight(ids[i]) / sum)
        share = total - used
    } else {
        share = Math.round(total * weight(kindId) / sum)
    }
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



