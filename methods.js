//
// Green Listed v2.0
//
// Methods text.
//
// A Materials & Methods description of the run that just finished, so what
// was actually done can be pasted into a manuscript rather than reconstructed
// from memory months later.
//
// The document has three parts. The short version is the sentence most papers
// actually print — the software, the library and the size of the design, with
// citations named rather than spelled out. The full version is there for a
// supplementary methods section, or for a reviewer who asks how the guides
// were chosen. The references follow, so neither paragraph has to carry a DOI
// inline.
//
// It reports only what the run really used: an option left off produces no
// sentence, so the text never claims a step that did not happen. Everything
// is read back out of the same state the outputs were built from, so it
// cannot drift from the files the user downloads.
//

const _METH_APP = {
    short: "Henkel et al. 2025",
    url: "greenlisted.cmm.se",
    full: "Henkel E, Li Z, Uvehag D, Schmierer B, Henkel M, Wermeling F. " +
          "Green Listed v2.0: A Web Application for Streamlined Design of Custom " +
          "CRISPR Screens. CRISPR J. 2025 Jun;8(3):216-223. doi: 10.1089/crispr.2025.0023"
}

const _METH_CN_SOURCE = "DepMap OmicsCNGene dataset (24Q4 release)"

const _METH_RULE = "--------------------------------------------------------------------"

// The reference for the selected library, taken from the citation panel so
// there is one copy of it in the app rather than a second list here that can
// drift out of step. The first paragraph of each citation file is the
// reference itself; the rest is links and library statistics.
//
// Returns both forms: the full reference for the list at the end, and an
// author-year short cite for the running text.
function _methLibraryCite() {
    if (typeof LIB_libraryCitation !== "function") return null
    const html = LIB_libraryCitation()
    if (!html) return null
    var full
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")
        const p = doc.querySelector("body p")
        if (!p) return null
        full = p.textContent.replace(/\s+/g, " ").trim()
    } catch (e) {
        return null
    }
    if (!full) return null

    // Every citation file is written "Title. Authors. Journal. Year…", and the
    // author lists use bare initials ("Doench JG, Fusi N"), so splitting on
    // sentence breaks puts the authors in the second field. If the shape is
    // anything else, leave the short cite out rather than guess at one.
    const parts = full.split(". ")
    var short = null
    if (parts.length >= 2) {
        const surname = parts[1].trim().split(/[\s,]+/)[0]
        const year = (parts.slice(2).join(". ").match(/\b(?:19|20)\d{2}\b/) || [])[0]
        if (surname && /^[A-Za-zÀ-ÿ'-]+$/.test(surname) && year) {
            short = `${surname} et al. ${year}`
        }
    }
    return { full: full, short: short }
}

// "a", "a and b", "a, b and c" — the serial comma is left out, as most
// journals do in running text.
function _methList(items) {
    const a = items.filter(x => x != null && x !== "")
    if (a.length <= 1) return a.join("")
    return a.slice(0, -1).join(", ") + " and " + a[a.length - 1]
}

function _methPlural(n, singular, plural) {
    return n === 1 ? singular : (plural || singular + "s")
}

// Which tool the visible output belongs to. The output table is shared, so
// the mode classes on <body> are what say whose results are on screen.
function _methMode() {
    if (document.body.classList.contains("validate-mode")) return "validate"
    if (document.body.classList.contains("cn-mode")) return "cn"
    return "design"
}

function METH_text() {
    const mode = _methMode()
    if (mode === "validate") return _methValidate()
    if (mode === "cn") return _methCn()
    return _methDesign()
}

