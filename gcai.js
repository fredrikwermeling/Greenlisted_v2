//
// Green Listed v2.0
//
// Export for AI — genomic context, and optionally the Primer-BLAST candidates,
// as one .json an assistant can be handed.
//
// The division of labour this is built around:
//
//   Primer-BLAST does two things no language model can. It computes
//   nearest-neighbour thermodynamics — melting temperature under real salt
//   conditions, hairpins, self- and cross-dimers — and it BLASTs both primers
//   against three gigabases of genome to find where else they would prime.
//   Neither is something to take on trust from a model.
//
//   What a model is good at is the part Primer-BLAST has no information for:
//   choosing between ten validated pairs given where the cut is, which exon it
//   sits in, how long a Sanger read has to stay clean, and what the experiment
//   is actually for — and saying why, and what the risks are.
//
// So this exports the context, and carries the candidates through rather than
// replacing them. The one transformation worth doing here is arithmetic the
// app is best placed to get right: Primer-BLAST reports positions relative to
// the template it was given and knows nothing about the cut site, so every
// pair is re-expressed as its distance from the cut, in both reading
// directions, and scored against the published ICE and TIDE guidance.
//
// The file also works with no candidates at all, for sanity-checking a locus
// or planning a design. It says which of the two it is rather than leaving the
// reader to infer it.
//

const _GCAI_STORE = "greenlisted.aiExportQuestion"

// Column names as Primer-BLAST writes them in its "Download CSV" file. Matched
// loosely so a renamed or reordered export still parses.
const _GCAI_COLS = {
    pair: /^primer pair/i,
    fSeq: /^forward.*sequence/i, fLen: /^forward.*length/i,
    fStart: /^forward.*start/i, fStop: /^forward.*stop/i,
    fTm: /^forward.*\btm\b/i, fGc: /^forward.*gc/i,
    fSelf: /^forward.*self complementarity/i, fSelf3: /^forward.*self 3/i,
    rSeq: /^reverse.*sequence/i, rLen: /^reverse.*length/i,
    rStart: /^reverse.*start/i, rStop: /^reverse.*stop/i,
    rTm: /^reverse.*\btm\b/i, rGc: /^reverse.*gc/i,
    rSelf: /^reverse.*self complementarity/i, rSelf3: /^reverse.*self 3/i,
    product: /^product length/i
}

// =============================================================================
// Parsing Primer-BLAST's CSV
// =============================================================================

function _gcaiSplitCsvLine(line) {
    const out = []
    var cur = "", q = false
    for (var i = 0; i < line.length; i++) {
        const c = line[i]
        if (q) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
            else if (c === '"') q = false
            else cur += c
        } else if (c === '"') q = true
        else if (c === ",") { out.push(cur); cur = "" }
        else cur += c
    }
    out.push(cur)
    return out
}

// Returns { pairs, error }. Tolerates the byte-order mark Primer-BLAST writes,
// its trailing comma on every row, and blank lines.
function GC_aiParsePrimerCsv(text) {
    const clean = String(text || "").replace(/^﻿/, "").trim()
    if (!clean) return { pairs: [], error: null }
    const lines = clean.split(/\r?\n/).filter(l => l.trim().length)
    if (lines.length < 2) return { pairs: [], error: "That looks like a header with no primer rows under it." }

    const header = _gcaiSplitCsvLine(lines[0]).map(h => h.trim())
    const idx = {}
    for (const key in _GCAI_COLS) {
        const n = header.findIndex(h => _GCAI_COLS[key].test(h))
        if (n >= 0) idx[key] = n
    }
    const need = ["fSeq", "fStart", "fStop", "rSeq", "rStart", "rStop", "product"]
    const missing = need.filter(k => idx[k] == null)
    if (missing.length) {
        return { pairs: [], error: "This does not look like a Primer-BLAST CSV — no forward/reverse primer columns found. Use the CSV link under \"Download primer pairs\" on the Primer-BLAST results page." }
    }

    const num = v => { const n = Number(String(v).trim()); return isFinite(n) ? n : null }
    const pairs = []
    for (var i = 1; i < lines.length; i++) {
        const c = _gcaiSplitCsvLine(lines[i])
        const fSeq = (c[idx.fSeq] || "").trim().toUpperCase()
        const rSeq = (c[idx.rSeq] || "").trim().toUpperCase()
        if (!/^[ACGT]+$/.test(fSeq) || !/^[ACGT]+$/.test(rSeq)) continue
        pairs.push({
            pair: idx.pair != null ? num(c[idx.pair]) : pairs.length + 1,
            forward: {
                sequence: fSeq, length: idx.fLen != null ? num(c[idx.fLen]) : fSeq.length,
                start: num(c[idx.fStart]), end: num(c[idx.fStop]),
                tm: idx.fTm != null ? num(c[idx.fTm]) : null,
                gcPercent: idx.fGc != null ? num(c[idx.fGc]) : null,
                selfComplementarity: idx.fSelf != null ? num(c[idx.fSelf]) : null,
                self3Complementarity: idx.fSelf3 != null ? num(c[idx.fSelf3]) : null
            },
            reverse: {
                // Primer-BLAST reports the reverse primer 5' end as "Start" and
                // its 3' end as "Stop", both on the plus strand of the
                // template, so Start is the larger number.
                sequence: rSeq, length: idx.rLen != null ? num(c[idx.rLen]) : rSeq.length,
                fivePrimeEnd: num(c[idx.rStart]), threePrimeEnd: num(c[idx.rStop]),
                tm: idx.rTm != null ? num(c[idx.rTm]) : null,
                gcPercent: idx.rGc != null ? num(c[idx.rGc]) : null,
                selfComplementarity: idx.rSelf != null ? num(c[idx.rSelf]) : null,
                self3Complementarity: idx.rSelf3 != null ? num(c[idx.rSelf3]) : null
            },
            productLength: num(c[idx.product])
        })
    }
    if (!pairs.length) return { pairs: [], error: "No primer rows could be read out of that." }
    return { pairs: pairs, error: null }
}

