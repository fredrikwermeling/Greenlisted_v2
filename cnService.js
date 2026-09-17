//
// Green Listed 2.0 — Copy-number lookup service
// MIT Open source
// -
// Loads the DepMap OmicsCNGene matrix (gene-major int16 binary,
// 20794 genes × 1929 cell lines, ~62 MB gzipped) and the slim cell-
// line metadata (display name, sex, primary disease, subtype). Both
// fetched lazily on first CN-mode activation. Gene and cell-line counts
// are read from cn_metadata.json at runtime — the numbers above are
// just orientation for a reader.
//
// Public surface:
//   CN_loadIfNeeded()                       → Promise<void>
//   CN_isLoaded()                           → bool
//   CN_listCellLines()                      → [{id, name, sex, disease, subtype, lineage}, ...]
//   CN_lookup(cellLineId, geneSymbol)       → number | null   (null = no data)
//   CN_tier(value)                          → {label, fg, bg}  bucketed for display
//
// Data is held in module-scope so it survives mode toggles without
// re-decoding.
//

const _CN_STATE = {
    loaded: false,
    loading: null,
    data: null,                // Float32Array, gene-major
    metadata: null,            // {genes, cellLines, nGenes, nCellLines, scaleFactor, naValue}
    geneIndex: null,           // Map<UPPER_SYMBOL, row index>
    cellLineIndex: null,       // Map<cell line ID, column index>
    cellLineMeta: null,        // {cellLines, cellLineName, sex, primaryDisease, subtype, lineage}
    globalSignatures: null,    // per-line WGD / Ploidy / Aneuploidy / CIN
    synIndex: null,            // Map<lower-symbol, Set<lower-synonym>>  (CN-internal fallback)
    synIndexLoading: null,
    geneLoc: null,             // {symbol: {chr, band, start, end}} for the matrix export
    geneLocLoading: null,
    progress: { phase: "idle", received: 0, total: 0, elapsedMs: 0 }
}

// External progress listener — UI registers a callback to redraw the
// download bar / ETA. Receives the live _CN_STATE.progress object. Kept as
// a simple module-scope hook so the service stays UI-agnostic.
let _CN_PROGRESS_LISTENER = null
function CN_onProgress(fn) { _CN_PROGRESS_LISTENER = fn }
// Unregister only if the caller is still the one listening, so a panel
// that finished waiting cannot silence a bar someone else just wired up.
function CN_offProgress(fn) { if (_CN_PROGRESS_LISTENER === fn) _CN_PROGRESS_LISTENER = null }
function _cnEmitProgress(phase, received, total, elapsedMs) {
    _CN_STATE.progress = { phase, received, total, elapsedMs }
    if (_CN_PROGRESS_LISTENER) {
        try { _CN_PROGRESS_LISTENER(_CN_STATE.progress) } catch (_) {}
    }
}

function CN_isLoaded() { return _CN_STATE.loaded }

// Read a decompressed stream into one ArrayBuffer of a size we already know.
//
// The obvious `new Response(stream).arrayBuffer()` keeps every chunk alive in
// a list and then allocates the full 80 MB result and copies into it, so for
// the length of that copy the tab holds the matrix twice — about 160 MB, on
// top of whatever else is in flight. A phone tab does not survive that, which
// is what "it still crashes when I add a cell line" was. The matrix dimensions
// come from cn_metadata.json, which has already been parsed by the time we get
// here, so the destination can be allocated once up front and written into as
// the chunks arrive: one 80 MB allocation, no copy of the whole thing.
//
// If the stream turns out longer than the dimensions promised (a rebuilt
// cn.bin that shipped without its metadata, say) we grow rather than truncate,
// so a mismatch is a slow load and not silently wrong numbers.
async function _cnDrainToInt16(stream, expectedBytes) {
    const reader = stream.getReader()
    let out = new Uint8Array(expectedBytes > 0 ? expectedBytes : 1 << 20)
    let off = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (off + value.length > out.length) {
            const grown = new Uint8Array(Math.max(out.length * 2, off + value.length))
            grown.set(out.subarray(0, off))
            out = grown
        }
        out.set(value, off)
        off += value.length
    }
    if (off !== expectedBytes) {
        console.warn(`CN matrix: expected ${expectedBytes} bytes, got ${off}`)
    }
    // A view, not a copy: slicing the buffer to length would put us back to
    // holding two of it, which is the whole thing this avoids.
    return new Int16Array(out.buffer, 0, Math.floor(off / 2))
}

