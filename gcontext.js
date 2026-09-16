//
// Green Listed v2.0
//
// Genomic context for one sgRNA.
//
// To check a knockout by Sanger sequencing (ICE, TIDE) you need PCR primers
// around the cut site, and for that you need the genomic sequence around the
// guide. The manual route is to BLAT the spacer at UCSC and copy flanking
// sequence out by hand. This does the same thing from a button on the results
// table: it fetches 500 bp either side of the spacer from the UCSC Genome
// Browser API, marks the spacer, PAM, cut site and exons, and offers the
// sequence in the forms that survive a paste — a FASTA with the spacer in
// upper case, an HTML copy for Word, a GenBank file for SnapGene or Benchling,
// and a link that opens Primer-BLAST with the sequence and primer windows
// already filled in.
//
// The guide is located by searching for spacer + NGG inside the gene, never
// by the coordinates in the library file. The mouse libraries that carry
// coordinates (Brie, VBC) are on mm10, the current assembly is mm39, and the
// other libraries have no coordinates at all; one search-based path serves
// every library and both species the same way.
//
// On demand only: one guide per click, three UCSC requests at most, results
// cached for the session, and the requests spaced a second apart as UCSC
// asks. Nothing here runs during a design.
//

const _GC_API = "https://api.genome.ucsc.edu"

const _GC_GENOMES = {
    human: { genome: "hg38", assembly: "GRCh38/hg38", organism: "Homo sapiens" },
    mouse: { genome: "mm39", assembly: "GRCm39/mm39", organism: "Mus musculus" }
}

// Tracks the gene-symbol search is trusted from, best first. RefSeq Select
// is one transcript per gene on both assemblies (on hg38 it is the MANE
// Select set); the rest catch a symbol RefSeq has since renamed.
const _GC_SEARCH_TRACKS = ["ncbiRefSeqSelect", "mane", "ncbiRefSeqCurated", "refGene", "ncbiRefSeq", "knownGene", "hgnc"]
// Where the exons come from, tried in order until one has a transcript in
// the window.
const _GC_TX_TRACKS = ["ncbiRefSeqSelect", "ncbiRefSeqCurated"]

const _GC_GENE_PAD = 2000          // bp added either side of the gene span before searching
const _GC_MAX_SPAN = 3000000       // UCSC returned 2.2 Mb (DMD) in two seconds; anything past this is refused
const _GC_FLANK_DEFAULT = 500
const _GC_FLANK_MIN = 100
const _GC_FLANK_MAX = 2000
const _GC_MIN_GAP_MS = 1000        // UCSC asks for at most one request per second
// Primer-BLAST's own form POSTs to primertool.cgi; index.cgi only renders the
// form. Posting straight to the tool matters for two reasons: the form page
// silently drops USER_SEQLOC, which is the parameter that stops the run
// halting on a "which of these hits did you mean" page, and a GET URL is
// capped near 8 kB, which a long flank would exceed.
// The form page. Submitting straight to the engine behind it (primertool.cgi)
// was tried and abandoned: a direct submission carries only the parameters we
// send, and the ones that bound the BLAST are among those the form supplies
// but a link cannot. Runs launched that way analysed 2,000,000 hits against
// the form's 50,000 and searched 50,000 target sequences against its 100, and
// took ten minutes or more where the form takes about two. Sending the full
// field set did not fix it either. So the form is the only route.
const _GC_PB_FORM_URL = "https://www.ncbi.nlm.nih.gov/tools/primer-blast/index.cgi"
const _GC_PB_STORE = "greenlisted.primerBlastSettings"
// Bumped whenever the defaults below change meaning. A store written under
// an older version is dropped rather than merged, so a new default is not
// silently overridden by the previous default sitting in localStorage.
const _GC_PB_VERSION = 4

var _GC = {
    locus: new Map(),     // genome|symbol|spacer -> locate result
    seq: new Map(),       // genome|chrom|start|end -> dna (plus strand, upper case)
    tx: new Map(),        // genome|chrom|start|end -> transcripts in that window
    lastCall: 0,
    queue: Promise.resolve(),
    current: null,        // what the modal is showing, see _gcShow()
    usedThisRun: false,   // for the methods text
    pb: null              // Primer-BLAST settings, loaded lazily from localStorage
}

// A sequencing amplicon for ICE or TIDE. The primer windows are not stored
// as fixed positions but derived from the flank: everything up to `minDist`
// before the cut is open to the forward primer, everything from `minDist`
// after it to the reverse. At the default 500 bp flank that is the first and
// last 350 bp, and the windows move with the flank instead of going stale.
// With a product of at least 500 bp that satisfies both tools' published
// guidance — ICE asks for primers 150 bp or more from the cut and a 400 to
// 800 bp amplicon, TIDE for the break about 200 bp into the read (100 bp at
// minimum, for its alignment window) and a 500 to 1500 bp amplicon — while
// leaving room to move when the perfect primer does not exist. The
// specificity check runs against the genome of the guide's species, since
// the template is genomic DNA. The rest are Primer-BLAST's own defaults.
// Anything the user changes is kept in localStorage, so their usual
// settings are entered once.
const _GC_PB_DEFAULTS = {
    minDist: 150,
    productMin: 500, productMax: "",
    tmMin: "", tmOpt: "", tmMax: "", tmDiff: "",
    sizeMin: "", sizeOpt: "", sizeMax: "",
    gcMin: "", gcMax: "",
    numReturn: "",
    db: "PRIMERDB/genome_selected_species"
}

// What Primer-BLAST itself uses when a field is left empty, read off its form.
// Shown as placeholder text so the panel does not look as though this tool
// picked the numbers, and so an empty box is obviously "their default".
const _GC_PB_STOCK = {
    productMin: 70, productMax: 1000,
    tmMin: 57, tmOpt: 60, tmMax: 63, tmDiff: 3,
    sizeMin: 15, sizeOpt: 20, sizeMax: 25,
    gcMin: 20, gcMax: 80,
    numReturn: 10
}


// The two ways people read a CRISPR edit want opposite things from the PCR,
// and the difference is large enough that picking one should not mean editing
// three boxes.
//
//   Sanger, for ICE or TIDE, reads one long trace across the cut. It needs the
//   primers well clear of the edit so the trace has settled before it arrives,
//   and a product long enough to carry plenty of sequence after it.
//
//   Amplicon NGS sequences a short product many times. On a 2x150 paired-end
//   run the whole amplicon has to fit inside the reads, so it must be short
//   and the cut has to sit near the middle; the clearance only needs to keep
//   an indel off the primer itself.
const _GC_PB_PRESETS = {
    sanger: {
        label: "Sanger — ICE / TIDE",
        note: "One long read across the cut. Primers well clear of the edit, product 500 bp or more.",
        values: { minDist: 150, productMin: 500, productMax: "" }
    },
    ngs: {
        label: "Amplicon NGS",
        note: "Sized to be the longest a 2×150 paired-end read can still merge across, so large deletions are not lost.",
        values: { minDist: 50, productMin: 220, productMax: 280 }
    }
}

// Which preset the current settings correspond to, or "custom" once any of the
// three values has been changed by hand.
function _gcPbActivePreset() {
    const pb = _gcPbLoad()
    for (const id in _GC_PB_PRESETS) {
        const v = _GC_PB_PRESETS[id].values
        if (String(pb.minDist) === String(v.minDist) &&
            String(pb.productMin) === String(v.productMin) &&
            String(pb.productMax) === String(v.productMax)) return id
    }
    return "custom"
}

function GC_pbPreset(id) {
    const preset = _GC_PB_PRESETS[id]
    if (!preset) return
    for (const k in preset.values) GC_pbChange(k, preset.values[k])
    if (_GC.current && _GC.current.site) _gcShow()
}

const _GC_PB_DBS = [
    { value: "PRIMERDB/genome_selected_species", label: "Genome of the selected organism (reference assembly)" },
    { value: "refseq_representative_genomes", label: "RefSeq representative genomes" },
    { value: "refseq_mrna", label: "RefSeq mRNA" }
]

// =============================================================================
// Entry points from the results table
// =============================================================================

// Extra column for the "Output with adapters" view. The rows carry the symbol
// and the guide's index; the raw spacer is read back out of the run's
// library map, since the sequence in the row already has adapters on it.
function GC_rowExtraAdapter() {
    if (typeof searchOutput === "undefined" || !searchOutput || !searchOutput.filteredLibraryMap) return null
    const map = searchOutput.filteredLibraryMap
    return {
        header: "Genomic context",
        cell: cols => {
            const symbol = _gcUnquote(cols[0])
            const id = _gcUnquote(cols[1] || "")
            if (!symbol || _gcIsControl(symbol)) return null
            const idx = parseInt(id.slice(id.lastIndexOf("_") + 1), 10) - 1
            const rows = map[symbol.toLowerCase()]
            const row = rows && rows[idx]
            const spacer = row && row[settings.RNAColumn - 1]
            return _gcButton(symbol, spacer, id)
        }
    }
}