// =============================================================================
// Re-expressing the candidates around the cut
// =============================================================================

// Primer-BLAST positions everything relative to the template it was handed and
// has no idea where the cut is. This adds that, in both reading directions,
// plus a verdict against the ICE and TIDE guidance.
function _gcaiAnnotatePairs(pairs, v) {
    const cut = v.cutAfter                 // last base before the cut, 1-based
    const n = v.n
    return pairs.map(p => {
        const fEnd = p.forward.end               // forward primer 3' end
        const rLo = p.reverse.threePrimeEnd      // reverse primer 3' end (lower coord)
        const rHi = p.reverse.fivePrimeEnd       // reverse primer 5' end (higher coord)
        const fwdLeadIn = cut - fEnd             // bases from the forward primer to the cut
        const revLeadIn = rLo - cut - 1          // bases from the cut to the reverse primer
        const spansCut = p.forward.start <= cut && rHi > cut
        const notes = []
        if (!spansCut) notes.push("This product does not span the cut site, so it cannot be used to read the edit.")
        if (fwdLeadIn < 100) notes.push(`Only ${fwdLeadIn} bp between the forward primer and the cut; a Sanger read from this primer may still be settling when it reaches the edit.`)
        if (revLeadIn < 100) notes.push(`Only ${revLeadIn} bp between the cut and the reverse primer; a read from the reverse primer may still be settling when it reaches the edit.`)
        if (p.productLength != null && p.productLength < 400) notes.push("Shorter than the 400-800 bp ICE recommends.")
        if (p.productLength != null && p.productLength > 1500) notes.push("Longer than the 500-1500 bp TIDE recommends.")
        return Object.assign({}, p, {
            relativeToCutSite: {
                cutIsBetweenTemplatePositions: [cut, cut + 1],
                productSpansCutSite: spansCut,
                basesFromForwardPrimerToCut: fwdLeadIn,
                basesFromCutToReversePrimer: revLeadIn,
                readingForwardFromTheForwardPrimer: {
                    basesBeforeReachingTheCut: fwdLeadIn,
                    basesOfTemplateAfterTheCut: Math.max(0, rHi - cut)
                },
                readingBackFromTheReversePrimer: {
                    basesBeforeReachingTheCut: revLeadIn,
                    basesOfTemplateBeforeTheCut: Math.max(0, cut - p.forward.start + 1)
                }
            },
            fitsGuidance: {
                ice: p.productLength != null && p.productLength >= 400 && p.productLength <= 800
                     && fwdLeadIn >= 150 && revLeadIn >= 150,
                tide: p.productLength != null && p.productLength >= 500 && p.productLength <= 1500
                      && fwdLeadIn >= 100
            },
            notes: notes
        })
    })
}

// =============================================================================
// The file
// =============================================================================