// Everything needed to name, describe and pick a cell line: about 1.5 MB of
// JSON, and no part of the 62 MB matrix. Picking a line used to pull the whole
// matrix down before the field would so much as suggest a name, which on a
// phone meant a long dead pause and often a killed tab for a step the user had
// not committed to yet. The matrix is now fetched when a result actually needs
// a number — at Run, or when the copy-number lookup is used.
function CN_catalogReady() { return !!_CN_STATE.metadata }

async function CN_loadCatalogIfNeeded() {
    if (_CN_STATE.metadata) return
    if (_CN_STATE.catalogLoading) return _CN_STATE.catalogLoading
    _CN_STATE.catalogLoading = (async () => {
        // Slim cell-line metadata (display name / sex / cancer type) loads
        // first since it's small and gates the picker UI.
        const metaRes = await fetch("cellLineMetadata.json")
        _CN_STATE.cellLineMeta = await metaRes.json()
        // Genome signatures (per-line WGD + measured ploidy). Used to map
        // DepMap relative CN → actual copy estimate. Without ploidy, a
        // WGD line's "CN 1.0" would read as 2 copies when it's really 4.
        try {
            const gsRes = await fetch("globalSignatures.json")
            if (gsRes.ok) _CN_STATE.globalSignatures = await gsRes.json()
        } catch (e) { console.warn("Could not load globalSignatures.json:", e) }
        // CN metadata (gene list + cell-line list + scale factor).
        const cnMetaRes = await fetch("cn_metadata.json")
        const meta = await cnMetaRes.json()
        _CN_STATE.geneIndex = new Map()
        meta.genes.forEach((g, i) => _CN_STATE.geneIndex.set(g.toUpperCase(), i))
        _CN_STATE.cellLineIndex = new Map()
        meta.cellLines.forEach((cl, i) => _CN_STATE.cellLineIndex.set(cl, i))
        // Set last: CN_catalogReady() reads it, and a half-built index is
        // worse than none.
        _CN_STATE.metadata = meta
    })()
    return _CN_STATE.catalogLoading
}

async function CN_loadIfNeeded() {
    if (_CN_STATE.loaded) return
    if (_CN_STATE.loading) return _CN_STATE.loading
    _CN_STATE.loading = (async () => {
        const t0 = performance.now()
        await CN_loadCatalogIfNeeded()
        // Binary blob — streamed download with byte-level progress so the
        // UI can show received / total / ETA. The Content-Length header is
        // the gzipped size; the gzip stream is then piped through the
        // browser-native DecompressionStream.
        _cnEmitProgress("starting", 0, 0, 0)
        const binRes = await fetch("cn.bin.gz")
        const total = +binRes.headers.get("content-length") || 0
        let received = 0
        const tDl = performance.now()
        const counter = new TransformStream({
            transform(chunk, controller) {
                received += chunk.length
                _cnEmitProgress("downloading", received, total, performance.now() - tDl)
                controller.enqueue(chunk)
            }
        })
        const stream = binRes.body.pipeThrough(counter).pipeThrough(new DecompressionStream("gzip"))
        const matrix = await _cnDrainToInt16(stream,
            _CN_STATE.metadata.nGenes * _CN_STATE.metadata.nCellLines * 2)
        _cnEmitProgress("decoding", received, total, performance.now() - tDl)
        // Kept as the 16-bit integers the file holds, and turned into a
        // value only when one is read. It used to be copied into a Float32
        // array here, which doubled the resident size to 153 MB and, for the
        // length of the copy, held both at once: about 230 MB for a matrix
        // that is 76 MB. A phone tab that reaches that while the sgRNA index
        // is also being parsed gets killed by the OS, which is what "the app
        // crashes when I add a cell line" was. Two functions read this array
        // and both do the division themselves.
        _CN_STATE.data = matrix
        _CN_STATE.scale = _CN_STATE.metadata.scaleFactor
        _CN_STATE.na = _CN_STATE.metadata.naValue
        _CN_STATE.loaded = true
        _cnEmitProgress("done", received, total, performance.now() - tDl)
        // Synonym index loads in parallel — it's small (~10 MB text but
        // gets discarded after building the Map), and most lookups will
        // need it. We don't await here on the cold path; the resolver
        // does its own await on demand.
        CN_loadSynonymsIfNeeded()
        console.log(`CN matrix loaded: ${_CN_STATE.metadata.nGenes} genes × ${_CN_STATE.metadata.nCellLines} cell lines in ${((performance.now() - t0)/1000).toFixed(1)}s`)
    })()
    return _CN_STATE.loading
}

