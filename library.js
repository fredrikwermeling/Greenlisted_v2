// 
// GRNA 2.0 - 2024
//
// Handles a library
// Used by the grnaService
//


// State holding the currently selected library
var _library = {
    /*
    libraryMap ={
        symbol1(in lower case) :[all rows containing symbol1 splitt by \t]
        symbol2: ...
    }
     */
    "libraryMap": {},
    "librarySymbolSet": new Set(), //a set containing all symbols in the library
    "libraryStatus": "",
    /*
    synonym map contain all symbols that have synonyms as keys and all ther synonyms as values
    synonymMap = {
        symbol1: [set of all synonyms to symbol1],
        symbol2: [set of all synonyms to symbol2]
    }
    */
    "synonymMap": {},

    /* string with tab-separetd column headers*/
    "headers": "",

    /* status of the last screening, for example "Done. Found 2345 symbols"  */
    "statusSearch": "",

    /* string with html describing the library */
    "citationInfo": ""
}


// The two kinds of control sgRNA the libraries ship, and the symbols they
// are filed under. Compared lower-case, since libraryMap is keyed that way.
//
//   Non-targeting (NegCtrl) — sequences with no match anywhere in the
//     genome (NO_SITE_n / NEG_CONTROL_n / NonTargetingControlGuideForHuman_n).
//     They control for the vector and the selection, but not for cutting.
//   Safe-targeting (CutCtrl) — a single cut site in a gene desert. They
//     control for the DNA-damage response that any double-strand break
//     provokes, which non-targeting guides cannot.
//
// Availability in the built-in libraries:
//   NegCtrl  1000  Brunello, Brie, GeCKO v2 human, GeCKO v2 mouse
//            500   Gattinara, Gouda
//            100   Jacquere, Julianna
//   CutCtrl  900   Jacquere, Julianna
//            500   Gattinara, Gouda
//   VBC human and VBC mouse ship neither.
//
// "CTRL" / "Ctrl" is deliberately NOT in these lists: that is the
// chymotrypsin-like protease gene, which appears in every library with a
// handful of ordinary targeting guides. Treating it as a control block
// would silently swap a real gene's guides for controls.
const _CONTROL_KINDS = [
    {
        id: "nonTargeting",
        label: "Non-targeting",
        symbols: ["negctrl", "negcontrol", "neg_control", "negative_control",
                  "nontargeting", "non-targeting", "non_targeting"]
    },
    {
        id: "safeTargeting",
        label: "Safe-targeting",
        symbols: ["cutctrl", "safectrl", "safe_ctrl", "safetargeting",
                  "safe-targeting", "safe_targeting"]
    }
]

// Positive-control panel: core-essential genes that drop out in virtually
// every proliferating line, so a screen that worked shows them depleted.
//
// Ordered so the default first three span distinct processes — RAN (nuclear
// transport), RPS8 (ribosome), PLK1 (mitosis) — and a partial failure tells
// you which process did not respond. After that the order follows how rarely
// the gene is lost across the 1929 DepMap lines (fraction with CN < 0.5):
//   RAN 0.10%  RPS8 0.16%  PLK1 0.16%  SF3B1 0.05%  EIF3B 0.36%
//   KIF11 0.52%  CDK1 0.52%  RPL9 0.57%  POLR2A 2.28%
//
// POLR2A is deliberately last. It sits on 17p13 next to TP53 and its copy
// number tracks TP53's at r = 0.92, so across the 414 lines that have lost
// the TP53 region its mean CN is 0.62 against 0.92 overall — a positive
// control that is itself hemizygous in a fifth of cell lines.
//
// PSMA1 was dropped: Jacquere carries only one guide for it, against three
// for every other gene here.
//
// Unlike the NegCtrl / CutCtrl blocks these are ordinary genes, so they are
// added to the search list and picked up by the normal library lookup —
// they get ranked and top-N sliced exactly like a gene the user typed.
const _ESSENTIAL_PANEL = [
    "ran", "rps8", "plk1", "sf3b1", "eif3b",
    "kif11", "cdk1", "rpl9", "polr2a"
]

// Default size of the positive-control panel.
const _ESSENTIAL_DEFAULT = 3