function GC_aiBuild(pairs, question, csvWarning) {
    const v = _gcView()
    const cur = v.cur
    const tx = cur.tx
    const win = (typeof _gcPrimerWindows === "function") ? _gcPrimerWindows(v) : null
    const annotated = pairs && pairs.length ? _gcaiAnnotatePairs(pairs, v) : null
    const strandWord = s => s === "+" ? "plus" : "minus"

    const present = [
        "guide — the sgRNA, the library it came from, and the gene",
        "locus — where it sits in the genome, and in which exon",
        "template — the sequence around it, with the spacer, PAM and cut site located in it"
    ]
    const absent = []
    if (annotated) present.push(`primerCandidates — ${annotated.length} primer pairs from NCBI Primer-BLAST, each re-expressed relative to the cut site`)
    else absent.push("primerCandidates — none were supplied with this export, so there are no primer pairs in this file to choose between")

    return {
        _file: "Green Listed — genomic context for one CRISPR sgRNA" + (annotated ? ", with PCR primer candidates" : ""),
        _generated: new Date().toISOString(),

        whatIsInThisFile: {
            present: present,
            absent: absent,
            note: "Read this before looking for anything. An absent section is absent by design, not missing data."
        },

        aiInstructions:
            "WHO YOU ARE TALKING TO: a molecular biologist who exported this file from a tool called Green Listed and attached it. " +
            "They have not read it and cannot see inside it. They do not know what any field is called. " +
            "Never name a field, a key or a section of this file in your reply. Say what it means in ordinary words instead.\n\n" +
            "WHAT THEY ARE DOING: they have made a CRISPR knockout with the sgRNA described here and need PCR primers to amplify the edited " +
            "site so they can sequence it and measure the editing by ICE or TIDE. Both methods read a Sanger trace across the cut and infer " +
            "the spectrum of insertions and deletions.\n\n" +
            "OPEN YOUR REPLY with one short paragraph, no heading: which guide and gene this is, what you are being asked, and — if primer " +
            "candidates came with the file — how many there are to choose between.\n\n" +
            (annotated
                ? "THEN RECOMMEND ONE PAIR and say plainly why, in two or three sentences. The numbers you need are already worked out for each " +
                  "pair: how far each primer sits from the cut, whether the product spans it, and whether it fits the ICE and TIDE guidance. " +
                  "Do not recompute them from the positions; they are relative to the template in this file and easy to get wrong. " +
                  "Name a second choice and what would make you switch to it. Mention a real risk if there is one, and say plainly when there is not.\n\n"
                : "THEN, since no primer candidates came with the file, do not invent any. Designing primers needs melting temperatures computed " +
                  "under real salt conditions and a genome-wide search for where else they would prime, and neither can be done reliably by " +
                  "reading a sequence. Say so in one sentence, then help with what this file does support: checking the guide is where it should " +
                  "be, which exon it cuts, whether the edit is likely to disrupt the protein, and what to ask Primer-BLAST for. " +
                  "Tell them they can rerun the export with the Primer-BLAST CSV pasted in, and you will pick between the pairs.\n\n") +
            "THROUGHOUT: numbers support the answer, they are not the answer. Give the two or three that matter, each with what it means. " +
            "If something important is missing, say what you would need and how they would get it, in terms of what they would click.",

        question: question || null,

        guide: {
            identifier: cur.guideId,
            spacer: cur.spacer,
            spacerAsMatchedInTheGenome: cur.site.spacer,
            leadingGTrimmedBeforeMatching: !!cur.site.trimmed,
            pamSequence: v.seq.slice(v.pamR.start - 1, v.pamR.end).toUpperCase(),
            nuclease: "SpCas9, NGG PAM, blunt cut 3 bp from the PAM",
            library: (typeof settings !== "undefined" && settings.libraryName) || null,
            geneAsListedInTheLibrary: cur.symbol,
            geneSearchedFor: (cur.locus && cur.locus.usedSymbol) || cur.symbol
        },

        locus: {
            species: cur.species,
            assembly: v.g.assembly,
            chromosome: v.chrom,
            guideStrand: strandWord(cur.site.strand) + " strand of the reference",
            transcript: tx ? tx.name : null,
            transcriptSource: tx ? tx.track : null,
            geneSymbolInTheAnnotation: tx ? tx.gene : null,
            exonCount: tx ? tx.exons.length : null,
            cutSiteFallsIn: _gcExonSummary(v.bases, tx),
            genomicRegionOfThisTemplate: v.regionPlain
        },

        template: {
            sequence: v.seq.toUpperCase(),
            length: v.n,
            writtenAlong: strandWord(v.viewStrand) + " strand" +
                (v.viewStrand !== "+" ? " (the reverse complement of the reference, so the spacer reads 5' to 3')" : ""),
            coordinatesAre: "1-based and inclusive, counted along the sequence in this file",
            spacerAt: [v.spacerR.start, v.spacerR.end],
            pamAt: [v.pamR.start, v.pamR.end],
            cutIsBetween: [v.cutAfter, v.cutAfter + 1],
            note: "Primer-BLAST positions in this file refer to these same coordinates."
        },

        designConstraints: win ? {
            whatPrimerBlastWasAskedFor: {
                forwardPrimerWithin: [win.fwdStart, win.fwdEnd],
                reversePrimerWithin: [win.revStart, win.revEnd],
                minimumClearanceFromTheCutSite: win.minDist,
                minimumProductLength: (typeof _gcPbLoad === "function") ? _gcPbLoad().productMin : null
            },
            why: "Neither primer may sit near the cut, or an indel can land under a primer and the Sanger trace has no clean sequence " +
                 "before the edit. ICE asks for at least 150 bp of clearance and a 400-800 bp product; TIDE prefers the cut about 200 bp " +
                 "into the read, needs at least 100 bp before it, and a 500-1500 bp product."
        } : null,

        primerCandidates: annotated,
        primerCandidatesSource: annotated
            ? "NCBI Primer-BLAST, specificity checked against the " + v.g.organism + " reference genome. Positions are template coordinates; the cut-relative figures were added by Green Listed."
            : null,
        primerCandidatesWarning: csvWarning || null,

        howToJudgeAPrimerPair: [
            "The product must span the cut site. A pair that does not cannot report the edit at all.",
            "Neither primer should sit within about 150 bp of the cut. An indel under a primer stops it annealing, and the alleles carrying the biggest deletions are then the ones you fail to amplify, which biases the result toward looking unedited.",
            "The first 20-50 bases of a Sanger read are unreliable, so the distance from the sequencing primer to the cut needs to be comfortably more than that. Around 150-250 bp is the usual target.",
            "There must be enough clean sequence after the cut as well, since ICE and TIDE both infer the indel spectrum from the mixed trace downstream of it. Longer helps when deletions are large.",
            "Specificity matters more than a perfect melting temperature. A pair that also primes elsewhere in the genome gives a mixed trace that looks like editing.",
            "Between pairs that all satisfy the above, prefer closely matched melting temperatures and low self- and cross-complementarity."
        ],

        notIncluded: {
            thisFileDoesNotKnow: [
                "Whether a primer sits on a common SNP in the cell line or strain being used, which can cause allele dropout.",
                "Whether the amplicon contains a repeat, a homopolymer or a GC-rich stretch that sequences poorly.",
                "The polymerase, cycling conditions or sequencing provider, so annealing temperature is not tuned to a protocol.",
                "Anything about the actual edited sample, such as its clonality or the editing efficiency."
            ],
            howToAddPrimerCandidates:
                "In Green Listed, open the guide's Context panel, press Open in Primer-BLAST, run it, then on the results page use " +
                "Download primer pairs > CSV. Press Export for AI again and paste that CSV into the box before exporting."
        },

        provenance: {
            application: "Green Listed (greenlisted.cmm.se)",
            sequenceAndAnnotation: "UCSC Genome Browser REST API (api.genome.ucsc.edu), " + v.g.assembly +
                (tx ? ", " + tx.track + " transcripts" : ""),
            citation: "Henkel E, Li Z, Uvehag D, Schmierer B, Henkel M, Wermeling F. Green Listed v2.0: A Web Application for Streamlined Design of Custom CRISPR Screens. CRISPR J. 2025 Jun;8(3):216-223."
        }
    }
}

