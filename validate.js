//
// GRNA 2.0 - Validate sgRNA Module
//
// Provides reverse lookup: sgRNA sequence → gene/library
// Loads a pre-compiled index file and searches it
//

var _validateState = {
    indexLoaded: false,
    indexMap: null,       // Map<sgRNA → [{library, symbol, geneId, scores}]>
    isValidateMode: false,
    resultsOutput: "",
    notFoundOutput: ""
}

async function VAL_loadIndex() {
    if (_validateState.indexLoaded) return

    const text = await FH_fetchTextFile("libraries/sgRNA_validation_index.txt")
    const lines = text.split("\n")
    _validateState.indexMap = new Map()

    // Skip header line (line 0)
    for (var i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const cols = line.split("\t")
        const sgrna = cols[0].toUpperCase()
        const entry = {
            library: cols[1] || "",
            symbol: cols[2] || "",
            geneId: cols[3] || "",
            scores: cols[4] || ""
        }
        if (_validateState.indexMap.has(sgrna)) {
            _validateState.indexMap.get(sgrna).push(entry)
        } else {
            _validateState.indexMap.set(sgrna, [entry])
        }
    }
    _validateState.indexLoaded = true
}

function VAL_search(sgRNAList) {
    const found = []
    const notFound = []

    for (const seq of sgRNAList) {
        const key = seq.toUpperCase()
        if (_validateState.indexMap.has(key)) {
            const entries = _validateState.indexMap.get(key)
            for (const entry of entries) {
                found.push({
                    sgRNA: seq,
                    library: entry.library,
                    symbol: entry.symbol,
                    geneId: entry.geneId,
                    scores: entry.scores
                })
            }
        } else {
            notFound.push(seq)
        }
    }
    return { found, notFound }
}

function VAL_createResultsOutput(results) {
    var out = "sgRNA Sequence\tLibrary\tGene Symbol\tGene ID\tScores\n"
    for (const row of results.found) {
        out += `${row.sgRNA}\t${row.library}\t${row.symbol}\t${row.geneId}\t${row.scores}\n`
    }
    return out
}

function VAL_createNotFoundOutput(results) {
    var out = "sgRNA Sequence\n"
    for (const seq of results.notFound) {
        out += seq + "\n"
    }
    return out
}