function _methDesign() {
    if (typeof searchOutput === "undefined" || !searchOutput || !searchOutput.filteredLibraryMap) {
        return "Run a design first — the methods text describes what the run actually did."
    }
    const map = searchOutput.filteredLibraryMap
    const isCtrl = s => (typeof LIB_isControlSymbol === "function") && LIB_isControlSymbol(s)

    const geneSymbols = Object.keys(map).filter(s => !isCtrl(s))
    var geneGuides = 0
    for (const s of geneSymbols) geneGuides += map[s].length
    var totalGuides = 0
    for (const s in map) totalGuides += map[s].length
    const perGene = geneSymbols.length ? geneGuides / geneSymbols.length : 0
    // A whole number when every gene got the same count, which is the usual
    // case — "3 sgRNAs per gene" rather than "3.0".
    const perGeneText = Number.isInteger(perGene) ? String(perGene) : perGene.toFixed(1)

    const lib = _methLibraryCite()
    const libName = settings.libraryName || "the selected library"
    const libCite = (lib && lib.short) ? ` (${lib.short})` : ""

    const added = searchOutput.controlsAdded || {}
    const borrowed = searchOutput.controlsBorrowedFrom || {}
    const essential = searchOutput.essentialAdded || []

    // ---- short version -------------------------------------------------
    const ctrlShort = []
    if (added.safeTargeting > 0) ctrlShort.push(`${added.safeTargeting} safe-targeting`)
    if (added.nonTargeting > 0) ctrlShort.push(`${added.nonTargeting} non-targeting`)
    if (essential.length) ctrlShort.push(`${essential.length} essential-gene positive`)

    var short = `sgRNAs were designed using the Green Listed software ` +
                `(${_METH_APP.url}; ${_METH_APP.short}), selecting ` +
                `${perGeneText} ${_methPlural(perGene, "sgRNA")} per gene for ` +
                `${geneSymbols.length} ${_methPlural(geneSymbols.length, "gene")} from the ` +
                `${libName} library${libCite}`
    short += ctrlShort.length
        ? `, together with ${_methList(ctrlShort)} control sgRNAs (${totalGuides} sgRNAs in total).`
        : ` (${totalGuides} sgRNAs in total).`

    // ---- full version --------------------------------------------------
    const sentences = []
    sentences.push(
        `A custom sgRNA library was designed using Green Listed v2.0 ` +
        `(${_METH_APP.url}; ${_METH_APP.short}). Guides targeting ` +
        `${geneSymbols.length} ${_methPlural(geneSymbols.length, "gene")} were selected from the ` +
        `${libName} library${libCite}, giving ${geneGuides} ${_methPlural(geneGuides, "sgRNA")} ` +
        `(${perGeneText} per gene).`
    )

    // Symbol matching. Worth stating because it changes which guides end up
    // in the library, and because a reader cannot tell from the gene list
    // alone that aliases were resolved.
    const used = searchOutput.usedSynonyms || {}
    const resolved = Object.keys(used).filter(k => used[k] && used[k].length > 0)
    const notFound = Object.keys(used).filter(k => !used[k] || used[k].length === 0)
    if (settings.partialMatches) {
        sentences.push("Gene symbols were matched to the library by partial (substring) match.")
    } else if (settings.enableSynonyms) {
        const table = settings.synonymName ? `${settings.synonymName} ` : ""
        var s = `Submitted gene symbols were matched to the library allowing for ` +
                `synonyms and previous symbols (${table}synonym table, built from HGNC and MGI)`
        s += resolved.length
            ? `, which resolved ${resolved.length} ${_methPlural(resolved.length, "symbol")} listed in the library under a different name.`
            : "."
        sentences.push(s)
    } else {
        sentences.push("Gene symbols were matched to the library exactly, without synonym resolution.")
    }
    if (notFound.length) {
        sentences.push(`${notFound.length} submitted ${_methPlural(notFound.length, "symbol")} had no match in this library and ${_methPlural(notFound.length, "was", "were")} excluded.`)
    }

    // Ranking. Only meaningful when the library carries a score column and
    // the user asked for a per-gene limit.
    const top = parseInt(settings.rankingTop, 10)
    const rankCol = parseInt(settings.rankingColumn, 10)
    if (!isNaN(top) && top > 0) {
        const headers = searchOutput.headers || []
        const colName = (!isNaN(rankCol) && rankCol > 0 && headers[rankCol - 1])
            ? headers[rankCol - 1].trim() : null
        const order = settings.rankingOrder === "ascending" ? "ascending" : "descending"
        sentences.push(colName
            ? `For each gene, guides were ranked by ${colName} (${order}) and the top ${top} retained.`
            : `The top ${top} ${_methPlural(top, "guide")} per gene, in library order, were retained.`)
    }

    // Controls.
    const ctrlParts = []
    if (added.safeTargeting > 0) {
        ctrlParts.push(`${added.safeTargeting} safe-targeting (CutCtrl)` +
            (borrowed.safeTargeting ? ` from ${borrowed.safeTargeting}` : ""))
    }
    if (added.nonTargeting > 0) {
        ctrlParts.push(`${added.nonTargeting} non-targeting (NegCtrl)` +
            (borrowed.nonTargeting ? ` from ${borrowed.nonTargeting}` : ""))
    }
    if (ctrlParts.length) {
        const anyBorrowed = borrowed.safeTargeting || borrowed.nonTargeting
        sentences.push(
            `The library was supplemented with ${_methList(ctrlParts)} control sgRNAs, ` +
            `sampled at random` +
            (anyBorrowed ? " from the species-matched donor library, as the selected library carries none of that type" : "") +
            "."
        )
    }
    if (essential.length) {
        sentences.push(
            `${essential.length} core-essential ${_methPlural(essential.length, "gene")} ` +
            `(${essential.map(g => g.toUpperCase()).join(", ")}) ${_methPlural(essential.length, "was", "were")} ` +
            `included as ${_methPlural(essential.length, "a dropout positive control", "dropout positive controls")}.`
        )
    }

    // Copy-number annotation, when a screening cell line was chosen.
    const cellLines = (typeof _cnState !== "undefined" && _cnState.screeningCellLines) || []
    if (typeof outputTexts !== "undefined" && outputTexts && outputTexts.textOutputCn && cellLines.length) {
        const label = cellLines[0] && (cellLines[0].name || cellLines[0].cellLineName || cellLines[0].id || cellLines[0])
        sentences.push(
            `Target genes were annotated with relative copy number in ${label}, from the ${_METH_CN_SOURCE}, ` +
            `to flag genes in amplified or deeply deleted regions, where cutting confounds a viability readout.`
        )
    }

    // Oligo layout.
    const before = (settings.adapterBefore || "").trim()
    const after = (settings.adapterAfter || "").trim()
    if (before || after) {
        sentences.push(
            `Oligonucleotides were designed with the flanking sequences ` +
            `5'-${before.toUpperCase()}-3' and 5'-${after.toUpperCase()}-3' ` +
            `for cloning, giving ${totalGuides} ${_methPlural(totalGuides, "oligonucleotide")} in total.`
        )
    } else {
        sentences.push(`The final library comprises ${totalGuides} ${_methPlural(totalGuides, "sgRNA")}.`)
    }

    return _methWrap("sgRNA library design", short, sentences,
                     lib ? [{ label: `Library (${libName})`, text: lib.full }] : [])
}