// Start fetching the copy-number matrix in the background once the app has
// settled, so the first click on a CN feature doesn't sit through the ~62 MB
// download. Idempotent — CN_loadIfNeeded returns the in-flight promise if a
// user opens the picker mid-prefetch, and the picker's progress bar picks up
// the download already under way.
//
// Skipped when the browser reports a metered or slow connection: nobody on
// mobile data should pay for 62 MB of a feature they may never open. Errors
// are swallowed, since a failed prefetch must not disturb the main flow —
// the real load path will surface any problem when the user asks for it.
// Whether a background download of tens of megabytes is a reasonable thing
// to start without being asked.
//
// The old test looked only at navigator.connection, which reports a metered
// or slow link — and which Safari does not implement at all, on iPhone or
// anywhere else. So on the one class of device where an unasked-for 100 MB
// and a few hundred megabytes of heap matter most, the guard never fired.
// Now: not on a touch screen, not on a narrow viewport, not on a device
// reporting little memory, and not on a metered or slow link where that is
// reported. Everything still loads on demand when a feature asks for it.
function APP_prefetchAllowed(what) {
    const why = (() => {
        try {
            if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return "touch screen"
            if (window.innerWidth <= 900) return "narrow viewport"
            if (navigator.deviceMemory != null && navigator.deviceMemory <= 4) return "low device memory"
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
            if (conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ""))) return "metered or slow connection"
        } catch (e) { /* treat an error as permission */ }
        return null
    })()
    if (why) console.log(`${what} prefetch skipped: ${why}`)
    return !why
}

function CN_prefetchWhenIdle() {
    if (_CN_STATE.loaded || _CN_STATE.loading) return
    if (!APP_prefetchAllowed("Copy-number matrix")) {
        return
    }
    const start = () => {
        if (_CN_STATE.loaded || _CN_STATE.loading) return
        CN_loadIfNeeded().catch(e => console.warn("CN prefetch failed (harmless):", e))
    }
    // Wait for the browser to be idle so the prefetch never competes with the
    // library file the user is actually waiting on.
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 8000 })
    else setTimeout(start, 4000)
}

