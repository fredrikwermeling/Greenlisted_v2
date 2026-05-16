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
    cellLineMeta: null         // {cellLines, cellLineName, sex, primaryDisease, subtype, lineage}
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
        // CN metadata (gene list + cell-line list + scale factor).
        const cnMetaRes = await fetch("cn_metadata.json")
        _CN_STATE.metadata = await cnMetaRes.json()
        _CN_STATE.geneIndex = new Map()
        _CN_STATE.metadata.genes.forEach((g, i) => _CN_STATE.geneIndex.set(g.toUpperCase(), i))
        _CN_STATE.cellLineIndex = new Map()
        _CN_STATE.metadata.cellLines.forEach((cl, i) => _CN_STATE.cellLineIndex.set(cl, i))
        // Binary blob — browser-native gzip decode.
        const binRes = await fetch("cn.bin.gz")
        const stream = binRes.body.pipeThrough(new DecompressionStream("gzip"))
        const buf = await new Response(stream).arrayBuffer()
        const int16 = new Int16Array(buf)
        const sf = _CN_STATE.metadata.scaleFactor
        const na = _CN_STATE.metadata.naValue
        const out = new Float32Array(int16.length)
        for (let i = 0; i < int16.length; i++) {
            out[i] = (int16[i] === na) ? NaN : int16[i] / sf
        }
        _CN_STATE.data = out
        _CN_STATE.loaded = true
        console.log(`CN matrix loaded: ${_CN_STATE.metadata.nGenes} genes × ${_CN_STATE.metadata.nCellLines} cell lines in ${((performance.now() - t0)/1000).toFixed(1)}s`)
    })()
    return _CN_STATE.loading
}

// Returns the cell-line catalogue sorted alphabetically by display name,
// each entry annotated with sex + primary disease + subtype.
function CN_listCellLines() {
    if (!_CN_STATE.metadata) return []
    const m = _CN_STATE.cellLineMeta || {}
    const present = new Set(_CN_STATE.metadata.cellLines)  // only lines with CN data
    const list = []
    const idsByMeta = m.cellLines || []
    for (let i = 0; i < idsByMeta.length; i++) {
        const id = idsByMeta[i]
        if (!present.has(id)) continue
        list.push({
            id,
            name: (m.cellLineName && m.cellLineName[id]) || id,
            sex: (m.sex && m.sex[id]) || "",
            disease: (m.primaryDisease && m.primaryDisease[id]) || "",
            subtype: (m.subtype && m.subtype[id]) || "",
            lineage: (m.lineage && m.lineage[id]) || ""
        })
    }
    // Add any CN-only cell lines that aren't in the metadata file.
    for (const id of _CN_STATE.metadata.cellLines) {
        if (!m.cellLineName || !m.cellLineName[id]) {
            list.push({ id, name: id, sex: "", disease: "", subtype: "", lineage: "" })
        }
    }
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