// The first n genes of the essential panel. Deliberately NOT randomised:
// a positive-control panel is only useful if you know what to expect from
// it, and a set that changes composition between runs cannot be compared
// across experiments.
function LIB_essentialPanel(n) {
    return _ESSENTIAL_PANEL.slice(0, Math.max(1, Math.min(n, _ESSENTIAL_PANEL.length)))
}

// Control guides borrowed from another library, for the ones that ship none.
// VBC human and VBC mouse are the only built-ins without any, so a screen
// designed from them has no baseline unless it borrows. Loaded on demand from
// controlGuides.json; see tools/build_control_guides.py.
var _borrowedControls = { data: null, loading: null }

async function LIB_loadBorrowedControls() {
    if (_borrowedControls.data) return _borrowedControls.data
    if (!_borrowedControls.loading) {
        _borrowedControls.loading = FH_fetchJsonFile("controlGuides.json")
            .then(d => { _borrowedControls.data = d; return d })
            .catch(e => { console.warn("Could not load controlGuides.json:", e); return null })
    }
    return _borrowedControls.loading
}

// What the selected library's own guides look like. Used to decide whether a
// borrowed guide would fit: VBC's spacers all begin with G, because that is
// what its U6 promoter design requires, and dropping in a guide that starts
// with anything else would break that. Read from the library rather than
// hardcoded, so an uploaded library with the same convention is respected.
function LIB_guideConvention() {
    var checked = 0, startG = 0
    const lengths = new Set()
    for (const symbol in _library.libraryMap) {
        for (const row of _library.libraryMap[symbol]) {
            const seq = (row[_library.rnaColumn - 1] || "").trim().toUpperCase()
            if (!seq || /[^ACGT]/.test(seq)) continue
            checked++
            lengths.add(seq.length)
            if (seq[0] === "G") startG++
            if (checked >= 4000) break
        }
        if (checked >= 4000) break
    }
    return {
        // "Effectively all" rather than "all": a stray exception in a 100k-row
        // file should not decide that the library has no convention.
        requiresLeading5pG: checked > 0 && startG / checked > 0.98,
        lengths: lengths
    }
}

// Controls of one kind from the species-matched donor, shaped as library rows
// so every output builder handles them like any other guide. Returns [] when
// nothing is available or nothing survives the host library's convention.
function LIB_borrowedControlRows(kindId, species, count) {
    const data = _borrowedControls.data
    if (!data || !data.species) return { rows: [], symbol: null, source: null, available: 0 }
    const block = data.species[/mouse/i.test(species || "") ? "Mouse" : "Human"]
    const set = block && block[kindId]
    if (!set || !set.guides || !set.guides.length) return { rows: [], symbol: null, source: null, available: 0 }

    const convention = LIB_guideConvention()
    var guides = set.guides
    if (convention.requiresLeading5pG) guides = guides.filter(g => g[0] === "G")

    const width = Math.max(_library.headers ? _library.headers.length : 0,
                           _library.symbolColumn, _library.rnaColumn)
    const picked = _randomSample(guides, Math.min(count, guides.length))
    const rows = picked.map(seq => {
        const row = new Array(width).fill("")
        row[_library.symbolColumn - 1] = set.symbol
        row[_library.rnaColumn - 1] = seq
        return row
    })
    return { rows: rows, symbol: set.symbol, source: block.source, available: guides.length }
}

// The key under which a library map holds controls of the given kind, or
// null if it has none of that kind.
function LIB_findControlKey(libraryMap, kindId) {
    const kind = _CONTROL_KINDS.find(k => k.id === kindId)
    if (!kind) return null
    for (const key of kind.symbols) {
        const rows = libraryMap[key]
        if (rows && rows.length) return key
    }
    return null
}

// Is this symbol a control block rather than a real gene? Lets the outputs
// that only make sense per-gene (the copy-number annotation) skip it.
function LIB_isControlSymbol(symbol) {
    const s = String(symbol || "").toLowerCase()
    return _CONTROL_KINDS.some(k => k.symbols.includes(s))
}