// =============================================================================
// Dialog
// =============================================================================

function GC_aiExport() {
    if (typeof _gcReady !== "function" || !_gcReady()) return
    const v = _gcView()
    var q = ""
    try { q = localStorage.getItem(_GCAI_STORE) || "" } catch (e) { q = "" }
    document.getElementById("gcaiBody").innerHTML =
        `<p class="gcaiNote">Writes one <b>.json</b> holding this guide, where it sits in the genome, the sequence around it with the ` +
        `spacer, PAM and cut site marked, and — if you paste them below — the primer pairs Primer-BLAST found, each re-expressed as its ` +
        `distance from the cut. Attach it to an assistant and ask which pair to order.</p>` +

        `<label class="gcaiLabel" for="gcaiCsv">Primer-BLAST results <span class="gcaiOpt">(optional)</span></label>` +
        `<p class="gcaiHint">On the Primer-BLAST results page, under <i>Download primer pairs</i>, click <b>CSV</b>, then paste the file here ` +
        `or drop it on this box. Without it the file still describes the locus, but carries no primer pairs to choose between.</p>` +
        `<textarea id="gcaiCsv" class="gcaiArea" rows="5" placeholder="Primer pair #,Forward primer Sequence (5'->3'),..." ` +
        `oninput="GC_aiCheckCsv()"></textarea>` +
        `<p class="gcaiStatus" id="gcaiCsvStatus"></p>` +

        `<label class="gcaiLabel" for="gcaiQ">What do you want to ask? <span class="gcaiOpt">(optional)</span></label>` +
        `<textarea id="gcaiQ" class="gcaiArea" rows="2" placeholder="Which primer pair should I order, and why?">${_escapeHtml(q)}</textarea>` +

        `<div class="gcxRow gcxCenter"><button class="validate-btn" onclick="GC_aiRun()">Export .json</button>` +
        `<button class="validate-btn" onclick="GC_aiClose()">Cancel</button></div>` +
        `<p class="gcaiFoot">Template in this file: ${v.n.toLocaleString("en-US")} bp, cut between ${v.cutAfter} and ${v.cutAfter + 1}. ` +
        `Primer-BLAST results pasted in must come from this same sequence.</p>`

    document.getElementById("gcaiModal").className = "fazeIn upset-modal-overlay"
    const area = document.getElementById("gcaiCsv")
    area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("gcaiDrop") })
    area.addEventListener("dragleave", () => area.classList.remove("gcaiDrop"))
    area.addEventListener("drop", e => {
        e.preventDefault(); area.classList.remove("gcaiDrop")
        const f = e.dataTransfer.files && e.dataTransfer.files[0]
        if (!f) return
        const r = new FileReader()
        r.onload = () => { area.value = r.result; GC_aiCheckCsv() }
        r.readAsText(f)
    })
}