// Loads libraries/human+mouse synonym.txt directly into a CN-internal
// Map, so symbol resolution (p53 → TP53) works even if the main app's
// _library.synonymMap hasn't been populated yet. Tab-separated, two-column
// (alias, canonical); we add both directions so either side resolves.
async function CN_loadSynonymsIfNeeded() {
    if (_CN_STATE.synIndex) return _CN_STATE.synIndex
    if (_CN_STATE.synIndexLoading) return _CN_STATE.synIndexLoading
    _CN_STATE.synIndexLoading = (async () => {
        // The app loads this same file at startup into _library.synonymMap,
        // in exactly this shape (lower-cased keys, Set values), and
        // CN_resolveSymbol is handed that map by every caller. Building a
        // second index from the same 9 MB of text doubles a structure that
        // costs tens of megabytes of objects, for nothing — on a phone that
        // is memory spent next to an 80 MB matrix. Only build it when the
        // app's own map is missing, which is what it was there for.
        const appMap = (typeof _library !== "undefined" && _library && _library.synonymMap) || null
        if (appMap && Object.keys(appMap).length > 0) {
            _CN_STATE.synIndex = new Map()   // empty: lookups fall through to appMap
            return _CN_STATE.synIndex
        }
        try {
            const res = await fetch("libraries/human+mouse synonym.txt")
            if (!res.ok) throw new Error("HTTP " + res.status)
            const txt = await res.text()
            const idx = new Map()
            const lines = txt.split("\n")
            for (let i = 1; i < lines.length; i++) {  // skip header
                const row = lines[i].split("\t")
                if (row.length < 2) continue
                const a = row[0].trim().toLowerCase()
                const b = row[1].trim().toLowerCase()
                if (!a || !b) continue
                if (!idx.has(a)) idx.set(a, new Set())
                idx.get(a).add(b)
                if (!idx.has(b)) idx.set(b, new Set())
                idx.get(b).add(a)
            }
            _CN_STATE.synIndex = idx
            console.log(`CN synonym index: ${idx.size} symbols`)
        } catch (e) {
            console.warn("CN synonym index unavailable:", e)
            _CN_STATE.synIndex = new Map()  // empty, lets lookups fall through cleanly
        }
        return _CN_STATE.synIndex
    })()
    return _CN_STATE.synIndexLoading
}

// Per-line ploidy + WGD flag. Falls back to assumed-diploid (2.0) when
// not available — the conservative choice (avoids fabricating WGD where
// we have no data).
function CN_genomeStats(cellLineId) {
    const gs = _CN_STATE.globalSignatures?.byCellLine?.[cellLineId]
    if (!gs) return { ploidy: 2.0, wgd: null, knownPloidy: false }
    return {
        ploidy: (gs.Ploidy != null && !isNaN(gs.Ploidy)) ? gs.Ploidy : 2.0,
        wgd: gs.WGD == null ? null : Boolean(gs.WGD),
        knownPloidy: gs.Ploidy != null && !isNaN(gs.Ploidy)
    }
}

// Returns the cell-line catalog sorted alphabetically by display name,
// each entry annotated with sex + primary disease + subtype + WGD + ploidy.
function CN_listCellLines() {
    if (!_CN_STATE.metadata) return []
    const m = _CN_STATE.cellLineMeta || {}
    const present = new Set(_CN_STATE.metadata.cellLines)  // only lines with CN data
    const list = []
    const idsByMeta = m.cellLines || []
    for (let i = 0; i < idsByMeta.length; i++) {
        const id = idsByMeta[i]
        if (!present.has(id)) continue
        const gs = CN_genomeStats(id)
        list.push({
            id,
            name: (m.cellLineName && m.cellLineName[id]) || id,
            stripped: (m.strippedCellLineName && m.strippedCellLineName[id]) || "",
            sex: (m.sex && m.sex[id]) || "",
            disease: (m.primaryDisease && m.primaryDisease[id]) || "",
            subtype: (m.subtype && m.subtype[id]) || "",
            lineage: (m.lineage && m.lineage[id]) || "",
            ploidy: gs.ploidy,
            wgd: gs.wgd,
            knownPloidy: gs.knownPloidy
        })
    }
    // Lines present in the CN matrix but missing from cellLineMetadata
    // would surface in the picker only as a bare DepMap ACH-... ID, with
    // no cancer-type or sex annotation — not useful for selection. Skip
    // them; the CN values are still retrievable via the lookup API for
    // any external caller that happens to know the ACH-ID.
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    return list
}