// Which kind of control, or null for a real gene. The two kinds differ in a
// way that matters downstream: a safe-targeting guide cuts a real place in
// the genome and can be looked at there, a non-targeting one matches nothing
// by design and has nowhere to look.
function LIB_controlKind(symbol) {
    const s = String(symbol || "").toLowerCase()
    const kind = _CONTROL_KINDS.find(k => k.symbols.includes(s))
    return kind ? kind.id : null
}

// What the currently selected library offers, per kind:
//   { nonTargeting: {key, count} | null, safeTargeting: {key, count} | null }
// Used by the UI to enable each option and report how many are available.
function LIB_controlInfo() {
    const info = {}
    for (const kind of _CONTROL_KINDS) {
        const key = LIB_findControlKey(_library.libraryMap, kind.id)
        info[kind.id] = key ? { key: key, count: _library.libraryMap[key].length } : null
    }
    return info
}

function LIB_startScreening(settings) {
    if (Object.keys(_library.libraryMap).length == 0) {
        _library.statusSearch = "Error no library selected"
        throw new Error("No library selected")
    }
    _library.statusSearch = "Starting search"
    var synonyms = {}
    if (settings.enableSynonyms) {
        synonyms = _createMatchingSynonyms(settings.searchSymbols)
    }

    var st = performance.now()
    try {
        var searchOutput = SCR_startScreening(_library, settings, synonyms)
    }
    catch (e) {
        _library.statusSearch = "Error run failed"
        throw (e)
    }

    console.log(Math.round((performance.now() - st) / 100 * 100) / 1000)
    // Each control block is one more key in filteredLibraryMap but isn't a
    // searched-for gene, so they're excluded from the symbol count and
    // reported on their own line instead.
    const added = searchOutput.controlsAdded || {}
    const essential = searchOutput.essentialAdded || []
    // Naming the donor beside the kind it supplied, rather than once for the
    // whole run, so a library that stocks one kind and borrows the other does
    // not read as though both were borrowed.
    const borrowedFrom = searchOutput.controlsBorrowedFrom || {}
    const from = id => borrowedFrom[id] ? ` (borrowed from ${borrowedFrom[id]})` : ""
    const addedNotes = []
    if (added.safeTargeting > 0) addedNotes.push(`${added.safeTargeting} safe-targeting${from("safeTargeting")}`)
    if (added.nonTargeting > 0) addedNotes.push(`${added.nonTargeting} non-targeting${from("nonTargeting")}`)
    const blocksAdded = (added.nonTargeting > 0 ? 1 : 0) + (added.safeTargeting > 0 ? 1 : 0)
    // Essential-gene controls are ordinary genes and already counted among
    // the symbols found; the control blocks are not.
    const symbolCount = Object.keys(searchOutput.filteredLibraryMap).length - blocksAdded
    var controlNote = ""
    if (addedNotes.length) {
        controlNote = `<br> Controls added: ${addedNotes.join(" + ")}`
    } else if (settings.includeNonTargeting || settings.includeSafeTargeting) {
        controlNote = `<br> This library ships none of the selected control types &mdash; none added`
    }
    if (essential.length) {
        controlNote += `<br> Essential-gene controls: ${essential.map(g => g.toUpperCase()).join(", ")}`
    }
    _library.statusSearch = `Done. Time to complete: ${Math.round((performance.now() - st) / 1000 * 10) / 10}s<br> Symbols found: ${symbolCount}${controlNote}`

    return searchOutput
}

function LIB_setLibraryCustomData(fileData, settings) {
    LIB_setLibraryData(settings, fileData, "")
    //console.log("LIB_setLibraryCustomData()start scol=" + settings.symbolColumn)
}


function LIB_setLibraryData(librarySettings, fileData, citationInfo) {
    //uppdates synonymMap, citationInfo and libraryMap
    _library.citationInfo = citationInfo
    // Kept so borrowed control guides can be shaped like this library's rows.
    _library.symbolColumn = librarySettings.symbolColumn
    _library.rnaColumn = librarySettings.RNAColumn
    var libraryMap = _createLibraryMap(fileData, librarySettings.symbolColumn, librarySettings.RNAColumn, librarySettings.rankingColumn, _library.synonymMap)
    _library.librarySymbolSet = new Set(Object.keys(libraryMap)), //a set containing all symbols in the library
        _library.libraryMap = libraryMap
}

