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
    activeSpecies: null,      // "human" or "mouse"
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

function VAL_search(sgRNAList) {
    const map = _validateState.activeSpecies === "human"
        ? _validateState.indexMapHuman
        : _validateState.indexMapMouse

    const found = []
    const notFound = []

    for (const seq of sgRNAList) {
        const key = seq.toUpperCase()
        if (map.has(key)) {
            const entries = map.get(key)
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