// Same for the full output, whose rows are the library rows themselves.
function GC_rowExtraFull() {
    if (typeof settings === "undefined") return null
    return {
        header: "Genomic context",
        cell: cols => {
            const symbol = _gcUnquote(cols[settings.symbolColumn - 1])
            const spacer = cols[settings.RNAColumn - 1]
            if (!symbol || _gcIsControl(symbol)) return null
            return _gcButton(symbol, spacer, symbol)
        }
    }
}

function _gcButton(symbol, spacer, id) {
    const clean = _gcCleanSpacer(spacer)
    if (!clean) return null
    return `<button class="gcBtn" data-symbol="${_escapeHtml(symbol)}" data-spacer="${clean}" ` +
           `data-id="${_escapeHtml(id)}" onclick="GC_openFromButton(this)" ` +
           `title="Fetch the genomic sequence around this guide from UCSC, with the spacer, PAM, cut site and exons marked. For designing PCR primers to check the edit by sequencing.">Context</button>`
}

function GC_openFromButton(btn) {
    GC_open(btn.dataset.symbol, btn.dataset.spacer, btn.dataset.id)
}

// Called by runScreening when a new design lands, so the methods text only
// mentions this feature for the run it was used on.
function GC_newRun() {
    _GC.usedThisRun = false
}

