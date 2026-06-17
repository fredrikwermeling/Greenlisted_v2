//
// Green Listed 2.0 — Copy-number lookup service
// MIT Open source
// -
// Loads the DepMap OmicsCNGeneWGS matrix (gene-major int16 binary,
// 19366 genes × 1095 cell lines, ~34 MB gzipped) and the slim cell-
// line metadata (display name, sex, primary disease, subtype). Both
// fetched lazily on first CN-mode activation.
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
    progress: { phase: "idle", received: 0, total: 0, elapsedMs: 0 }
}

// External progress listener — UI registers a callback to redraw the
// download bar / ETA. Receives the live _CN_STATE.progress object. Kept as
// a simple module-scope hook so the service stays UI-agnostic.
let _CN_PROGRESS_LISTENER = null
function CN_onProgress(fn) { _CN_PROGRESS_LISTENER = fn }
function _cnEmitProgress(phase, received, total, elapsedMs) {
    _CN_STATE.progress = { phase, received, total, elapsedMs }
    if (_CN_PROGRESS_LISTENER) {
        try { _CN_PROGRESS_LISTENER(_CN_STATE.progress) } catch (_) {}
    }
}

function CN_isLoaded() { return _CN_STATE.loaded }

async function CN_loadIfNeeded() {
    if (_CN_STATE.loaded) return
    if (_CN_STATE.loading) return _CN_STATE.loading
    _CN_STATE.loading = (async () => {
        const t0 = performance.now()
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
        _CN_STATE.metadata = await cnMetaRes.json()
        _CN_STATE.geneIndex = new Map()
        _CN_STATE.metadata.genes.forEach((g, i) => _CN_STATE.geneIndex.set(g.toUpperCase(), i))
        _CN_STATE.cellLineIndex = new Map()
        _CN_STATE.metadata.cellLines.forEach((cl, i) => _CN_STATE.cellLineIndex.set(cl, i))
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
        const buf = await new Response(stream).arrayBuffer()
        _cnEmitProgress("decoding", received, total, performance.now() - tDl)
        const int16 = new Int16Array(buf)
        const sf = _CN_STATE.metadata.scaleFactor
        const na = _CN_STATE.metadata.naValue
        const out = new Float32Array(int16.length)
        for (let i = 0; i < int16.length; i++) {
            out[i] = (int16[i] === na) ? NaN : int16[i] / sf
        }
        _CN_STATE.data = out
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

// Loads libraries/human+mouse synonym.txt directly into a CN-internal
// Map, so symbol resolution (p53 → TP53) works even if the main app's
// _library.synonymMap hasn't been populated yet. Tab-separated, two-column
// (alias, canonical); we add both directions so either side resolves.
async function CN_loadSynonymsIfNeeded() {
    if (_CN_STATE.synIndex) return _CN_STATE.synIndex
    if (_CN_STATE.synIndexLoading) return _CN_STATE.synIndexLoading
    _CN_STATE.synIndexLoading = (async () => {
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

// Returns the cell-line catalogue sorted alphabetically by display name,
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
    const v = _CN_STATE.data[gi * nCL + ci]
    return isNaN(v) ? null : v
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
    const data = _CN_STATE.data
    const values = new Map()
    for (const id of cellLineIds) {
        const ci = _CN_STATE.cellLineIndex.get(id)
        const col = new Float32Array(nG)
        if (ci === undefined) {
            col.fill(NaN)
        } else {
            for (let gi = 0; gi < nG; gi++) col[gi] = data[gi * nCL + ci]
        }
        values.set(id, col)
    }
    return { genes, values }
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