function CN_lookup(cellLineId, geneSymbol) {
    if (!_CN_STATE.loaded) return null
    const gi = _CN_STATE.geneIndex.get(String(geneSymbol).toUpperCase())
    const ci = _CN_STATE.cellLineIndex.get(cellLineId)
    if (gi === undefined || ci === undefined) return null
    const nCL = _CN_STATE.metadata.nCellLines
    const raw = _CN_STATE.data[gi * nCL + ci]
    return raw === _CN_STATE.na ? null : raw / _CN_STATE.scale
}

// Extract full gene columns for a set of cell lines — the backbone of the
// "download full matrix" export. Pulls straight from the in-memory matrix
// (gene-major, stride = nCellLines) rather than calling CN_lookup once per
// gene, so a 19k-gene × N-line export is a couple of tight loops. Returns
// { genes: string[] (matrix order), values: Map<cellLineId, Float32Array> }
// where each Float32Array is parallel to genes and holds raw relative CN
// (NaN where DepMap has no value, or the whole column NaN for an unknown id).
function CN_matrixColumns(cellLineIds) {
    if (!_CN_STATE.loaded) return { genes: [], values: new Map() }
    const genes = _CN_STATE.metadata.genes
    const nG = genes.length
    const nCL = _CN_STATE.metadata.nCellLines
    const data = _CN_STATE.data, sf = _CN_STATE.scale, na = _CN_STATE.na
    const values = new Map()
    for (const id of cellLineIds) {
        const ci = _CN_STATE.cellLineIndex.get(id)
        const col = new Float32Array(nG)
        if (ci === undefined) {
            col.fill(NaN)
        } else {
            for (let gi = 0; gi < nG; gi++) {
                const raw = data[gi * nCL + ci]
                col[gi] = raw === na ? NaN : raw / sf
            }
        }
        values.set(id, col)
    }
    return { genes, values }
}

// Gene genomic locations (chromosome / cytoband / start / end), used only
// by the full-matrix export to annotate and order rows by position. Lazily
// loaded so it stays off the hot CN load path. Source: Ensembl BioMart
// (GRCh38) with NCBI gene_info map_location as cytoband-only fallback.
async function CN_loadLocationsIfNeeded() {
    if (_CN_STATE.geneLoc) return _CN_STATE.geneLoc
    if (_CN_STATE.geneLocLoading) return _CN_STATE.geneLocLoading
    _CN_STATE.geneLocLoading = (async () => {
        try {
            const res = await fetch("gene_locations.json")
            if (!res.ok) throw new Error("HTTP " + res.status)
            const j = await res.json()
            _CN_STATE.geneLoc = j.genes || {}
            console.log(`CN gene locations: ${Object.keys(_CN_STATE.geneLoc).length} genes`)
        } catch (e) {
            console.warn("gene_locations.json unavailable:", e)
            _CN_STATE.geneLoc = {}   // empty — export just omits the location columns
        }
        return _CN_STATE.geneLoc
    })()
    return _CN_STATE.geneLocLoading
}

// Location for a single gene symbol, or null if not loaded / not mapped.
function CN_geneLocation(symbol) {
    if (!_CN_STATE.geneLoc) return null
    return _CN_STATE.geneLoc[symbol] || _CN_STATE.geneLoc[String(symbol).toUpperCase()] || null
}