function _gcUnquote(s) {
    // _spreadsheetSafe prefixes an apostrophe to symbols a spreadsheet would
    // read as a formula; that is not part of the symbol.
    return String(s == null ? "" : s).replace(/^'/, "").trim()
}

function _gcIsControl(symbol) {
    return (typeof LIB_isControlSymbol === "function") && LIB_isControlSymbol(symbol)
}

function _gcCleanSpacer(s) {
    const clean = String(s == null ? "" : s).trim().toUpperCase()
    if (!/^[ACGT]{15,30}$/.test(clean)) return null
    return clean
}

// Human or mouse, from the library name. A custom upload says nothing about
// its species, so the modal asks.
function _gcSpecies() {
    const name = (typeof settings !== "undefined" && settings.libraryName) || ""
    if (/\(human\)/i.test(name)) return "human"
    if (/\(mouse\)/i.test(name)) return "mouse"
    return null
}

// =============================================================================
// UCSC API
// =============================================================================

// Every request goes through one queue so that two clicks in quick succession
// still leave a second between calls.
function _gcFetch(path) {
    const run = async () => {
        const wait = _GC.lastCall + _GC_MIN_GAP_MS - Date.now()
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        _GC.lastCall = Date.now()
        var res
        try {
            res = await fetch(_GC_API + path)
        } catch (e) {
            throw new Error("Could not reach the UCSC Genome Browser API. Check your connection and try again.")
        }
        if (res.status === 429) throw new Error("The UCSC API is rate-limiting requests. Wait a moment and try again.")
        if (!res.ok) throw new Error(`The UCSC API answered ${res.status} ${res.statusText}.`)
        return res.json()
    }
    const p = _GC.queue.then(run, run)
    _GC.queue = p.catch(() => {})
    return p
}

// Plus-strand sequence, 0-based half-open, upper case.
async function _gcSequence(genome, chrom, start, end) {
    const key = `${genome}|${chrom}|${start}|${end}`
    if (_GC.seq.has(key)) return _GC.seq.get(key)
    const d = await _gcFetch(`/getData/sequence?genome=${genome};chrom=${chrom};start=${start};end=${end}`)
    if (!d || typeof d.dna !== "string") throw new Error("The UCSC API returned no sequence for this region.")
    const dna = d.dna.toUpperCase()
    _GC.seq.set(key, dna)
    return dna
}

// The gene's span from the symbol search. Search positions are 1-based
// inclusive; everything after this point is 0-based half-open like the
// sequence and track endpoints.
function _gcGeneSpan(search, symbol) {
    const matches = search && search.positionMatches ? search.positionMatches : []
    const want = symbol.toLowerCase()
    const byTrack = {}
    for (const pm of matches) byTrack[pm.trackName] = pm.matches || []

    const parse = m => {
        const r = /^(chr[^:]+):(\d+)-(\d+)$/.exec(m.position || "")
        if (!r) return null
        const name = String(m.posName || "").replace(/\s*\(.*$/, "").trim()
        return { chrom: r[1], start: parseInt(r[2], 10) - 1, end: parseInt(r[3], 10), name: name }
    }

    // An exact symbol match in the best track wins; a match that only came
    // through an alias is the fallback, since renamed genes still have to
    // be found.
    var exact = null, loose = null
    for (const track of _GC_SEARCH_TRACKS) {
        for (const m of byTrack[track] || []) {
            const p = parse(m)
            if (!p) continue
            if (!loose) loose = p
            if (p.name.toLowerCase() === want) { exact = p; break }
        }
        if (exact) break
    }
    const pick = exact || loose
    if (!pick) return null

    // Transcripts of one gene differ in their ends; take the union of every
    // exact-name match on the same chromosome that overlaps the pick.
    var span = { chrom: pick.chrom, start: pick.start, end: pick.end, name: pick.name, exact: !!exact }
    for (const track of _GC_SEARCH_TRACKS) {
        for (const m of byTrack[track] || []) {
            const p = parse(m)
            if (!p || p.chrom !== span.chrom || p.name.toLowerCase() !== want) continue
            if (p.end < span.start - 50000 || p.start > span.end + 50000) continue
            span.start = Math.min(span.start, p.start)
            span.end = Math.max(span.end, p.end)
        }
    }
    return span
}

function _gcRevComp(s) {
    const map = { A: "T", C: "G", G: "C", T: "A", N: "N", a: "t", c: "g", g: "c", t: "a", n: "n" }
    var out = ""
    for (var i = s.length - 1; i >= 0; i--) out += map[s[i]] || s[i]
    return out
}

// Every spacer + NGG site on either strand. Positions are offsets into dna
// and refer to the spacer itself on the plus strand.
function _gcFindSpacer(dna, spacer) {
    const hits = []
    const rc = _gcRevComp(spacer)
    var m
    const plus = new RegExp(`(?=${spacer}[ACGT]GG)`, "g")
    while ((m = plus.exec(dna)) !== null) { hits.push({ strand: "+", spacerStart: m.index }); plus.lastIndex = m.index + 1 }
    const minus = new RegExp(`(?=CC[ACGT]${rc})`, "g")
    while ((m = minus.exec(dna)) !== null) { hits.push({ strand: "-", spacerStart: m.index + 3 }); minus.lastIndex = m.index + 1 }
    return hits
}

// Names to try for one library entry, best first. Jacquere and Julianna list
// roughly 2,950 genes under a piped label — "ACE|nan" where the second field
// is a missing value, or "ABCF2|ABCF2-H2BK1" where the guide also hits a
// read-through transcript. Neither is a gene symbol any browser knows, so
// searching the label verbatim finds nothing; the parts are real symbols.
function _gcSymbolCandidates(symbol) {
    const raw = String(symbol || "").trim()
    const out = [raw]
    if (raw.includes("|")) {
        for (const part of raw.split("|")) {
            const t = part.trim()
            // "nan" is how a missing second field was written out when these
            // library files were built; it is not a gene.
            if (t && t.toLowerCase() !== "nan" && !out.includes(t)) out.push(t)
        }
    }
    return out
}

async function _gcLocate(species, symbol, spacer) {
    const g = _GC_GENOMES[species]
    const key = `${g.genome}|${symbol.toLowerCase()}|${spacer}`
    if (_GC.locus.has(key)) return _GC.locus.get(key)

    // Try each candidate name until one resolves to a gene. Only the search
    // is repeated; everything after it runs once.
    var search = null, span = null, usedSymbol = symbol
    for (const cand of _gcSymbolCandidates(symbol)) {
        search = await _gcFetch(`/search?search=${encodeURIComponent(cand)};genome=${g.genome}`)
        span = _gcGeneSpan(search, cand)
        if (span) { usedSymbol = cand; break }
    }
    var result
    if (!span) {
        result = { status: "noGene" }
    } else {
        const start = Math.max(0, span.start - _GC_GENE_PAD)
        const end = span.end + _GC_GENE_PAD
        if (end - start > _GC_MAX_SPAN) {
            result = { status: "tooLong", span: span }
        } else {
            const dna = await _gcSequence(g.genome, span.chrom, start, end)
            var used = spacer
            var hits = _gcFindSpacer(dna, used)
            // A leading G that was added for the U6 promoter is not part of
            // the genomic match.
            if (!hits.length && spacer.length > 19 && spacer[0] === "G") {
                used = spacer.slice(1)
                hits = _gcFindSpacer(dna, used)
            }
            if (!hits.length) {
                result = { status: "noHit", span: span, searched: { chrom: span.chrom, start: start, end: end } }
            } else {
                const sites = hits.map(h => ({
                    chrom: span.chrom, strand: h.strand,
                    spacerStart: start + h.spacerStart, spacer: used, trimmed: used !== spacer
                }))
                result = { status: sites.length === 1 ? "ok" : "multi", sites: sites, span: span,
                           usedSymbol: usedSymbol, renamed: usedSymbol !== symbol }
            }
        }
    }
    _GC.locus.set(key, result)
    return result
}

// Transcripts overlapping a window, from the first track that has any.
async function _gcTranscripts(genome, chrom, start, end) {
    const key = `${genome}|${chrom}|${start}|${end}`
    if (_GC.tx.has(key)) return _GC.tx.get(key)
    var list = []
    for (const track of _GC_TX_TRACKS) {
        const d = await _gcFetch(`/getData/track?genome=${genome};track=${track};chrom=${chrom};start=${start};end=${end}`)
        var items = d ? d[track] : null
        if (items && !Array.isArray(items)) items = Object.values(items).flat()
        if (!items || !items.length) continue
        list = items.filter(t => t.exonStarts && t.exonEnds).map(t => {
            const starts = String(t.exonStarts).split(",").filter(x => x !== "").map(Number)
            const ends = String(t.exonEnds).split(",").filter(x => x !== "").map(Number)
            return {
                name: t.name, gene: t.name2 || "", strand: t.strand,
                txStart: t.txStart, txEnd: t.txEnd, cdsStart: t.cdsStart, cdsEnd: t.cdsEnd,
                exons: starts.map((s, i) => [s, ends[i]]),
                track: track === "ncbiRefSeqSelect" ? "RefSeq Select" : "RefSeq Curated"
            }
        })
        if (list.length) break
    }
    _GC.tx.set(key, list)
    return list
}

// The transcript to annotate: the gene's own, overlapping the guide if it
// can, otherwise whatever overlaps the guide.
function _gcPickTranscript(list, symbol, site) {
    const want = symbol.toLowerCase()
    const spacerEnd = site.spacerStart + site.spacer.length
    const overlaps = t => t.txStart < spacerEnd && t.txEnd > site.spacerStart
    const named = t => t.gene.toLowerCase() === want
    return list.find(t => named(t) && overlaps(t)) || list.find(overlaps) || list.find(named) || null
}

// =============================================================================
// Building the annotated window
// =============================================================================

// The window is the spacer + PAM span plus `flank` on each side, in plus
// strand coordinates. Every base gets its features here; orientation is
// applied afterwards by flipping the array.
function _gcBuildPlus(site, tx, flank, dna, windowStart) {
    const L = site.spacer.length
    const spacerEnd = site.spacerStart + L
    const pamStart = site.strand === "+" ? spacerEnd : site.spacerStart - 3
    const pamEnd = pamStart + 3
    // SpCas9 cuts 3 nt from the PAM, between guide positions L-3 and L-2.
    // On the plus strand that is after plus index spacerStart+L-4 for a plus
    // guide and after spacerStart+2 for a minus guide.
    const cutAfter = site.strand === "+" ? site.spacerStart + L - 4 : site.spacerStart + 2

    const bases = []
    for (var i = 0; i < dna.length; i++) {
        const pos = windowStart + i
        const b = { base: dna[i], pos: pos, spacer: false, pam: false, exon: 0, coding: false, cutAfter: pos === cutAfter }
        if (pos >= site.spacerStart && pos < spacerEnd) b.spacer = true
        else if (pos >= pamStart && pos < pamEnd) b.pam = true
        if (tx) {
            for (var k = 0; k < tx.exons.length; k++) {
                if (pos >= tx.exons[k][0] && pos < tx.exons[k][1]) {
                    b.exon = tx.strand === "+" ? k + 1 : tx.exons.length - k
                    b.coding = tx.cdsStart < tx.cdsEnd && pos >= tx.cdsStart && pos < tx.cdsEnd
                    break
                }
            }
        }
        bases.push(b)
    }
    return bases
}

// Reverse complement of the annotated window. The cut sits between two
// bases; after the flip it is still between the same two bases, but the one
// that used to be on its right is now on its left, so the flag moves to it.
function _gcFlip(bases) {
    const out = []
    for (var i = bases.length - 1; i >= 0; i--) {
        const b = Object.assign({}, bases[i])
        b.base = _gcRevComp(b.base)
        b.cutAfter = i > 0 && bases[i - 1].cutAfter
        out.push(b)
    }
    return out
}

// Contiguous runs of the same annotation, as 1-based inclusive ranges in the
// displayed orientation. Used by the FASTA header and the GenBank features.
function _gcRanges(bases, keyOf) {
    const ranges = []
    var cur = null
    bases.forEach((b, i) => {
        const key = keyOf(b)
        if (key && cur && cur.key === key && cur.end === i) { cur.end = i + 1; return }
        if (key) { cur = { key: key, start: i + 1, end: i + 1, b: b }; ranges.push(cur) } else cur = null
    })
    return ranges
}

// Where the guide falls in the transcript: an exon, an intron between two, or
// outside it altogether. Judged at the cut site.
function _gcExonSummary(bases, tx) {
    if (!tx) return "no RefSeq transcript found in this window"
    const idx = bases.findIndex(b => b.cutAfter)
    const at = bases[idx] || bases[Math.floor(bases.length / 2)]
    if (at.exon) return `exon ${at.exon} of ${tx.exons.length} (${at.coding ? "coding" : "UTR"})`
    const pos = at.pos
    if (pos < tx.txStart || pos >= tx.txEnd) return "outside the transcript"
    // Exons are stored in plus order; number them by transcript strand.
    for (var k = 0; k + 1 < tx.exons.length; k++) {
        if (pos >= tx.exons[k][1] && pos < tx.exons[k + 1][0]) {
            const a = tx.strand === "+" ? k + 1 : tx.exons.length - k - 1
            const b = tx.strand === "+" ? k + 2 : tx.exons.length - k
            return `intron between exons ${Math.min(a, b)} and ${Math.max(a, b)}`
        }
    }
    return "intron"
}

// =============================================================================
// Modal
// =============================================================================

function GC_open(symbol, spacer, guideId) {
    const clean = _gcCleanSpacer(spacer)
    _GC.current = {
        symbol: symbol, spacer: clean, guideId: guideId || symbol,
        species: _gcSpecies(), flank: _GC_FLANK_DEFAULT, pendingFlank: null, orientation: "guide",
        locus: null, site: null, tx: null, bases: null, windowStart: null
    }
    document.getElementById("gcModal").className = "fazeIn upset-modal-overlay"
    document.getElementById("gcTitle").textContent = `Genomic context — ${_GC.current.guideId}`
    if (!clean) {
        _gcMessage(`<p>${_escapeHtml(String(spacer))} is not a DNA sequence, so there is nothing to look up.</p>`)
        return
    }
    if (!_GC.current.species) {
        _gcMessage(
            `<p>Which genome should <b>${_escapeHtml(symbol)}</b> be looked up in? The uploaded library does not say.</p>` +
            `<div class="gcRow gcCenter">` +
            `<button class="validate-btn" onclick="GC_setSpecies('human')">Human (hg38)</button>` +
            `<button class="validate-btn" onclick="GC_setSpecies('mouse')">Mouse (mm39)</button></div>`)
        return
    }
    _gcRun()
}

function GC_close() {
    document.getElementById("gcModal").className = "fazeOut upset-modal-overlay"
}

function GC_setSpecies(species) {
    if (!_GC.current) return
    _GC.current.species = species
    _gcRun()
}

// Typing only stages a value; nothing is fetched until it is applied. Keeps
// the field free while the user edits, so a half-typed "8" on the way to 800
// is not treated as a number.
function GC_flankTyped(value) {
    if (!_GC.current) return
    const raw = parseInt(value, 10)
    _GC.current.pendingFlank = isNaN(raw) ? null : raw
    _gcSyncApplyButton()
}

function GC_nudgeFlank(delta) {
    if (!_GC.current) return
    const cur = _GC.current
    const from = (cur.pendingFlank == null) ? cur.flank : cur.pendingFlank
    // Step to the next multiple of 50 so the value stays on round numbers
    // however it was typed.
    const step = Math.abs(delta)
    const next = delta > 0
        ? (Math.floor(from / step) + 1) * step
        : (Math.ceil(from / step) - 1) * step
    cur.pendingFlank = Math.max(_GC_FLANK_MIN, Math.min(_GC_FLANK_MAX, next))
    const box = document.getElementById("gcFlank")
    if (box) box.value = cur.pendingFlank
    _gcSyncApplyButton()
}

// The button label carries the staged value, so it is clear what pressing it
// will fetch and that nothing has happened yet.
function _gcSyncApplyButton() {
    const cur = _GC.current
    if (!cur) return
    const btn = document.querySelector("#gcBody .gcApply")
    if (!btn) return
    const pending = (cur.pendingFlank == null) ? cur.flank : cur.pendingFlank
    const clamped = Math.max(_GC_FLANK_MIN, Math.min(_GC_FLANK_MAX, pending))
    const dirty = clamped !== cur.flank
    btn.disabled = !dirty
    btn.classList.toggle("gcApplyOn", dirty)
    btn.textContent = dirty ? `Show ${clamped} bp` : "Showing"
    for (const b of document.querySelectorAll("#gcBody .gcStep")) {
        b.disabled = (b.textContent === "+") ? clamped >= _GC_FLANK_MAX : clamped <= _GC_FLANK_MIN
    }
}

function GC_applyFlank() {
    if (!_GC.current) return
    const cur = _GC.current
    const raw = (cur.pendingFlank == null) ? cur.flank : cur.pendingFlank
    const f = Math.max(_GC_FLANK_MIN, Math.min(_GC_FLANK_MAX, raw))
    cur.flankNotice = (raw !== f)
        ? `${raw.toLocaleString("en-US")} bp is outside the permitted ${_GC_FLANK_MIN}–${_GC_FLANK_MAX.toLocaleString("en-US")} bp range — using ${f.toLocaleString("en-US")} bp.`
        : null
    cur.pendingFlank = null
    if (f === cur.flank) { if (cur.site) _gcShow(); return }
    cur.flank = f
    if (cur.site) _gcRender()
}

// Kept for anything that sets the flank directly rather than through the box.
function GC_setFlank(value) {
    if (!_GC.current) return
    GC_flankTyped(value)
    GC_applyFlank()
}

function GC_setOrientation(o) {
    if (!_GC.current) return
    _GC.current.orientation = o === "gene" ? "gene" : "guide"
    if (_GC.current.site) _gcShow()
}

function GC_pickSite(i) {
    const cur = _GC.current
    if (!cur || !cur.locus || !cur.locus.sites[i]) return
    cur.site = cur.locus.sites[i]
    _gcRender()
}

// Look up a different symbol for the same spacer — for a gene the search
// did not know, or one the library lists under an old name.
function GC_retrySymbol() {
    const el = document.getElementById("gcSymbolInput")
    if (!el || !_GC.current) return
    const s = el.value.trim()
    if (!s) return
    _GC.current.symbol = s
    _GC.current.site = null
    _gcRun()
}

function _gcMessage(html) {
    document.getElementById("gcBody").innerHTML = html
}

function _gcStatus(text, detail) {
    _gcMessage(`<p class="gcStatus">${_escapeHtml(text)}</p>` +
        (detail ? `<p class="gcSource">${_escapeHtml(detail)}</p>` : ""))
}

// One place to name the service, so every progress line says the same thing.
const _GC_SOURCE = "UCSC Genome Browser REST API (api.genome.ucsc.edu)"


async function _gcRun() {
    const cur = _GC.current
    const g = _GC_GENOMES[cur.species]
    _gcStatus(`Searching for ${cur.spacer} in ${cur.symbol}…`,
              `Querying the ${_GC_SOURCE} for the ${cur.symbol} locus in ${g.assembly}.`)
    var locus
    try {
        locus = await _gcLocate(cur.species, cur.symbol, cur.spacer)
    } catch (e) {
        _gcMessage(`<p class="gcError">${_escapeHtml(e.message)}</p>` +
                   `<div class="gcRow"><button class="validate-btn" onclick="_gcRun()">Try again</button></div>`)
        return
    }
    if (_GC.current !== cur) return
    cur.locus = locus

    const retry = `<div class="gcRow"><label for="gcSymbolInput">Try another symbol:</label> ` +
        `<input type="text" id="gcSymbolInput" value="${_escapeHtml(cur.symbol)}" size="14"> ` +
        `<button class="validate-btn" onclick="GC_retrySymbol()">Look up</button></div>`

    if (locus.status === "noGene") {
        const tried = _gcSymbolCandidates(cur.symbol)
        _gcMessage(`<p class="gcError"><b>${_escapeHtml(cur.symbol)}</b> was not found in ${g.assembly} at UCSC` +
                   (tried.length > 1 ? ` (tried ${tried.map(t => `<b>${_escapeHtml(t)}</b>`).join(" and ")})` : "") + `. ` +
                   `Libraries built before 2020 use older symbols; try the current one.</p>` + retry)
        return
    }
    if (locus.status === "tooLong") {
        const mb = ((locus.span.end - locus.span.start) / 1e6).toFixed(1)
        _gcMessage(`<p class="gcError">${_escapeHtml(cur.symbol)} spans ${mb} Mb, more than this tool will search.</p>` + retry)
        return
    }
    if (locus.status === "noHit") {
        const s = locus.searched
        _gcMessage(`<p class="gcError">${cur.spacer} followed by NGG was not found on either strand within ` +
                   `${s.chrom}:${(s.start + 1).toLocaleString()}-${s.end.toLocaleString()} (${_escapeHtml(cur.symbol)} ± 2 kb, ${g.assembly}).</p>` +
                   `<p>The guide may target a different gene under this symbol, or a region the current assembly places elsewhere.</p>` + retry)
        return
    }
    if (locus.status === "multi") {
        var list = `<p>${cur.spacer} + NGG occurs ${locus.sites.length} times within ${_escapeHtml(cur.symbol)}. Pick the site to show:</p><ul class="gcSites">`
        locus.sites.forEach((s, i) => {
            list += `<li><button class="validate-btn" onclick="GC_pickSite(${i})">${s.chrom}:${(s.spacerStart + 1).toLocaleString()} (${s.strand})</button></li>`
        })
        _gcMessage(list + "</ul>")
        return
    }
    cur.site = locus.sites[0]
    _gcRender()
}

// Fetch the window and its transcripts, then draw. Re-run when the flank
// changes; the located site is kept.
async function _gcRender() {
    const cur = _GC.current
    const g = _GC_GENOMES[cur.species]
    const site = cur.site
    // The window is the spacer plus `flank` on each side, and nothing else,
    // so a 20 nt guide at the default flank gives exactly 500 + 20 + 500. The
    // PAM is not added on top of that: it sits immediately 3' of the spacer
    // and is therefore already inside the downstream flank, where it is
    // marked like any other feature.
    const L = site.spacer.length
    const windowStart = Math.max(0, site.spacerStart - cur.flank)
    const windowEnd = site.spacerStart + L + cur.flank

    _gcStatus(`Loading ${(windowEnd - windowStart).toLocaleString("en-US")} bp of sequence and its exons…`,
              `From the ${_GC_SOURCE}: ${g.assembly} ${site.chrom}:${(windowStart + 1).toLocaleString("en-US")}-${windowEnd.toLocaleString("en-US")}, plus the overlapping RefSeq transcript.`)
    var dna, txList
    try {
        dna = await _gcSequence(g.genome, site.chrom, windowStart, windowEnd)
        txList = await _gcTranscripts(g.genome, site.chrom, windowStart, windowEnd)
    } catch (e) {
        _gcMessage(`<p class="gcError">${_escapeHtml(e.message)}</p>` +
                   `<div class="gcRow"><button class="validate-btn" onclick="_gcRender()">Try again</button></div>`)
        return
    }
    if (_GC.current !== cur || cur.site !== site) return
    cur.tx = _gcPickTranscript(txList, cur.symbol, site)
    cur.windowStart = windowStart
    cur.plusBases = _gcBuildPlus(site, cur.tx, cur.flank, dna, windowStart)
    _GC.usedThisRun = true
    _gcShow()
}

// True once a window is on screen; the output buttons only exist then, but
// a stale click during a refetch must not reach the builders.
function _gcReady() {
    return !!(_GC.current && _GC.current.site && _GC.current.plusBases)
}

// Everything the outputs need, in the displayed orientation.
function _gcView() {
    const cur = _GC.current
    const site = cur.site
    const viewStrand = cur.orientation === "guide" ? site.strand : (cur.tx ? cur.tx.strand : "+")
    const bases = viewStrand === "+" ? cur.plusBases : _gcFlip(cur.plusBases)
    const g = _GC_GENOMES[cur.species]
    const n = bases.length
    const spacerR = _gcRanges(bases, b => b.spacer ? "s" : null)[0]
    const pamR = _gcRanges(bases, b => b.pam ? "p" : null)[0]
    const cutIdx = bases.findIndex(b => b.cutAfter)
    const exonRanges = _gcRanges(bases, b => b.exon ? `e${b.exon}${b.coding ? "c" : "u"}` : null)
    const seq = bases.map(b => (b.spacer || b.pam) ? b.base.toUpperCase() : b.base.toLowerCase()).join("")
    return {
        cur: cur, site: site, g: g, bases: bases, n: n, viewStrand: viewStrand,
        chrom: site.chrom, start1: cur.windowStart + 1, end1: cur.windowStart + n,
        spacerR: spacerR, pamR: pamR, cutAfter: cutIdx + 1,   // 1-based position of the base before the cut
        exonRanges: exonRanges, seq: seq,
        region: `${site.chrom}:${(cur.windowStart + 1).toLocaleString("en-US")}-${(cur.windowStart + n).toLocaleString("en-US")}`,
        regionPlain: `${site.chrom}:${cur.windowStart + 1}-${cur.windowStart + n}`
    }
}

function _gcShow() {
    const v = _gcView()
    const cur = v.cur
    const tx = cur.tx
    const strandWord = s => s === "+" ? "plus" : "minus"

    const meta = []
    meta.push(["Guide", `${_escapeHtml(cur.guideId)} — 5'-${cur.spacer}-3'` +
        (cur.site.trimmed ? ` (matched without the leading G: ${cur.site.spacer})` : "")])
    meta.push(["Region", `${v.g.assembly} ${v.region}, ${v.n.toLocaleString("en-US")} bp, ${strandWord(v.viewStrand)} strand shown` +
        (v.viewStrand === "-" ? " (reverse complement of the reference)" : "")])
    meta.push(["Guide strand", `${strandWord(cur.site.strand)} (reference)`])
    if (cur.locus && cur.locus.renamed) {
        meta.push(["Searched as", `<i>${_escapeHtml(cur.locus.usedSymbol)}</i>, from the library's <i>${_escapeHtml(cur.symbol)}</i>`])
    }
    if (tx) {
        meta.push(["Gene", `<i>${_escapeHtml(tx.gene)}</i>` +
            (tx.gene.toLowerCase() !== cur.symbol.toLowerCase() ? ` (listed in the library as <i>${_escapeHtml(cur.symbol)}</i>)` : "") +
            `, ${strandWord(tx.strand)} strand, ${tx.exons.length} exons`])
        meta.push(["Transcript", `${_escapeHtml(tx.name)} (${tx.track})`])
    } else {
        meta.push(["Gene", `no RefSeq transcript overlaps this window`])
    }
    meta.push(["Cut site", `${_gcExonSummary(v.bases, tx)}; between positions ${v.cutAfter} and ${v.cutAfter + 1} below`])
    meta.push(["Spacer", `positions ${v.spacerR.start}–${v.spacerR.end}; PAM ${v.pamR.start}–${v.pamR.end}` +
        (v.viewStrand !== cur.site.strand ? " (shown as the reverse complement, PAM first)" : "")])

    var html = `<div class="gcMeta">` + meta.map(([k, val]) => `<div class="gcKey">${k}</div><div class="gcVal">${val}</div>`).join("") + `</div>`

    // "Guide" and "Gene" differ by one letter and say nothing about what
    // changes, so the choice is named by the strand each one shows. The help
    // sits on each label rather than on the pair, or hovering either one
    // explains the other.
    // Each control on its own row with a fixed-width caption, so the labels
    // and the fields line up instead of running together across one line.
    //
    // The flank is typed against a Show button rather than applied on change:
    // every change refetches from UCSC, so stepping 500 to 800 through the
    // keyboard would have fired three requests on the way.
    const pending = (cur.pendingFlank == null) ? cur.flank : cur.pendingFlank
    const dirty = pending !== cur.flank
    html += `<div class="gcControls">` +
        `<div class="gcCtrlRow">` +
        `<span class="gcCtrlLabel" title="How much genomic sequence to fetch on each side of the spacer. The PAM is counted inside this, not added to it. 500 bp suits a sequencing amplicon; go longer for a bigger product or to read through long deletions.">Flanking sequence</span>` +
        `<span class="gcStepper">` +
        `<button type="button" class="gcStep" onclick="GC_nudgeFlank(-50)" title="50 bp shorter"${pending <= _GC_FLANK_MIN ? " disabled" : ""}>&minus;</button>` +
        `<input type="number" id="gcFlank" min="${_GC_FLANK_MIN}" max="${_GC_FLANK_MAX}" step="50" value="${pending}" oninput="GC_flankTyped(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();GC_applyFlank()}">` +
        `<button type="button" class="gcStep" onclick="GC_nudgeFlank(50)" title="50 bp longer"${pending >= _GC_FLANK_MAX ? " disabled" : ""}>+</button>` +
        `</span>` +
        `<span class="gcUnit">bp each side</span>` +
        `<span class="gcHint">${_GC_FLANK_MIN}–${_GC_FLANK_MAX}</span>` +
        `<button type="button" class="validate-btn gcApply${dirty ? " gcApplyOn" : ""}" onclick="GC_applyFlank()"${dirty ? "" : " disabled"}>` +
        `${dirty ? `Show ${pending} bp` : "Showing"}</button>` +
        `</div>` +
        `<div class="gcCtrlRow">` +
        `<span class="gcCtrlLabel" title="Which of the two DNA strands the sequence below is written out as. Both contain the same information; they differ in which one reads left to right.">Read sequence as</span>` +
        `<span class="gcOrient">` +
        `<label title="The sequence is written along the strand the sgRNA matches, so the spacer reads 5' to 3' exactly as you ordered it, with the PAM straight after. Positions of the spacer and PAM are then the same for every guide.">` +
        `<input type="radio" name="gcOrient" value="guide" ${cur.orientation === "guide" ? "checked" : ""} onchange="GC_setOrientation('guide')"> sgRNA 5'&rarr;3'</label>` +
        `<label title="${tx ? "The sequence is written along the gene's own strand, so exons run in reading order. A guide on the opposite strand then appears as its reverse complement, with the PAM (CCN) ahead of the spacer." : "Unavailable: no RefSeq transcript overlaps this window, so there is no gene strand to write along."}"${tx ? "" : ' class="gcDisabled"'}>` +
        `<input type="radio" name="gcOrient" value="gene" ${cur.orientation === "gene" ? "checked" : ""} onchange="GC_setOrientation('gene')" ${tx ? "" : "disabled"}> gene 5'&rarr;3'</label></span>` +
        `</div>` +
        // How the edit will be read decides how long the PCR product should be,
        // which is the setting people most often need to change and the one
        // that was hidden inside the collapsed panel.
        `<div class="gcCtrlRow">` +
        `<span class="gcCtrlLabel" title="How you intend to read the edit. This sets the product size and how far the primers are kept from the cut; both are still editable under Primer-BLAST settings.\n\nFor amplicon NGS the product is not made as short as possible on purpose. A deletion that reaches a primer site destroys the amplicon and that allele simply disappears from the data, so the longest product the reads can still merge across is the safer choice. 280 bp is the ceiling for a 2×150 paired-end run, which needs the two reads to overlap; on a 2×250 run you can raise it to about 450.">Primers for</span>` +
        `<span class="gcOrient">` +
        Object.keys(_GC_PB_PRESETS).map(id =>
            `<label title="${_escapeHtml(_GC_PB_PRESETS[id].note)}">` +
            `<input type="radio" name="gcPreset" value="${id}" ${_gcPbActivePreset() === id ? "checked" : ""} onchange="GC_pbPreset('${id}')"> ` +
            `${_escapeHtml(_GC_PB_PRESETS[id].label)}</label>`).join("") +
        (_gcPbActivePreset() === "custom"
            ? `<label class="gcDisabled" title="Your own values, set under Primer-BLAST settings below."><input type="radio" name="gcPreset" checked disabled> custom</label>`
            : "") +
        `</span>` +
        `<span class="infoDot" onclick="INFO_showModal('infoPrimerReadouts.html','Sanger or amplicon NGS')" ` +
        `title="What each choice sets and why, with links to ICE, TIDE and CRISPResso2. Click to read.">i</span>` +
        `</div>` +
        // The selected option's own numbers, on their own line, where they
        // cannot be mistaken for a caption to whichever radio sits last.
        `<div class="gcCtrlRow gcPresetNote">` +
        `<span class="gcCtrlLabel"></span>` +
        `<span class="gcHint">${_escapeHtml(_gcPbActivePreset() === "custom"
            ? "Your own settings, below."
            : _GC_PB_PRESETS[_gcPbActivePreset()].note)}</span>` +
        `</div>` +
        `</div>`

    // What the flank change did, and whether the result can still carry
    // primers. Both are consequences of the number just typed, so they sit
    // directly under it.
    const warnings = []
    if (cur.flankNotice) warnings.push(cur.flankNotice)
    const win = _gcPrimerWindows(v)
    if (win.fwdRoom < 40 || win.revRoom < 40) {
        warnings.push(`Too short for primer design: keeping ${win.minDist} bp clear of the cut leaves ` +
            `${Math.max(0, win.fwdRoom)} bp before it and ${Math.max(0, win.revRoom)} bp after. ` +
            `Raise the flank to about ${_gcFlankFor(v, win.minDist, 100)} bp.`)
    } else if (win.fwdRoom < 100 || win.revRoom < 100) {
        warnings.push(`Tight for primer design: only ${Math.min(win.fwdRoom, win.revRoom)} bp of window on one side once ` +
            `${win.minDist} bp is kept clear of the cut. About ${_gcFlankFor(v, win.minDist, 100)} bp of flank would give Primer-BLAST more to work with.`)
    }
    const pbNow = _gcPbLoad()
    const prodMin = parseInt(pbNow.productMin, 10)
    if (!isNaN(prodMin) && prodMin > v.n) {
        warnings.push(`The Primer-BLAST settings ask for a product of at least ${prodMin} bp, which is longer than this ${v.n} bp sequence — ` +
            `Primer-BLAST would return nothing. Raise the flank to at least ${Math.ceil((prodMin - (v.n - 2 * cur.flank)) / 2)} bp, or lower the minimum product size.`)
    }
    for (const w of warnings) html += `<p class="gcWarn">${_escapeHtml(w)}</p>`

    html += `<div class="gcRow gcActions">` +
        `<button class="validate-btn" onclick="GC_copyFasta()" title="Plain text: flanks in lower case, spacer and PAM in upper case, positions in the header. Paste into Primer-BLAST, Primer3 or any editor.">Copy FASTA</button>` +
        `<button class="validate-btn" onclick="GC_copyRich()" title="Copies with the colouring, so a paste into Word or an e-mail keeps the exon shading and the spacer highlight.">Copy for Word</button>` +
        `<button class="validate-btn" onclick="GC_downloadGenBank()" title="A GenBank file with exon, spacer, PAM and cut-site features. Opens directly in SnapGene, Benchling, Geneious or ApE.">Download GenBank</button>` +
        `<button class="validate-btn" onclick="GC_openPrimerBlastForm()" title="Opens NCBI Primer-BLAST in a new tab with this sequence and every setting filled in, ready to submit. It will pause once to ask which genome hit is your intended target: tick the row for your gene and press Submit.">Open in Primer-BLAST</button>` +
        `<button class="validate-btn" onclick="GC_exportImage()" title="Save the annotated sequence as a figure: PNG, SVG, PDF, TIFF or a PowerPoint slide, at the width and resolution you choose.">Export image</button>` +
        `<button class="validate-btn" onclick="GC_aiExport()" title="Write a .json holding this guide, its genomic context and — if you paste them in — the Primer-BLAST candidates, each measured against the cut site. Attach it to an assistant and ask which pair to order.">Export for AI</button>` +
        `</div>` +
        `<p class="gcAlt">Primer-BLAST opens with everything filled in. It pauses once to ask which genome hit is your target &mdash; tick the row for your gene and press Submit.</p>`

    html += _gcSeqHtml(v)

    html += `<div class="gcLegend">` +
        `<span><span class="gcSwatch gcSpacer"></span>spacer</span>` +
        `<span><span class="gcSwatch gcPam"></span>PAM</span>` +
        `<span><span class="gcSwatch gcCutSwatch"></span>cut site</span>` +
        `<span><span class="gcSwatch gcExonC"></span>exon (coding)</span>` +
        `<span><span class="gcSwatch gcExonU"></span>exon (UTR)</span>` +
        `<span><span class="gcSwatch"></span>intron / intergenic</span>` +
        `</div>`

    html += _gcPbSettingsHtml(v)
    html += `<p class="gcFoot">Sequence and annotation from the UCSC Genome Browser API (${v.g.assembly}, ${tx ? tx.track : "RefSeq"}). ` +
            `Cut site assumes SpCas9, 3 nt from the PAM.</p>`

    _gcMessage(html)
}

// The sequence block: numbered lines, bases grouped in tens, features as
// spans. Runs of identical annotation share a span so the DOM stays small.
function _gcSeqHtml(v) {
    const perLine = window.innerWidth < 700 ? 30 : 60
    const cls = b => {
        const c = []
        if (b.spacer) c.push("gcSpacer")
        else if (b.pam) c.push("gcPam")
        if (b.exon) c.push(b.coding ? "gcExonC" : "gcExonU")
        return c.join(" ")
    }
    var html = `<div class="gcSeq" id="gcSeq">`
    for (var start = 0; start < v.n; start += perLine) {
        html += `<div class="gcLine"><span class="gcNum">${start + 1}</span><span class="gcBases">`
        var open = null
        for (var i = start; i < Math.min(v.n, start + perLine); i++) {
            const b = v.bases[i]
            const c = cls(b)
            if (i > start && (i - start) % 10 === 0) {
                if (open !== null) { html += "</span>"; open = null }
                html += " "
            }
            if (open !== c) {
                if (open !== null) html += "</span>"
                html += c ? `<span class="${c}">` : `<span>`
                open = c
            }
            html += (b.spacer || b.pam) ? b.base.toUpperCase() : b.base.toLowerCase()
            if (b.cutAfter) {
                html += `</span><span class="gcCut" title="Cas9 cut site"></span>`
                open = null
            }
        }
        if (open !== null) html += "</span>"
        html += `</span></div>`
    }
    return html + `</div>`
}

// =============================================================================
// Outputs
// =============================================================================

function _gcFastaHeader(v) {
    const cur = v.cur
    const tx = cur.tx
    const parts = [
        `${cur.guideId}`,
        `${v.g.assembly} ${v.regionPlain} (${v.viewStrand} strand)`,
        `spacer ${v.spacerR.start}-${v.spacerR.end}`,
        `PAM ${v.pamR.start}-${v.pamR.end}`,
        `cut between ${v.cutAfter} and ${v.cutAfter + 1}`
    ]
    if (v.viewStrand !== cur.site.strand) parts.push("spacer shown as reverse complement")
    if (tx) {
        const ex = v.exonRanges.map(r => `exon ${r.b.exon} ${r.start}-${r.end} (${r.b.coding ? "coding" : "UTR"})`)
        parts.push(`${tx.gene} ${tx.name}` + (ex.length ? `: ${ex.join(", ")}` : ": no exon in window"))
    }
    parts.push("Green Listed")
    return ">" + parts.join(" | ")
}

function GC_fastaText() {
    const v = _gcView()
    return _gcFastaHeader(v) + "\n" + (v.seq.match(/.{1,60}/g) || []).join("\n") + "\n"
}

function GC_copyFasta() {
    if (!_gcReady()) return
    _gcCopy(GC_fastaText(), null, "FASTA copied to the clipboard")
}

// HTML with inline styles, since Word keeps those and drops classes.
function GC_copyRich() {
    if (!_gcReady()) return
    const v = _gcView()
    const style = b => {
        var s = "font-family:Consolas,Menlo,monospace;"
        if (b.spacer) s += "background:#bbf7d0;font-weight:bold;"
        else if (b.pam) s += "background:#fecaca;font-weight:bold;"
        else if (b.exon) s += b.coding ? "background:#dbeafe;" : "background:#ede9fe;"
        return s
    }
    // One unbroken run of bases rather than numbered 60-base lines: the fixed
    // breaks survive the paste as hard line ends, which cannot be reflowed and
    // leave stray characters behind if the sequence is copied onward. Word
    // wraps the run to the page instead.
    var html = `<p style="font-family:Consolas,Menlo,monospace;font-size:10pt">${_escapeHtml(_gcFastaHeader(v))}</p>` +
               `<p style="font-family:Consolas,Menlo,monospace;font-size:10pt;word-wrap:break-word;word-break:break-all;overflow-wrap:break-word">`
    v.bases.forEach(b => {
        const ch = (b.spacer || b.pam) ? b.base.toUpperCase() : b.base.toLowerCase()
        html += `<span style="${style(b)}">${ch}</span>`
        if (b.cutAfter) html += `<span style="color:#dc2626;font-weight:bold">|</span>`
    })
    html += `</p><p style="font-size:9pt">Green: spacer. Red: PAM. Blue: coding exon. Violet: UTR exon. | marks the Cas9 cut site.</p>`
    _gcCopy(GC_fastaText(), html, "Copied with formatting — paste into Word")
}

function GC_genBankText() {
    const v = _gcView()
    const cur = v.cur
    const tx = cur.tx
    const date = _gcGbDate(new Date())
    const name = String(cur.guideId).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 16)
    const lines = []
    lines.push(`LOCUS       ${name.padEnd(16)} ${String(v.n).padStart(11)} bp    DNA     linear   UNA ${date}`)
    lines.push(`DEFINITION  Genomic context of sgRNA ${cur.guideId} (${cur.spacer}), ${v.g.assembly} ${v.regionPlain}, ${v.viewStrand} strand.`)
    lines.push(`ACCESSION   ${name}`)
    lines.push(`VERSION     ${name}`)
    lines.push(`SOURCE      ${v.g.organism}`)
    lines.push(`  ORGANISM  ${v.g.organism}`)
    lines.push(`            .`)
    lines.push(`COMMENT     Generated by Green Listed (greenlisted.cmm.se) from the UCSC Genome Browser API.`)
    lines.push(`            Cut site assumes SpCas9, 3 nt from the PAM.`)
    lines.push(`FEATURES             Location/Qualifiers`)
    const feat = (key, loc, quals) => {
        lines.push(`     ${key.padEnd(16)}${loc}`)
        for (const q of quals) lines.push(`                     ${q}`)
    }
    const loc = (start, end, strand) => strand === v.viewStrand ? `${start}..${end}` : `complement(${start}..${end})`
    feat("source", `1..${v.n}`, [
        `/organism="${v.g.organism}"`,
        `/mol_type="genomic DNA"`,
        `/chromosome="${v.chrom.replace(/^chr/, "")}"`,
        `/note="${v.g.assembly} ${v.regionPlain} (${v.viewStrand} strand)"`
    ])
    if (tx) {
        for (const r of v.exonRanges) {
            feat("exon", loc(r.start, r.end, tx.strand), [
                `/gene="${tx.gene}"`,
                `/number=${r.b.exon}`,
                `/note="${tx.name} exon ${r.b.exon}, ${r.b.coding ? "coding" : "UTR"}"`,
                `/label="${tx.gene} exon ${r.b.exon}"`
            ])
        }
    }
    feat("misc_feature", loc(v.spacerR.start, v.spacerR.end, cur.site.strand), [
        `/label="sgRNA ${cur.guideId}"`,
        `/note="spacer 5'-${cur.site.spacer}-3'"`
    ])
    feat("misc_feature", loc(v.pamR.start, v.pamR.end, cur.site.strand), [
        `/label="PAM"`,
        `/note="NGG"`
    ])
    feat("misc_feature", `${v.cutAfter}^${v.cutAfter + 1}`, [
        `/label="Cas9 cut site"`
    ])
    lines.push("ORIGIN")
    const seq = v.seq.toLowerCase()
    for (var i = 0; i < seq.length; i += 60) {
        const chunk = seq.slice(i, i + 60).match(/.{1,10}/g).join(" ")
        lines.push(`${String(i + 1).padStart(9)} ${chunk}`)
    }
    lines.push("//")
    return lines.join("\n") + "\n"
}

function _gcGbDate(d) {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`
}

function GC_downloadGenBank() {
    if (!_gcReady()) return
    const cur = _GC.current
    const text = GC_genBankText()
    const name = `${String(cur.guideId).replace(/[^A-Za-z0-9_.-]/g, "_")} context.gb`
    _downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), name)
}

// Where each primer may sit, derived from the cut and the clearance the user
// wants around it. Returned for both the URL and the panel, so the numbers on
// screen are the ones actually sent.
function _gcPrimerWindows(v) {
    const pb = _gcPbLoad()
    const minDist = Math.max(0, parseInt(pb.minDist, 10) || 0)
    const fwdEnd = v.cutAfter - minDist
    const revStart = v.cutAfter + 1 + minDist
    return {
        minDist: minDist,
        fwdStart: 1, fwdEnd: fwdEnd,
        revStart: revStart, revEnd: v.n,
        // How much room each primer actually has to land in.
        fwdRoom: fwdEnd,
        revRoom: v.n - revStart + 1
    }
}

// The smallest flank that leaves `room` bp for each primer outside `minDist`.
function _gcFlankFor(v, minDist, room) {
    // cutAfter sits `flank + spacerLen - 3` into the sequence in guide
    // orientation, and the reverse side mirrors it; solving either for the
    // flank gives the same figure, so the larger of the two margins governs.
    const lead = v.cutAfter - v.cur.flank
    return Math.max(_GC_FLANK_MIN, minDist + room - lead + 3)
}

// The sequence goes in as plain bases; Primer-BLAST reads GET parameters for
// every field set here (checked against the live form).
// Everything Primer-BLAST is told, built once so the two routes below cannot
// drift apart. Returns null, having explained itself, when the window cannot
// hold primers.
function _gcPrimerBlastParams() {
    if (!_gcReady()) return null
    const v = _gcView()
    const pb = _gcPbLoad()
    const w = _gcPrimerWindows(v)
    const fwdEnd = w.fwdEnd
    const revStart = w.revStart
    if (w.fwdRoom < 40 || w.revRoom < 40) {
        const need = _gcFlankFor(v, w.minDist, 100)
        alert(`A ${v.n} bp sequence leaves too little room for primers when ${w.minDist} bp is kept clear on each side of the cut ` +
              `(${Math.max(0, w.fwdRoom)} bp before it, ${Math.max(0, w.revRoom)} bp after).\n\n` +
              `Raise the flank to about ${need} bp each side, or reduce the clearance.`)
        return null
    }
    const p = new URLSearchParams()
    p.set("INPUT_SEQUENCE", v.seq)
    p.set("PRIMER5_START", "1")
    p.set("PRIMER5_END", String(fwdEnd))
    p.set("PRIMER3_START", String(revStart))
    p.set("PRIMER3_END", String(v.n))
    p.set("ORGANISM", v.g.organism)
    p.set("PRIMER_SPECIFICITY_DATABASE", pb.db)
    p.set("SEARCH_SPECIFIC_PRIMER", "on")

    // No USER_SEQLOC here. It is what would answer the "which of these hits
    // did you mean" question in advance, but the form page discards it, and
    // the only way to make it stick is to bypass the form, which costs far
    // more time than the question does.

    const num = (key, val) => { if (val !== "" && val != null && !isNaN(Number(val))) p.set(key, String(val)) }
    num("PRIMER_PRODUCT_MIN", pb.productMin)
    // Left blank this becomes 1000, which is shorter than the template and
    // silently bars any pair spanning the whole window. Default it to the
    // window instead, so the full sequence is usable.
    num("PRIMER_PRODUCT_MAX", (pb.productMax === "" || pb.productMax == null) ? v.n : pb.productMax)
    num("PRIMER_NUM_RETURN", pb.numReturn)
    num("PRIMER_MIN_TM", pb.tmMin)
    num("PRIMER_OPT_TM", pb.tmOpt)
    num("PRIMER_MAX_TM", pb.tmMax)
    num("PRIMER_MAX_DIFF_TM", pb.tmDiff)
    num("PRIMER_MIN_SIZE", pb.sizeMin)
    num("PRIMER_OPT_SIZE", pb.sizeOpt)
    num("PRIMER_MAX_SIZE", pb.sizeMax)
    num("PRIMER_MIN_GC", pb.gcMin)
    num("PRIMER_MAX_GC", pb.gcMax)
    return p
}

// The same settings, but shown on Primer-BLAST's own form rather than run, so
// what the app asked for can be read, changed, and learned from. This route
// necessarily meets the "which of these hits did you mean" step, because the
// form page is exactly what discards the answer to it — so say so rather than
// let it come as a surprise.
function GC_openPrimerBlastForm() {
    const p = _gcPrimerBlastParams()
    if (!p) return
    window.open(`${_GC_PB_FORM_URL}?${p.toString()}`, "_blank", "noopener")
}


// -----------------------------------------------------------------------------
// Primer-BLAST settings
// -----------------------------------------------------------------------------

function _gcPbLoad() {
    if (_GC.pb) return _GC.pb
    var stored = null
    try { stored = JSON.parse(localStorage.getItem(_GC_PB_STORE) || "null") } catch (e) { stored = null }
    if (!stored || stored._v !== _GC_PB_VERSION) stored = null
    _GC.pb = Object.assign({}, _GC_PB_DEFAULTS, stored || {})
    delete _GC.pb._v
    return _GC.pb
}

function GC_pbChange(key, value) {
    const pb = _gcPbLoad()
    pb[key] = value
    const toStore = Object.assign({}, pb, { _v: _GC_PB_VERSION })
    try { localStorage.setItem(_GC_PB_STORE, JSON.stringify(toStore)) } catch (e) { /* private mode: settings last the session */ }
}

function GC_pbReset() {
    _GC.pb = Object.assign({}, _GC_PB_DEFAULTS)
    try { localStorage.removeItem(_GC_PB_STORE) } catch (e) { /* nothing stored */ }
    if (_GC.current && _GC.current.plusBases) _gcShow()
}

function _gcPbSettingsHtml(v) {
    const pb = _gcPbLoad()
    const changed = Object.keys(_GC_PB_DEFAULTS).some(k => String(pb[k]) !== String(_GC_PB_DEFAULTS[k]))
    const num = (key, label, title, step) => {
        // The product ceiling defaults to this window rather than to
        // Primer-BLAST's 1000, so the placeholder has to say so.
        const stock = (key === "productMax") ? v.n : _GC_PB_STOCK[key]
        const ph = stock == null ? "" : ` placeholder="${stock}"`
        const tip = stock == null ? title : `${title} Leave blank for Primer-BLAST's own default of ${stock}.`
        return `<label title="${_escapeHtml(tip)}">${label} <input type="number" step="${step || 1}"${ph} value="${_escapeHtml(pb[key])}" onchange="GC_pbChange('${key}', this.value)"></label>`
    }
    // The windows are computed from the flank, so they are shown rather than
    // typed — otherwise the panel would state a range the link no longer uses.
    const w = _gcPrimerWindows(v)
    const windowLine = (w.fwdRoom < 1 || w.revRoom < 1)
        ? `<span class="gcPbComputed gcPbBad">No usable window at this flank.</span>`
        : `<span class="gcPbComputed">With the current ${v.cur.flank} bp flank: forward primer in ` +
          `<b>${w.fwdStart}–${w.fwdEnd}</b>, reverse in <b>${w.revStart}–${w.revEnd}</b> of ${v.n} bp. ` +
          `Changing the flank moves both.</span>`
    return `<details class="gcPb" ${(_GC.pbOpen || changed) ? "open" : ""} ontoggle="_GC.pbOpen = this.open">` +
        `<summary>Primer-BLAST settings${changed ? " (customised)" : ""}</summary>` +
        `<p class="gcPbNote">Sent along with the sequence when you open Primer-BLAST, together with the organism (${_escapeHtml(_GC_GENOMES[_GC.current.species].organism)}) and this window's genomic position, so it checks specificity against the genome and goes straight to designing rather than first asking you which hit was the intended target. ` +
        `Three things depart from Primer-BLAST's own settings: the minimum product size, raised to 500 bp; the maximum, set to the length of this window instead of 1000 so a pair may span all of it; and the primer windows, worked out from the cut. ` +
        `Every other box is left blank on purpose — Primer-BLAST fills those with its own documented defaults, shown in grey inside each box. ` +
        `That meets the ICE (400–800 bp, primers ≥150 bp from the cut) and TIDE (500–1500 bp, cut ~200 bp into the read) guidance. Anything you type here is remembered in this browser.</p>` +
        `<div class="gcPbGrid">` +
        num("minDist", "Keep primers clear of the cut", "Neither primer may sit closer than this to the cut site, so an indel cannot land under a primer and the trace has settled before the edit. ICE asks for 150 bp or more; TIDE prefers the cut about 200 bp into the read and needs at least 100 bp before it for alignment. The primer windows are worked out from this and the flank, so they follow whatever flank you choose.", 10) + `<span class="gcUnit">bp each side</span>` +
        windowLine +
        `<span class="gcPbHead">Product size</span>` + num("productMin", "min", "PCR product size minimum") + num("productMax", "max", "PCR product size maximum") +
        `<span class="gcPbHead">Primer Tm</span>` + num("tmMin", "min", "Primer melting temperature, minimum", 0.5) + num("tmOpt", "opt", "Primer melting temperature, optimum", 0.5) + num("tmMax", "max", "Primer melting temperature, maximum", 0.5) + num("tmDiff", "max diff", "Maximum Tm difference between the two primers", 0.5) +
        `<span class="gcPbHead">Primer length</span>` + num("sizeMin", "min", "Primer length, minimum") + num("sizeOpt", "opt", "Primer length, optimum") + num("sizeMax", "max", "Primer length, maximum") +
        `<span class="gcPbHead">GC %</span>` + num("gcMin", "min", "Primer GC content minimum, percent") + num("gcMax", "max", "Primer GC content maximum, percent") +
        `<span class="gcPbHead">Primers to return</span>` + num("numReturn", "", "How many primer pairs Primer-BLAST reports") +
        `<span class="gcPbHead">Specificity check</span><label class="gcPbWide"><select onchange="GC_pbChange('db', this.value)">` +
        _GC_PB_DBS.map(d => `<option value="${d.value}" ${pb.db === d.value ? "selected" : ""}>${d.label}</option>`).join("") +
        `</select></label>` +
        `</div>` +
        `<div class="gcRow"><button class="validate-btn" onclick="GC_pbReset()">Reset to defaults</button></div>` +
        `</details>`
}