function LIB_changeSynonyms(synonymData) {
    _library.synonymMap = _createSynonymMap(synonymData)
}

function _createSynonymMap(synonymData) {
    //se top of file for explanation of synonym map datastructure
    //
    // Column 4 of the table carries a gene group: an orthologue class where one
    // exists, so a human gene and its mouse counterpart share it, otherwise the
    // gene's own HGNC or MGI accession. It is what lets the matcher tell "same
    // gene, different spelling" from "different gene that once shared a name".
    // A row whose synonym equals its gene name marks that symbol as an official
    // current symbol.
    rows = synonymData.trim().split("\n").map((row) => row.split("\t"))
    rows.shift()
    var synonymMap = {}
    var geneGroups = {}      // symbol -> Set of groups the spelling can denote
    var officialGroup = {}   // symbol -> its own gene's group, if it is official
    rows.forEach(row => {
        const symbol1 = row[0].toLowerCase().trim()
        const symbol2 = row[1].toLowerCase().trim()
        const group = (row[3] || "").trim()

        if (symbol1 != "" && symbol2 != "") {

            if (!synonymMap[symbol1]) {
                synonymMap[symbol1] = new Set()
            }
            synonymMap[symbol1].add(symbol2)

            if (!synonymMap[symbol2]) {
                synonymMap[symbol2] = new Set()
            }
            synonymMap[symbol2].add(symbol1)

            if (group) {
                if (!geneGroups[symbol1]) geneGroups[symbol1] = new Set()
                geneGroups[symbol1].add(group)
                if (!geneGroups[symbol2]) geneGroups[symbol2] = new Set()
                geneGroups[symbol2].add(group)
                if (symbol1 === symbol2) officialGroup[symbol1] = group
            }
        }
    })
    _library.geneGroups = geneGroups
    _library.officialGroup = officialGroup
    return synonymMap
}

// Which gene(s) a spelling stands for. An official symbol stands for its own
// gene and nothing else — that is the point of the check below. Any other
// spelling stands for whichever genes list it.
function _groupsOf(symbol) {
    const own = _library.officialGroup ? _library.officialGroup[symbol] : null
    if (own) return new Set([own])
    return (_library.geneGroups && _library.geneGroups[symbol]) || new Set()
}

function _createLibraryMap(fileData, symbolColumn, RNAColumn, rankingColumn, synonymMap) {
    // se top of file for explanation of libraryMap datastructure
    _library.libraryStatus = "Parsing library"

    var rows = fileData.trim().split("\n").map((row) => row.split("\t"))
    _library.headers = rows.shift()
    const headerLen = _library.headers.length
    if (headerLen <= 1) {
        _library.libraryStatus = "select a file"
        return {}
    }
    if ((symbolColumn > headerLen) || (RNAColumn > headerLen) || (rankingColumn > headerLen)) {
        _library.libraryStatus = "Error: column not found"
        return {}
    }
    if ((symbolColumn < 1) || (RNAColumn < 1)) {
        _library.libraryStatus = "Enter valid columns"
        return {}
    }
    libraryMap = {}
    var additionalStatus = ""
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i]

        const symbol = row[symbolColumn - 1].trim()
        //const symbolLower = symbol.toLowerCase()
        const symbolLower = symbol.toLowerCase()

        if (libraryMap[symbolLower]) {
            libraryMap[symbolLower].push(row)
        } else {
            libraryMap[symbolLower] = [row]
        }
    }
    // Jacquere and Julianna list about 2,950 genes under a piped label —
    // "CD59|nan", where the second field is a missing value written out
    // literally, or "ABHD14A-ACY1|ABHD14A", where the guide also falls in a
    // read-through transcript. Neither string is a symbol anyone would search
    // for, so those genes reported "not found" for a search of their own name:
    // 4 of the 384 CD markers, all four of them in the library.
    //
    // Each part is registered as a name for the same guides, and the name the
    // user searched is what the output calls it. The Context panel has
    // resolved these since it was written; the search itself had not.
    const aliasDisplay = {}
    for (const key of Object.keys(libraryMap)) {
        if (key.indexOf("|") === -1) continue
        const raw = String(libraryMap[key][0][symbolColumn - 1] || "").trim()
        for (const part of raw.split("|")) {
            const name = part.trim()
            if (!name || name.toLowerCase() === "nan") continue
            const alias = name.toLowerCase()
            // A gene listed in its own right keeps its own guides.
            if (libraryMap[alias]) continue
            libraryMap[alias] = libraryMap[key]
            aliasDisplay[alias] = name
        }
    }
    _library.aliasDisplay = aliasDisplay
    _library.libraryStatus = additionalStatus + `${Object.keys(libraryMap).length} symbols found`
    return libraryMap
}