function _methValidate() {
    if (typeof _validateState === "undefined" || !_validateState.resultsOutput) {
        return "Run a validation first — the methods text describes what the run actually did."
    }
    // Recovered from the outputs rather than tracked separately, so the text
    // and the downloaded files can never disagree. Both files carry a header
    // line above the rows.
    const countRows = t => Math.max(0, t.trim().split("\n").filter(l => l.length).length - 1)
    const resultLines = _validateState.resultsOutput.split("\n")
        .filter(l => l.length && !l.startsWith("#"))
    const assignments = Math.max(0, resultLines.length - 1)
    const notFound = countRows(_validateState.notFoundOutput)
    // One sequence can be a top pick in several libraries, so hits are rows,
    // not sequences.
    const matched = new Set(resultLines.slice(1).map(l => l.split("\t")[0])).size
    const species = _validateState.activeSpecies === "mouse" ? "mouse" : "human"
    const total = matched + notFound

    const short = `sgRNA sequences were checked against the published ${species} CRISPR knockout ` +
                  `libraries using the Green Listed software (${_METH_APP.url}; ${_METH_APP.short}); ` +
                  `${matched} of ${total} ${_methPlural(total, "sequence")} matched a guide selected ` +
                  `in at least one library.`

    return _methWrap("sgRNA validation", short, [
        `${total} sgRNA ${_methPlural(total, "sequence")} were checked against the published ${species} ` +
        `CRISPR knockout libraries using Green Listed v2.0 (${_METH_APP.url}; ${_METH_APP.short}).`,
        `${matched} ${_methPlural(matched, "sequence")} matched a guide selected in at least one library ` +
        `(${assignments} library ${_methPlural(assignments, "assignment")} in total, as one sequence can be ` +
        `chosen by more than one library), and ${notFound} ${_methPlural(notFound, "was", "were")} not found.`,
        `Reference guide sets were those distributed via Addgene and the Broad Institute GPP portal.`
    ], [])
}