// -----------------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------------

// Text first through the synchronous route, which needs no permission; the
// rich copy needs the Clipboard API. If everything fails the FASTA is shown
// selected in a box so it can still be copied by hand.
function _gcCopy(text, html, okMessage) {
    const status = document.getElementById("gcCopyStatus") || (() => {
        const el = document.createElement("div")
        el.id = "gcCopyStatus"
        el.className = "gcCopyStatus"
        const actions = document.querySelector("#gcBody .gcActions")
        if (actions) actions.after(el)
        return el
    })()
    const ok = () => { status.textContent = okMessage; status.className = "gcCopyStatus" }
    const failed = () => {
        status.className = "gcCopyStatus gcCopyFailed"
        status.innerHTML = `Could not copy automatically — select the text below and press Ctrl/Cmd+C.<br><textarea readonly class="gcFallback"></textarea>`
        const ta = status.querySelector("textarea")
        ta.value = text
        ta.focus()
        ta.select()
    }

    if (html && navigator.clipboard && window.ClipboardItem) {
        var settled = false
        const finish = good => { if (!settled) { settled = true; good ? ok() : failed() } }
        try {
            const item = new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([text], { type: "text/plain" })
            })
            navigator.clipboard.write([item]).then(() => finish(true), () => finish(false))
            setTimeout(() => finish(false), 1500)
        } catch (e) { finish(false) }
        return
    }

    try {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.setAttribute("readonly", "")
        ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;"
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, text.length)
        const copied = document.execCommand("copy")
        document.body.removeChild(ta)
        if (copied) { ok(); return }
    } catch (e) { /* fall through */ }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        var done = false
        const fin = good => { if (!done) { done = true; good ? ok() : failed() } }
        navigator.clipboard.writeText(text).then(() => fin(true), () => fin(false))
        setTimeout(() => fin(false), 1500)
    } else {
        failed()
    }
}