function GC_aiClose() {
    document.getElementById("gcaiModal").className = "fazeOut upset-modal-overlay"
}

// Check the pasted results really belong to the sequence on screen. Primer-BLAST
// positions mean nothing without the template they came from, and the flank is
// adjustable, so a CSV from a different flank lines up with nothing.
function GC_aiCheckCsv() {
    const el = document.getElementById("gcaiCsv")
    const out = document.getElementById("gcaiCsvStatus")
    const txt = el.value.trim()
    if (!txt) { out.textContent = ""; out.className = "gcaiStatus"; return null }
    const { pairs, error } = GC_aiParsePrimerCsv(txt)
    if (error) { out.textContent = error; out.className = "gcaiStatus gcaiBad"; return null }
    const v = _gcView()
    const maxPos = Math.max(...pairs.map(p => Math.max(p.forward.end, p.reverse.fivePrimeEnd)))
    if (maxPos > v.n) {
        // The furthest primer only gives a lower bound on the template it was
        // run against — the template almost certainly extended past it — so
        // round up to the next step rather than quoting a figure that is
        // certainly too small.
        const spacerLen = v.spacerR.end - v.spacerR.start + 1
        const atLeast = Math.ceil((maxPos - spacerLen) / 2 / 50) * 50
        out.innerHTML = `Read ${pairs.length} primer pairs, but they reach position ${maxPos} of a ${v.n} bp sequence, so they were not run ` +
            `on this template. That needs a flank of at least ${atLeast} bp — set the flank to what you used, press Show, then export.`
        out.className = "gcaiStatus gcaiBad"
        return null
    }
    out.textContent = `Read ${pairs.length} primer pairs, consistent with this ${v.n} bp template.`
    out.className = "gcaiStatus gcaiGood"
    return pairs
}

function GC_aiRun() {
    if (!_gcReady()) return
    const csv = document.getElementById("gcaiCsv").value.trim()
    const question = document.getElementById("gcaiQ").value.trim()
    try { localStorage.setItem(_GCAI_STORE, question) } catch (e) { /* session only */ }

    var pairs = [], warning = null
    if (csv) {
        const parsed = GC_aiParsePrimerCsv(csv)
        if (parsed.error) { document.getElementById("gcaiCsvStatus").textContent = parsed.error; return }
        pairs = parsed.pairs
        const v = _gcView()
        const maxPos = Math.max(...pairs.map(p => Math.max(p.forward.end, p.reverse.fivePrimeEnd)))
        if (maxPos > v.n) {
            warning = `These primer positions reach ${maxPos} in a ${v.n} bp template, so they were computed on a different sequence — ` +
                      `probably a different flank length. Treat every cut-relative figure here as unreliable and say so.`
        }
    }

    const doc = GC_aiBuild(pairs, question, warning)
    const cur = _GC.current
    const name = `${String(cur.guideId).replace(/[^A-Za-z0-9_.-]/g, "_")} context for AI` +
                 (pairs.length ? " with primers" : "") + `.json`
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    GC_aiClose()
}