function _methCn() {
    if (typeof _cnState === "undefined" || !_cnState.results) {
        return "Run a copy-number lookup first — the methods text describes what the run actually did."
    }
    const rows = _cnState.results.rows || []
    const notFound = _cnState.results.notFound || []
    // A symbol with no match still occupies a row, so it has to come off the
    // count — otherwise the text claims a value was retrieved for it.
    const found = Math.max(0, rows.length - notFound.length)
    const lines = _cnState.selectedCellLines || []
    const names = lines.map(l => l && (l.name || l.cellLineName || l.id || l)).filter(Boolean)
    const shown = names.length <= 4 ? _methList(names) : `${names.length} cell lines`

    const short = `Relative gene copy number was retrieved for ${found} ${_methPlural(found, "gene")} in ` +
                  `${shown} from the ${_METH_CN_SOURCE} using the Green Listed software ` +
                  `(${_METH_APP.url}; ${_METH_APP.short}).`

    const sentences = [
        `Relative gene copy number was retrieved for ${found} ${_methPlural(found, "gene")} ` +
        `in ${shown} using Green Listed v2.0 (${_METH_APP.url}; ${_METH_APP.short}), ` +
        `from the ${_METH_CN_SOURCE}.`,
        `Values are expressed relative to each line's own genome-wide baseline, so 1.0 denotes the ` +
        `typical ploidy of that line rather than a fixed diploid reference.`
    ]
    if (notFound.length) {
        sentences.push(`${notFound.length} submitted ${_methPlural(notFound.length, "symbol")} ${_methPlural(notFound.length, "was", "were")} not present in the dataset.`)
    }
    return _methWrap("Gene copy number", short, sentences, [])
}

// Assembles the document: the one-sentence version first, because that is what
// most papers print, then the expanded paragraph, then the references both
// versions cite.
function _methWrap(heading, short, sentences, refs) {
    const date = new Date().toISOString().slice(0, 10)
    const references = [{ label: "Green Listed", text: _METH_APP.full }].concat(refs || [])

    return [
        `${heading.toUpperCase()} — METHODS`,
        "",
        "SHORT VERSION (for the main text)",
        "",
        short,
        "",
        _METH_RULE,
        "",
        "FULL VERSION (for a detailed or supplementary methods section)",
        "",
        sentences.join(" "),
        "",
        _METH_RULE,
        "",
        "REFERENCES",
        "",
        references.map(r => `${r.label}: ${r.text}`).join("\n\n"),
        "",
        _METH_RULE,
        "",
        `Generated by Green Listed on ${date}. Please check the text against your`,
        "final protocol before submission.",
        ""
    ].join("\n")
}

function showMethodsOutput() {
    _setActiveShow("methods")
    _showTextareaOutput(METH_text())
}

// Copying is offered beside the download because this output exists to be
// pasted into a manuscript, not filed away.
//
// The selection-based copy is tried first rather than navigator.clipboard:
// it is synchronous, needs no permission, and cannot leave the user staring
// at a prompt. If both routes fail the text is put on screen and selected,
// so there is always a way to get at it.
function copyMethodsOutput() {
    const text = METH_text()
    const ok = () => _setStatus("statusSearch", "Methods text copied to the clipboard")
    const failed = () => {
        showMethodsOutput()
        const ta = document.getElementById("fileContent")
        if (ta) { ta.focus(); ta.select() }
        _setStatus("statusSearch", "Could not copy automatically — the text is selected below, press Ctrl/Cmd+C")
    }

    try {
        const ta = document.createElement("textarea")
        ta.value = text
        // Off-screen rather than hidden: a display:none element cannot be
        // selected, so the copy would silently do nothing.
        ta.setAttribute("readonly", "")
        ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;"
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, text.length)
        const copied = document.execCommand("copy")
        document.body.removeChild(ta)
        if (copied) { ok(); return }
    } catch (e) { /* fall through to the Clipboard API */ }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        // Guarded by a timeout: where the permission prompt cannot be
        // answered the promise never settles, and the user would otherwise
        // be left with no feedback at all.
        var settled = false
        const finish = good => { if (!settled) { settled = true; good ? ok() : failed() } }
        navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false))
        setTimeout(() => finish(false), 1500)
    } else {
        failed()
    }
}