// =============================================================================
// Methods text
// =============================================================================

const _GC_METH_REF = {
    label: "UCSC Genome Browser",
    text: "Lee CM, Barber GP, Casper J, Clawson H, Diekhans M, Gonzalez JN, Hinrichs AS, Lee BT, Nassar LR, " +
          "Powell CC, Raney BJ, Rosenbloom KR, Schmelter D, Speir ML, Zweig AS, Haussler D, Haeussler M, " +
          "Kuhn RM, Kent WJ. UCSC Genome Browser enters 20th year. Nucleic Acids Res. 2020;48(D1):D756-D761. " +
          "doi: 10.1093/nar/gkz1012. REST API: https://api.genome.ucsc.edu"
}

// A sentence for the design methods, only when a context was actually looked
// up during the current run.
function GC_methodsSentence() {
    if (!_GC.usedThisRun || !_GC.current) return null
    const g = _GC_GENOMES[_GC.current.species]
    return `Genomic sequence flanking selected sgRNAs, with RefSeq Select exon annotation, was retrieved from the ` +
           `UCSC Genome Browser (${g.assembly}) through its REST API (Lee et al. 2020) for the design of ` +
           `PCR primers around the predicted cut site.`
}

function GC_methodsReference() {
    return _GC.usedThisRun ? _GC_METH_REF : null
}
