//
// GRNA 2.0 - Validate sgRNA Module
//
// Provides reverse lookup: sgRNA sequence → gene/library
// Loads species-specific pre-compiled index files and searches them
//

var _validateState = {
    indexMapHuman: null,      // Map<sgRNA → [{library, symbol, geneId, scores}]>
    indexMapMouse: null,
    humanLoaded: false,
    mouseLoaded: false,
    activeSpecies: null,      // "human", "mouse" or "both"
    isValidateMode: false,
    resultsOutput: "",
    notFoundOutput: ""
}

async function VAL_loadIndex(species) {
    if (species === "human" && _validateState.humanLoaded) return
    if (species === "mouse" && _validateState.mouseLoaded) return

    const filename = species === "human"
        ? "libraries/sgRNA_validation_index_human.txt"
        : "libraries/sgRNA_validation_index_mouse.txt"

    const text = await FH_fetchTextFile(filename)
    const lines = text.split("\n")
    const map = new Map()

    // Skip header and comment lines
    for (var i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith("#") || line.startsWith("sgRNA Sequence")) continue
        const cols = line.split("\t")
        const sgrna = cols[0].toUpperCase()
        const entry = {
            library: cols[1] || "",
            symbol: cols[2] || "",
            geneId: cols[3] || "",
            scores: cols[4] || ""
        }
        if (map.has(sgrna)) {
            map.get(sgrna).push(entry)
        } else {
            map.set(sgrna, [entry])
        }
    }

    if (species === "human") {
        _validateState.indexMapHuman = map
        _validateState.humanLoaded = true
    } else {
        _validateState.indexMapMouse = map
        _validateState.mouseLoaded = true
    }
}

// The indexes a run searches. "both" looks in the human and the mouse one,
// for a guide that may come from either, or to see whether it sits in a
// region conserved between the two.
function VAL_speciesList(species) {
    return species === "both" ? ["human", "mouse"] : [species]
}

function VAL_search(sgRNAList) {
    const list = VAL_speciesList(_validateState.activeSpecies)
    const maps = list.map(sp => [sp, sp === "human" ? _validateState.indexMapHuman : _validateState.indexMapMouse])

    const found = []
    const notFound = []

    for (const seq of sgRNAList) {
        const key = seq.toUpperCase()
        var hit = false
        for (const [sp, map] of maps) {
            if (!map.has(key)) continue
            hit = true
            for (const entry of map.get(key)) {
                found.push({
                    sgRNA: seq,
                    species: sp,
                    library: entry.library,
                    symbol: entry.symbol,
                    geneId: entry.geneId,
                    scores: entry.scores
                })
            }
        }
        if (!hit) notFound.push(seq)
    }
    return { found, notFound }
}

function VAL_createResultsOutput(results) {
    var out = "# Sequences identified as top picks in libraries extracted from https://www.addgene.org/pooled-library/#crispr and https://portals.broadinstitute.org/gpp/public/pool/index\n"
    // A Species column only when both were searched; with one it says the
    // same thing on every row.
    const both = _validateState.activeSpecies === "both"
    out += "sgRNA Sequence\t" + (both ? "Species\t" : "") + "Library\tGene Symbol\tGene ID\tScores\n"
    for (const row of results.found) {
        out += `${_spreadsheetSafe(row.sgRNA)}\t${both ? row.species + "\t" : ""}${_spreadsheetSafe(row.library)}\t${_spreadsheetSafe(row.symbol)}\t${_spreadsheetSafe(row.geneId)}\t${_spreadsheetSafe(row.scores)}\n`
    }
    return out
}

function VAL_createNotFoundOutput(results) {
    var out = "sgRNA Sequence\n"
    for (const seq of results.notFound) {
        out += _spreadsheetSafe(seq) + "\n"
    }
    return out
}