// Resolve the user-input symbol against the CN gene list, falling back to
// (a) the library-level synonym map when present, then (b) the CN-internal
// synonym index loaded directly from libraries/human+mouse synonym.txt.
// The internal index makes alias resolution work even if the main app's
// _library.synonymMap hasn't finished loading. Returns the canonical
// CN-matrix symbol (upper-case) plus the synonym actually used (if any),
// or null if no match.
function CN_resolveSymbol(symbol, synonymMap) {
    if (!_CN_STATE.loaded) return { resolved: null, viaSynonym: null }
    const upper = String(symbol).toUpperCase()
    if (_CN_STATE.geneIndex.has(upper)) return { resolved: upper, viaSynonym: null }
    const lower = String(symbol).toLowerCase()
    // (a) main-app synonym map (Set-valued, lower-cased keys).
    if (synonymMap) {
        const synSet = synonymMap[lower]
        if (synSet) {
            for (const syn of synSet) {
                const su = String(syn).toUpperCase()
                if (_CN_STATE.geneIndex.has(su)) return { resolved: su, viaSynonym: syn }
            }
        }
    }
    // (b) CN-internal synonym index (Map<string, Set<string>>).
    if (_CN_STATE.synIndex) {
        const synSet2 = _CN_STATE.synIndex.get(lower)
        if (synSet2) {
            for (const syn of synSet2) {
                const su = syn.toUpperCase()
                if (_CN_STATE.geneIndex.has(su)) return { resolved: su, viaSynonym: syn }
            }
        }
    }
    return { resolved: null, viaSynonym: null }
}

// Awaitable variant: ensures the CN-internal synonym index has finished
// loading before resolving, so a cold-cache lookup of "p53" doesn't miss
// just because the synonym file hadn't arrived yet.
async function CN_resolveSymbolAsync(symbol, synonymMap) {
    await CN_loadSynonymsIfNeeded()
    return CN_resolveSymbol(symbol, synonymMap)
}

// Approximate actual copies — integer count rounded from a nominal
// baseline (2 for non-WGD lines, 4 for WGD lines). DepMap's measured
// ploidy is a population average that often comes out fractional
// (FaDu = 2.5n, A-375 = 2.85n, etc.) because parts of the genome have
// gained or lost chromosomes; multiplying CN by that fractional value
// produces noisy decimals like "2.5 copies" that don't match the
// integer-per-cell biology and obscure the point. Using a nominal
// 2 or 4 instead snaps everything to whole numbers a screener can
// reason about:
//
//   non-WGD line: CN 1.0 → 2 copies, CN 0.5 → 1 copy, CN 0.0 → 0 copies,
//                 CN 1.5 → 3 copies, CN 3.0 → 6 copies, CN 5.0 → 10.
//   WGD line:     CN 1.0 → 4 copies, CN 0.5 → 2 copies, CN 0.25 → 1.
//
// Fallback: if WGD status is unknown the line is treated as non-WGD —
// the conservative choice (we don't fabricate a doubling event we have
// no evidence for).
function CN_approxCopies(v, ploidy, wgd) {
    if (v == null || isNaN(v)) return null
    const p = wgd === true ? 4 : 2
    return Math.round(v * p)
}

// Bucket a CN value into a labeled tier matching the Correlate V2 UI:
//   deep del   < 0.3   (red)
//   het loss   0.3–0.7 (light red)
//   WT         0.7–1.3 (gray)
//   low gain   1.3–2.0 (pale indigo)
//   gain       2.0–3.0 (blue)
//   amp        3.0–5.0 (medium blue)
//   strong amp ≥ 5.0   (saturated blue)
function CN_tier(v) {
    if (v == null || isNaN(v)) return { label: "no data", fg: "#9ca3af", bg: "#f3f4f6" }
    if (v < 0.3)  return { label: "deep del",   fg: "#7f1d1d", bg: "#fee2e2" }
    if (v < 0.7)  return { label: "het loss",   fg: "#991b1b", bg: "#fef2f2" }
    if (v < 1.3)  return { label: "WT",         fg: "#6b7280", bg: "#f3f4f6" }
    if (v < 2.0)  return { label: "low gain",   fg: "#3730a3", bg: "#eef2ff" }
    if (v < 3.0)  return { label: "gain",       fg: "#1e40af", bg: "#dbeafe" }
    if (v < 5.0)  return { label: "amp",        fg: "#1e3a8a", bg: "#bfdbfe" }
    return { label: "strong amp", fg: "#1e3a8a", bg: "#93c5fd" }
}