// What to call a gene the user found under one of those labels: the name they
// searched for, not the label the file carries.
function LIB_displayFor(symbolKey, fallback) {
    const alias = _library.aliasDisplay && _library.aliasDisplay[String(symbolKey).toLowerCase()]
    return alias || fallback
}


function LIB_libraryCitation() {
    return _library.citationInfo
}


function LIB_statusSynonyms(searchSymbols) {
    return _createMatchingSynonyms(searchSymbols, true)

}
function LIB_statusSynonymsOLD(searchSymbols) {
    return _createMatchingSynonymsOLD(searchSymbols, true)
}

function LIB_statusScreening() {
    return _library.statusSearch
}

function LIB_statusLibrarySymbols() {
    return _library.libraryStatus
}

function _createMatchingSynonyms(searchSymbols) {
    /*
    returns object where each searched symbol is a key and the value is the a list of all synonyms to the key that are in the selected library
    if the value is empty list the symbol has no machig synonyms 
    synonym map = {
        symbol1: [synonym1.1, synonym1.2],
        symbol2: [synonym2.1]
        symbol3: [], (symbol3 has no matching synonyms in the selected library)
        symobl4: ...
    }
    */
    const symbolsNotFound = searchSymbols.filter(symbol => !_library.librarySymbolSet.has(symbol))// only symbols not in the library are considered
    const matchingSymbols = {}
    symbolsNotFound.forEach(searchSymbol => { // loop through all symbols in search feild that does not have a direct match
        if (_library.synonymMap[searchSymbol]) {
            var candidates = Array.from(_library.synonymMap[searchSymbol].intersection(_library.librarySymbolSet)) // every symbol thats boath in the library and is a synonym to the searched symbol
            // If the searched symbol is itself an official gene symbol, only
            // accept a candidate standing for the SAME gene — a different
            // spelling of it, or its orthologue in the other species. Symbols
            // are reused across genes: HGNC records PIM1 as a former alias of
            // LONP1, so without this a search for the PIM1 kinase in a library
            // lacking it would quietly come back with LONP1 guides. Returning
            // nothing puts it in "Symbols not found", where the user can see it.
            const own = _library.officialGroup ? _library.officialGroup[searchSymbol] : null
            if (own) {
                candidates = candidates.filter(candidate => _groupsOf(candidate).has(own))
            }
            matchingSymbols[searchSymbol] = candidates
        }
        else {
            matchingSymbols[searchSymbol] = []
        }
    })
    return matchingSymbols
}

function LIB_libraryCitation() {
    return _library.citationInfo
}

function LIB_statusSynonyms(searchSymbols) {
    return _createMatchingSynonyms(searchSymbols)
}

function LIB_statusScreening() {
    return _library.statusSearch
}

function LIB_statusLibrarySymbols() {
    return _library.libraryStatus
}

// ---------------------------------------------------------------------------
// Did-you-mean, for symbols that matched nothing.
//
// A typo puts the gene in "Symbols not found" with no hint of what went wrong:
// "to53" is one key away from TP53 and the app said only that it found 0 of 1.
// The Correlate app answers this the same way, and this is its ranking:
// prefix matches first (a short entry like "USP" is usually someone reaching
// for a family, so the family comes back in natural order), then spellings
// within two edits, transpositions counted as one — CDNK2A is one slip from
// CDKN2A, and plain Levenshtein scores that the same as two unrelated
// substitutions.
//
// Suggestions are drawn from the selected library, so every one of them is a
// name that would actually return guides.

// Letters and digits, with everything of a kind written the same way, so two
// candidates can be compared on the shape of the symbol rather than its
// characters.
function _symShape(s) {
    return String(s).replace(/[0-9]/g, "9").replace(/[^0-9]/g, "A")
}

// Damerau-Levenshtein, capped: anything beyond 2 edits is not a typo we want
// to guess at, so the distance only has to be exact up to that.
function _symEditDistance(a, b) {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    if (Math.abs(a.length - b.length) > 2) return 3

    const m = a.length, n = b.length
    let prev2 = new Array(n + 1).fill(0)
    let prev = new Array(n + 1)
    let curr = new Array(n + 1)
    for (let j = 0; j <= n; j++) prev[j] = j

    for (let i = 1; i <= m; i++) {
        curr[0] = i
        for (let j = 1; j <= n; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                curr[j] = Math.min(curr[j], prev2[j - 2] + 1)
            }
        }
        const spare = prev2
        prev2 = prev
        prev = curr
        curr = spare
    }
    return prev[n]
}

// The library's symbols in the spelling the library file uses, so a suggestion
// reads as TP53 rather than tp53. Built once per library.
function _librarySymbolDisplay() {
    if (_library.symbolDisplay && _library.symbolDisplayFor === _library.libraryMap) {
        return _library.symbolDisplay
    }
    const col = (_library.symbolColumn || 1) - 1
    const display = new Map()
    for (const key of Object.keys(_library.libraryMap || {})) {
        // The piped labels are not names anyone should be offered; each part
        // of them is a key of its own, and those are.
        if (key.indexOf("|") !== -1) continue
        const rows = _library.libraryMap[key]
        const raw = rows && rows[0] && rows[0][col]
        display.set(key, LIB_displayFor(key, (raw && String(raw).trim()) || key.toUpperCase()))
    }
    _library.symbolDisplay = display
    _library.symbolDisplayFor = _library.libraryMap
    return display
}

// searchSymbols: lower-cased symbols that found nothing.
// Returns { symbol: [suggested display names] } — only symbols with at least
// one suggestion appear. `perSymbol` caps how many each gets.
function LIB_suggestSymbols(searchSymbols, perSymbol) {
    const out = {}
    const display = _librarySymbolDisplay()
    if (display.size === 0) return out
    const cap = perSymbol || 3
    const keys = [...display.keys()]

    for (const query of searchSymbols) {
        const q = String(query).toLowerCase().trim()
        // One or two characters match half the library by prefix and are never
        // a misspelling worth guessing at.
        if (q.length < 3) continue
        const matches = []
        for (const key of keys) {
            if (key.startsWith(q) || q.startsWith(key)) matches.push(key)
        }
        matches.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

        if (matches.length < cap) {
            const seen = new Set(matches)
            const scored = []
            const qShape = _symShape(q)
            for (const key of keys) {
                if (seen.has(key)) continue
                if (Math.abs(key.length - q.length) > 2) continue
                const dist = _symEditDistance(q, key)
                if (dist <= 2) scored.push({ key, dist, shape: _symEditDistance(qShape, _symShape(key)) })
            }
            // Same number of edits, so break the tie on shape: TOX3 and TP53
            // are both one character off "to53", but TP53 keeps the two digits
            // where they were typed and TOX3 turns one of them into a letter.
            // Digits are load-bearing in a gene symbol, and a typo rarely
            // crosses between a digit and a letter.
            scored.sort((a, b) => a.dist - b.dist || a.shape - b.shape || a.key.localeCompare(b.key))
            for (const x of scored) {
                matches.push(x.key)
                if (matches.length >= cap) break
            }
        }

        if (matches.length > 0) {
            out[query] = matches.slice(0, cap).map(k => display.get(k) || k.toUpperCase())
        }
    }
    return out
}

// The spelling the library file uses for one symbol, for anything that shows
// a library symbol back to the user.
function LIB_displaySymbol(symbol) {
    const display = _librarySymbolDisplay()
    return display.get(String(symbol).toLowerCase()) || String(symbol).toUpperCase()
}
