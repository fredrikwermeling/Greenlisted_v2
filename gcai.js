//
// Green Listed v2.0
//
// Export for AI — genomic context, and optionally the Primer-BLAST candidates,
// as one .json an assistant can be handed.
//
// The division of labour this is built around:
//
//   Primer-BLAST does two things no language model can. It computes
//   nearest-neighbor thermodynamics — melting temperature under real salt
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

// Primer-BLAST offers the same table as Text, CSV and Tabular, and people
// also select the table on the page and copy it. Comma and tab both turn up,
// so the separator is taken from whichever the header actually uses rather
// than assumed.
function _gcaiSniffDelimiter(headerLine) {
    const commas = (headerLine.match(/,/g) || []).length
    const tabs = (headerLine.match(/\t/g) || []).length
    return tabs > commas ? "\t" : ","
}

function _gcaiSplitLine(line, delim) {
    const out = []
    var cur = "", q = false
    for (var i = 0; i < line.length; i++) {
        const c = line[i]
        if (q) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
            else if (c === '"') q = false
            else cur += c
        } else if (c === '"') q = true
        else if (c === delim) { out.push(cur); cur = "" }
        else cur += c
    }
    out.push(cur)
    return out
}

// The "Text" download, and the table as it reads on the results page, are laid
// out as a block per pair rather than a row. Parsed separately.
//
//   Primer pair 1
//           Sequence (5'->3')  Template strand  Length  Start  Stop  Tm  GC% ...
//   Forward primer  GCTAAAGG...  Plus  20  347  366  60.03  60.00  2.00  0.00
//   Reverse primer  AAACATGC...  Minus 20  1006 987  60.25  55.00  4.00  3.00
//   Product length  660
function _gcaiParseBlockFormat(text) {
    const lines = text.split(/\r?\n/)
    const pairs = []
    var cur = null
    const cells = l => l.trim().split(/\t+|\s{2,}/).map(x => x.trim()).filter(x => x.length)
    const num = v => { const n = Number(String(v).trim()); return isFinite(n) ? n : null }
    const side = c => ({
        sequence: c[1].toUpperCase(), strand: c[2] || null,
        length: num(c[3]), a: num(c[4]), b: num(c[5]),
        tm: num(c[6]), gcPercent: num(c[7]),
        selfComplementarity: num(c[8]), self3Complementarity: num(c[9])
    })
    for (const raw of lines) {
        const l = raw.trim()
        if (/^primer pair\s*\d+/i.test(l)) {
            if (cur && cur.forward && cur.reverse) pairs.push(cur)
            cur = { pair: num((l.match(/(\d+)/) || [])[1]) }
            continue
        }
        if (!cur) continue
        const c = cells(raw)
        if (/^forward primer/i.test(l) && c.length >= 6 && /^[ACGTacgt]+$/.test(c[1])) {
            const s = side(c)
            cur.forward = { sequence: s.sequence, length: s.length, start: s.a, end: s.b,
                            tm: s.tm, gcPercent: s.gcPercent,
                            selfComplementarity: s.selfComplementarity, self3Complementarity: s.self3Complementarity }
        } else if (/^reverse primer/i.test(l) && c.length >= 6 && /^[ACGTacgt]+$/.test(c[1])) {
            const s = side(c)
            cur.reverse = { sequence: s.sequence, length: s.length, fivePrimeEnd: s.a, threePrimeEnd: s.b,
                            tm: s.tm, gcPercent: s.gcPercent,
                            selfComplementarity: s.selfComplementarity, self3Complementarity: s.self3Complementarity }
        } else if (/^product length/i.test(l)) {
            // Taken as "the number on this line", not "the second cell": a
            // table copied off the page can separate the label from the value
            // with a single space, and the cell split then keeps them together
            // and the length is lost.
            cur.productLength = num((l.match(/(\d+)\s*$/) || [])[1])
        }
    }
    if (cur && cur.forward && cur.reverse) pairs.push(cur)
    return pairs.filter(p => p.forward && p.reverse).map((p, i) => Object.assign({ pair: p.pair || i + 1 }, p))
}

// The "Text" download is a third shape again: not a row per pair and not a
// row per primer, but one field per line, labelled.
//
//   Primer pair 1
//   Forward primer Sequence (5'->3'):       CCGTCCATTGGCCTCACATA
//   Forward primer Template strand:         Plus
//   Forward primer Start:                   38
//   ...
//   Product length:                         667
function _gcaiParseLabelFormat(text) {
    const lines = text.split(/\r?\n/)
    const pairs = []
    var cur = null
    const num = v => { const n = Number(String(v).trim()); return isFinite(n) ? n : null }
    const flush = () => { if (cur) pairs.push(cur) }
    for (const raw of lines) {
        const l = raw.trim()
        if (/^primer pair\s*\d+/i.test(l)) {
            flush()
            cur = { pair: num((l.match(/(\d+)/) || [])[1]), f: {}, r: {} }
            continue
        }
        if (!cur) continue
        const m = /^(forward|reverse)\s+primer\s+(.+?):\s*(.+)$/i.exec(l)
        if (m) {
            const t = m[1].toLowerCase() === "forward" ? cur.f : cur.r
            const field = m[2].trim().toLowerCase()
            const val = m[3].trim()
            // "Self 3' complementarity" before "Self complementarity": the
            // second is a prefix of nothing, but the first would fall through
            // to it if the order were reversed.
            if (/^sequence/.test(field)) t.sequence = val.toUpperCase()
            else if (/^template strand/.test(field)) t.strand = val
            else if (/^length/.test(field)) t.length = num(val)
            else if (/^start/.test(field)) t.a = num(val)
            else if (/^stop/.test(field)) t.b = num(val)
            else if (/^tm/.test(field)) t.tm = num(val)
            else if (/^gc/.test(field)) t.gcPercent = num(val)
            else if (/^self 3/.test(field)) t.self3Complementarity = num(val)
            else if (/^self complementarity/.test(field)) t.selfComplementarity = num(val)
            continue
        }
        const pm = /^product length\s*:\s*(\d+)/i.exec(l)
        if (pm) cur.productLength = num(pm[1])
    }
    flush()
    return pairs.map((p, i) => ({
        pair: p.pair || i + 1,
        forward: {
            sequence: p.f.sequence, length: p.f.length || (p.f.sequence || "").length,
            start: p.f.a, end: p.f.b, tm: p.f.tm, gcPercent: p.f.gcPercent,
            selfComplementarity: p.f.selfComplementarity, self3Complementarity: p.f.self3Complementarity
        },
        reverse: {
            // As everywhere else: Start is the reverse primer's 5' end and the
            // larger of the two, Stop its 3' end.
            sequence: p.r.sequence, length: p.r.length || (p.r.sequence || "").length,
            fivePrimeEnd: p.r.a, threePrimeEnd: p.r.b, tm: p.r.tm, gcPercent: p.r.gcPercent,
            selfComplementarity: p.r.selfComplementarity, self3Complementarity: p.r.self3Complementarity
        },
        productLength: p.productLength
    })).filter(p => /^[ACGT]+$/.test(p.forward.sequence || "") && /^[ACGT]+$/.test(p.reverse.sequence || "") &&
                    p.forward.start != null && p.reverse.fivePrimeEnd != null)
}

// Do these primers actually come from this sequence?
//
// Primer-BLAST positions mean nothing without the template they were run on,
// and the template changes with the guide. Two exports for two different
// guides in the same gene had the same results pasted into both, and the file
// was written twice without complaint: the only check was that the positions
// fell inside the template, and a position can fall inside a sequence it has
// nothing to do with. Both files then went to an assistant, which recommended
// a pair in each.
//
// So each primer is looked for where it says it is. The forward primer has to
// be the template at its own coordinates, and the reverse primer the reverse
// complement of the template at its own. Nothing else is as decisive: it fails
// on a different guide, a different gene, a different flank and a stale
// clipboard alike, and it cannot fail on results that genuinely belong here.
function _gcaiRevComp(s) {
    var out = ""
    for (var i = s.length - 1; i >= 0; i--) {
        const c = s[i]
        out += c === "A" ? "T" : c === "T" ? "A" : c === "C" ? "G" : c === "G" ? "C" : "N"
    }
    return out
}

function _gcaiVerifyPairs(pairs, v) {
    const seq = String(v.seq || "").toUpperCase()
    const bad = []
    for (const p of pairs) {
        const f = p.forward, r = p.reverse
        const atF = (f.start >= 1 && f.end <= seq.length) ? seq.slice(f.start - 1, f.end) : ""
        const atR = (r.threePrimeEnd >= 1 && r.fivePrimeEnd <= seq.length)
            ? _gcaiRevComp(seq.slice(r.threePrimeEnd - 1, r.fivePrimeEnd)) : ""
        if (atF !== f.sequence) bad.push({ pair: p.pair, which: "forward", at: [f.start, f.end], expected: f.sequence, found: atF })
        else if (atR !== r.sequence) bad.push({ pair: p.pair, which: "reverse", at: [r.threePrimeEnd, r.fivePrimeEnd], expected: r.sequence, found: atR })
    }
    return { ok: bad.length === 0, bad: bad, checked: pairs.length }
}

// Returns { pairs, error }. Tolerates the byte-order mark Primer-BLAST writes,
// its trailing comma on every row, and blank lines.
function GC_aiParsePrimerCsv(text) {
    const clean = String(text || "").replace(/^﻿/, "").trim()
    if (!clean) return { pairs: [], error: null }

    // The block layout has no column header, so try it first when the text
    // looks like it.
    if (/^\s*primer pair\s*\d+/im.test(clean) && /forward primer/i.test(clean)) {
        const blocks = _gcaiParseBlockFormat(clean)
        if (blocks.length) return { pairs: blocks, error: null }
        // Same opening line, different body: the Text download labels one
        // field per line where the copied table puts a primer on each row.
        const labelled = _gcaiParseLabelFormat(clean)
        if (labelled.length) return { pairs: labelled, error: null }
    }

    const lines = clean.split(/\r?\n/).filter(l => l.trim().length)
    if (lines.length < 2) return { pairs: [], error: "That looks like a header with no primer rows under it." }

    const delim = _gcaiSniffDelimiter(lines[0])
    // Underscores to spaces before matching. The Tabular download writes
    // "Forward_primer_Self_complementarity" where the CSV writes it with
    // spaces, which is the same column under a different spelling and was
    // enough to make the whole file unreadable.
    const header = _gcaiSplitLine(lines[0], delim).map(h => h.trim().replace(/_/g, " "))
    const idx = {}
    for (const key in _GCAI_COLS) {
        const n = header.findIndex(h => _GCAI_COLS[key].test(h))
        if (n >= 0) idx[key] = n
    }
    const need = ["fSeq", "fStart", "fStop", "rSeq", "rStart", "rStop", "product"]
    const missing = need.filter(k => idx[k] == null)
    if (missing.length) {
        return { pairs: [], error: "No forward and reverse primer columns could be found in that. Any of Primer-BLAST's three downloads works — Text, CSV or Tabular — and so does selecting the table on the results page and copying it." }
    }

    const num = v => { const n = Number(String(v).trim()); return isFinite(n) ? n : null }
    const pairs = []
    for (var i = 1; i < lines.length; i++) {
        const c = _gcaiSplitLine(lines[i], delim)
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

// Runs of a single base long enough to make a polymerase slip and a Sanger
// trace lose register. Eight is where it starts to matter in practice; an Alu
// poly-A tail is usually fifteen or more.
function _gcaiHomopolymers(seq) {
    const out = []
    const re = /([ACGT])\1{7,}/gi
    var m
    while ((m = re.exec(seq)) !== null) {
        out.push({ base: m[1].toUpperCase(), at: [m.index + 1, m.index + m[0].length], length: m[0].length })
    }
    return out
}

// Repeats in the template, said in words rather than as a track dump, plus
// the practical consequence: the stretches that are left for a primer.
function _gcaiRepeatSection(v) {
    const reps = v.repeatRanges || []
    const out = {
        whatThisIs: "RepeatMasker annotation of this template from UCSC, in the same coordinates as the sequence above. " +
                    "This is here to explain the shape of the result, not to be acted on. Primer-BLAST runs a genome-wide " +
                    "specificity search of its own and will not return a primer that matches in many places, so it already " +
                    "avoids these stretches without being told to: given a whole flank to search, it comes back using only " +
                    "the part that is not repetitive. What the annotation explains is why the candidates may all sit in one " +
                    "narrow stretch, or why there are fewer of them than expected. Neither is a mistake and neither is fixed " +
                    "by changing the search windows.",
        repeatsFound: reps.slice(0, 50).map(r => ({
            name: r.name,
            classification: [r.cls, r.family].filter(Boolean).join("/"),
            at: [r.start, r.end],
            length: r.end - r.start + 1,
            side: r.end < v.cutAfter ? "upstream of the cut" : (r.start > v.cutAfter ? "downstream of the cut" : "spans the cut")
        })),
        homopolymerRuns: _gcaiHomopolymers(v.seq)
    }
    if (reps.length > 50) out.repeatsNotListed = reps.length - 50
    // Everything not covered by a repeat, which is where a primer can go.
    const covered = new Uint8Array(v.n + 2)
    for (const r of reps) for (var i = r.start; i <= r.end; i++) covered[i] = 1
    const free = []
    var run = null
    for (var j = 1; j <= v.n; j++) {
        if (!covered[j]) { if (!run) { run = { start: j, end: j }; free.push(run) } else run.end = j }
        else run = null
    }
    out.stretchesFreeOfRepeat = free.filter(f => f.end - f.start + 1 >= 25).map(f => [f.start, f.end])
    // Counted by overlap, not by which side a stretch falls on: the usual
    // case is one long repeat-free stretch straddling the cut, and asking
    // which side it is on puts it on neither.
    const span = (f, lo, hi) => Math.max(0, Math.min(f.end, hi) - Math.max(f.start, lo) + 1)
    const up = free.reduce((a, f) => a + span(f, 1, v.cutAfter), 0)
    const down = free.reduce((a, f) => a + span(f, v.cutAfter + 1, v.n), 0)
    out.summary = reps.length === 0
        ? "No repeat was annotated anywhere in this template, so neither primer is constrained by one."
        : `${up} bp of the sequence before the cut and ${down} bp after it are free of repeat. ` +
          "A primer has to sit inside those stretches, which is what limits where the candidates could be placed."
    return out
}

// Does a primer overlap an annotated repeat? Reported per pair, because it is
// the single thing most likely to turn a clean-looking pair into a mixed trace.
function _gcaiInRepeat(v, from, to) {
    for (const r of (v.repeatRanges || [])) {
        if (from <= r.end && to >= r.start) return `${r.name} (${[r.cls, r.family].filter(Boolean).join("/")})`
    }
    return null
}

// Primer-BLAST positions everything relative to the template it was handed and
// has no idea where the cut is. This adds that, in both reading directions,
// plus a verdict against the ICE and TIDE guidance.
// A Sanger trace is unreadable for the first ~30 bases and stays reliable for
// roughly 700 after the primer, so the cut has to fall inside that window, and
// there has to be clean template beyond it for the indel spectrum to be read
// from. Both ICE and TIDE work this way; they differ in how much room they ask
// for on each side.
const _GCAI_SANGER_READ_LIMIT = 700

const _GCAI_SANGER_RULE =
    "Judged separately for each direction, because one trace is read from one primer. " +
    "The cut must be at least 150 bases past the sequencing primer for ICE (100 for TIDE), " +
    "no more than " + _GCAI_SANGER_READ_LIMIT + " bases past it, since a Sanger read is not " +
    "reliable beyond about that, and there must be at least 150 bases of template beyond the " +
    "cut for ICE (200 for TIDE) for the indel spectrum to be read from. Where both directions work, " +
    "sequenceThisProductWith names the one that puts the cut nearest 250 bases from the primer, which is " +
    "where a trace reads best: past the unreadable start and well before quality falls away."

function _gcaiFitsIce(toCut, beyondCut) {
    return toCut >= 150 && toCut <= _GCAI_SANGER_READ_LIMIT && beyondCut >= 150
}

function _gcaiFitsTide(toCut, beyondCut) {
    return toCut >= 100 && toCut <= _GCAI_SANGER_READ_LIMIT && beyondCut >= 200
}

// Which ends this product can be read from at all, as a sentence.
function _gcaiReadableFrom(fwdLeadIn, revLeadIn, rHi, cut, fStart) {
    const fwd = _gcaiFitsIce(fwdLeadIn, Math.max(0, rHi - cut)) || _gcaiFitsTide(fwdLeadIn, Math.max(0, rHi - cut))
    const rev = _gcaiFitsIce(revLeadIn, Math.max(0, cut - fStart + 1)) || _gcaiFitsTide(revLeadIn, Math.max(0, cut - fStart + 1))
    if (fwd && rev) return "either end: the cut can be reached from the forward primer and from the reverse primer"
    if (rev) return "the reverse primer only: from the forward primer the cut is out of reach of a Sanger read"
    if (fwd) return "the forward primer only: from the reverse primer the cut is out of reach of a Sanger read"
    return "neither end: the cut is out of reach of a single Sanger read from both primers"
}

// Which end to sequence from: the one that puts the cut inside a readable
// trace, and where both do, the one that puts it closest to where a trace is
// at its best. Not simply the furthest: the first 20-50 bases are unreadable
// and quality falls away towards the end, so 250 or so is the target, and a
// cut 700 bases out is worse than one at 300 rather than better.
const _GCAI_SANGER_IDEAL = 250

function _gcaiReadFrom(fwdLeadIn, revLeadIn) {
    const ok = d => d >= 100 && d <= _GCAI_SANGER_READ_LIMIT
    const fwdOk = ok(fwdLeadIn), revOk = ok(revLeadIn)
    if (fwdOk && revOk) {
        return Math.abs(fwdLeadIn - _GCAI_SANGER_IDEAL) <= Math.abs(revLeadIn - _GCAI_SANGER_IDEAL)
            ? "the forward primer" : "the reverse primer"
    }
    if (fwdOk) return "the forward primer"
    if (revOk) return "the reverse primer"
    return "neither: the cut is out of reach of a single Sanger read from either primer"
}

function _gcaiAnnotatePairs(pairs, v, readout) {
    const cut = v.cutAfter                 // last base before the cut, 1-based
    const n = v.n
    const sanger = readout !== "ngs"
    // Which pairs are the same amplicon as which.
    //
    // Primer-BLAST returns near-duplicates: the same site offered again
    // shifted a base or two. They look like ten choices and are not, and a
    // second choice that shares both sites with the first is no fallback at
    // all — whatever stops one stops the other. An assistant reading this file
    // recommended exactly that, calling the shifted copy "essentially as good".
    const span = p => ({ f: [p.forward.start, p.forward.end],
                         r: [p.reverse.threePrimeEnd, p.reverse.fivePrimeEnd] })
    const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1]
    const sameSites = pairs.map((p, i) => pairs
        .map((q, j) => ({ q: q, j: j }))
        .filter(o => o.j !== i && overlaps(span(p).f, span(o.q).f) && overlaps(span(p).r, span(o.q).r))
        .map(o => o.q.pair != null ? o.q.pair : o.j + 1))
    // The same information as one grouping rather than as a list on each pair.
    // A per-pair list has to be assembled in the reader's head to see the
    // groups, and that is where it went wrong: an assistant reading "pair 3 is
    // the same sites as 2 and 4" still offered pair 2 as the independent
    // fallback to pair 3.
    const groupOf = new Array(pairs.length).fill(0)
    var nextGroup = 0
    for (var gi = 0; gi < pairs.length; gi++) {
        if (groupOf[gi]) continue
        nextGroup++
        const queue = [gi]
        while (queue.length) {
            const k = queue.pop()
            if (groupOf[k]) continue
            groupOf[k] = nextGroup
            for (var gj = 0; gj < pairs.length; gj++) {
                if (!groupOf[gj] && overlaps(span(pairs[k]).f, span(pairs[gj]).f) &&
                    overlaps(span(pairs[k]).r, span(pairs[gj]).r)) queue.push(gj)
            }
        }
    }
    return pairs.map((p, pi) => {
        const fEnd = p.forward.end               // forward primer 3' end
        const rLo = p.reverse.threePrimeEnd      // reverse primer 3' end (lower coord)
        const rHi = p.reverse.fivePrimeEnd       // reverse primer 5' end (higher coord)
        const fwdLeadIn = cut - fEnd             // bases from the forward primer to the cut
        const revLeadIn = rLo - cut - 1          // bases from the cut to the reverse primer
        const spansCut = p.forward.start <= cut && rHi > cut
        // The amplicon, from the outer ends of the two primers. Primer-BLAST
        // prints it, but not in every format it offers, and a missing length
        // used to fail every size test silently: an assistant reading one of
        // those files concluded that all five pairs failed the guidance when
        // the geometry was fine, because the only number the tests had was
        // null. It is the distance between two positions already in this file,
        // so it is worked out rather than left out.
        const product = (p.productLength != null) ? p.productLength
                      : (p.forward.start != null && rHi != null) ? (rHi - p.forward.start + 1)
                      : null
        const notes = []
        if (!spansCut) notes.push("This product does not span the cut site, so it cannot be used to read the edit.")
        if (fwdLeadIn < 100) notes.push(`Only ${fwdLeadIn} bp between the forward primer and the cut; a Sanger read from this primer may still be settling when it reaches the edit.`)
        if (revLeadIn < 100) notes.push(`Only ${revLeadIn} bp between the cut and the reverse primer; a read from the reverse primer may still be settling when it reaches the edit.`)
        if (sanger && product != null && product < 400) notes.push("Shorter than the 400-800 bp ICE recommends.")
        if (sanger && product != null && product > 1500) notes.push("Longer than the 500-1500 bp TIDE recommends.")
        if (!sanger && product != null && product > 280) notes.push("Longer than about 280 bp, so the two reads of a 2x150 paired-end run will not overlap and cannot be merged.")
        // A primer inside a repeat is the failure this file can actually see
        // coming, so it is stated per pair rather than left in the section above.
        const fRep = _gcaiInRepeat(v, p.forward.start, p.forward.end)
        const rRep = _gcaiInRepeat(v, rLo, rHi)
        if (fRep) notes.push(`The forward primer lies inside an annotated repeat, ${fRep}. Expect it to prime elsewhere in the genome as well.`)
        if (rRep) notes.push(`The reverse primer lies inside an annotated repeat, ${rRep}. Expect it to prime elsewhere in the genome as well.`)
        const same = sameSites[pi]
        if (same.length) {
            notes.push(`Pair${same.length === 1 ? "" : "s"} ${same.join(", ")} ` +
                       `${same.length === 1 ? "uses" : "use"} the same two primer sites as this one, shifted by a base or two. ` +
                       `Not an independent fallback: whatever stops one will stop the other.`)
        }
        return Object.assign({}, p, {
            insideAnAnnotatedRepeat: { forwardPrimer: fRep, reversePrimer: rRep },
            // Worked out here because it is the comparison most often made by
            // eye across the candidate pairs, and most often got wrong: one reply named
            // a pair as having the closest-matched melting temperatures of
            // those that qualified when another pair was three times closer.
            tmDifference: (p.forward.tm != null && p.reverse.tm != null)
                ? Number(Math.abs(p.forward.tm - p.reverse.tm).toFixed(2)) : null,
            sameTwoPrimerSitesAs: sameSites[pi],
            // Pairs sharing a number here are the same two primer sites over
            // again. A fallback has to come from a different one.
            primerSiteGroup: groupOf[pi],
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
            productLength: product,
            productLengthSource: (p.productLength != null) ? "as reported by Primer-BLAST"
                : (product != null) ? "worked out from the primer positions in this template, since the pasted results did not carry it"
                : null,
            // Only the readout that was chosen. A Sanger export carrying an
            // amplicon-NGS verdict on every pair is ten lines of false there
            // about a method nobody asked for.
            //
            // And for Sanger, judged once per direction. ICE and TIDE read one
            // trace, from one primer, and the same product can be hopeless one
            // way and ideal the other: here the cut sat 829 bases from the
            // forward primer, past the end of a usable read, and 339 from the
            // reverse, which is exactly where you want it. A single verdict
            // for the pair said "no" to both, and an assistant reading it
            // reported that every pair failed rather than saying which primer
            // to sequence with.
            fitsGuidance: sanger ? {
                // The same fact as the four booleans below, in one line. Four
                // nested true/false values have to be read as a pair of pairs,
                // and one assistant read them as "both directions satisfy the
                // criteria" for a pair whose forward direction satisfies
                // neither. It still followed sequenceThisProductWith, so the
                // advice held, but the sentence it wrote was wrong.
                readableFrom: _gcaiReadableFrom(fwdLeadIn, revLeadIn, rHi, cut, p.forward.start),
                ice: { readingFromTheForwardPrimer: _gcaiFitsIce(fwdLeadIn, Math.max(0, rHi - cut)),
                       readingFromTheReversePrimer: _gcaiFitsIce(revLeadIn, Math.max(0, cut - p.forward.start + 1)) },
                tide: { readingFromTheForwardPrimer: _gcaiFitsTide(fwdLeadIn, Math.max(0, rHi - cut)),
                        readingFromTheReversePrimer: _gcaiFitsTide(revLeadIn, Math.max(0, cut - p.forward.start + 1)) },
                sequenceThisProductWith: _gcaiReadFrom(fwdLeadIn, revLeadIn),
                howThisIsJudged: _GCAI_SANGER_RULE
            } : {
                ampliconNgs: product != null && product >= 200 && product <= 280
                     && fwdLeadIn >= 50 && revLeadIn >= 50
            },
            notes: notes,
            // A pair either can be used for this readout or cannot, and the
            // reasons it cannot are facts already in this file rather than a
            // judgement. Spelled out because assistants reading the earlier
            // version dropped the disqualified pairs silently: a reader then
            // has no answer to "why not pair 1, its melting temperatures are
            // perfect?", which is exactly the question a list like this
            // invites.
            usable: _gcaiDisqualify(p, spansCut, fRep, rRep, product, sanger, fwdLeadIn, revLeadIn, rHi, cut).length === 0,
            disqualifiedBecause: _gcaiDisqualify(p, spansCut, fRep, rRep, product, sanger, fwdLeadIn, revLeadIn, rHi, cut)
        })
    })
}

// The hard failures, in the order a reader would raise them. Anything left
// here is a reason not to order the pair at all, as against the soft notes,
// which are things to know about one that can still be used.
function _gcaiDisqualify(p, spansCut, fRep, rRep, product, sanger, fwdLeadIn, revLeadIn, rHi, cut) {
    const out = []
    if (!spansCut) out.push("the product does not span the cut site, so it cannot report the edit")
    if (fRep) out.push("the forward primer lies inside an annotated repeat, so it will prime elsewhere in the genome")
    if (rRep) out.push("the reverse primer lies inside an annotated repeat, so it will prime elsewhere in the genome")
    if (sanger) {
        const fwdOk = _gcaiFitsTide(fwdLeadIn, Math.max(0, rHi - cut))
        const revOk = _gcaiFitsTide(revLeadIn, Math.max(0, cut - p.forward.start + 1))
        const fwdIce = _gcaiFitsIce(fwdLeadIn, Math.max(0, rHi - cut))
        const revIce = _gcaiFitsIce(revLeadIn, Math.max(0, cut - p.forward.start + 1))
        if (!fwdOk && !revOk && !fwdIce && !revIce) {
            out.push("the cut cannot be reached by a single Sanger read from either primer")
        }
    } else {
        if (product != null && product > 280) out.push(`the product is ${product} bp, too long for the reads of a 2x150 run to overlap and merge`)
        if (fwdLeadIn < 50) out.push(`the forward primer is only ${fwdLeadIn} bp from the cut, so a deletion can reach its site and that allele disappears from the counts`)
        if (revLeadIn < 50) out.push(`the reverse primer is only ${revLeadIn} bp from the cut, so a deletion can reach its site and that allele disappears from the counts`)
    }
    return out
}

// The pairs worth choosing between, in order, and the ones that are not.
//
// The file carried every number needed to rank them and left the ranking to
// the reader, which is the step that went wrong: one assistant chose the pair
// with the worst-matched melting temperatures of the set, 1.6 C apart, with a
// 0.1 C pair sitting beside it in the same file and the difference already
// worked out on both. So the order is stated, with the rule that produced it,
// and the reader is free to disagree in writing.
function _gcaiShortlist(annotated, sanger) {
    if (!annotated || !annotated.length) return null
    const key = a => {
        const tm = a.tmDifference == null ? 9 : Math.round(a.tmDifference * 2) / 2   // half-degree bands
        const self3 = Math.max(a.forward.self3Complementarity || 0, a.reverse.self3Complementarity || 0)
        const rel = a.relativeToCutSite
        const geometry = sanger
            // How far the cut sits from the primer it will be read with, against
            // the 250 or so where a trace is at its best.
            ? Math.abs(Math.min(
                Math.abs(rel.basesFromForwardPrimerToCut - 250),
                Math.abs(rel.basesFromCutToReversePrimer - 250)))
            // Under the ceiling, a longer product is safer, so this counts down.
            : -(a.productLength || 0)
        return [tm, self3, geometry, a.pair]
    }
    const usable = annotated.filter(a => a.usable).sort((x, y) => {
        const a = key(x), b = key(y)
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
        return 0
    })
    const out = annotated.length - usable.length
    return {
        // Said in words, because an empty notUsable is easy to read past and
        // easier still to fill in from somewhere else: an assistant answering
        // three of these files in one sitting reported two pairs of this one
        // as disqualified for a repeat, having taken the exclusions from a
        // different file. Nothing in the file said "nothing is excluded".
        summary: out === 0
            ? `No pair is disqualified. All ${annotated.length} clear every hard requirement, and bestFirst is simply the order to prefer them in.`
            : `${out} of ${annotated.length} pairs ${out === 1 ? "is" : "are"} disqualified, listed under notUsable with the reason. The rest are in bestFirst.`,
        bestFirst: usable.map(a => a.pair),
        howThisWasOrdered: sanger
            ? "Pairs that clear every hard requirement, ordered by closeness of the two melting temperatures (in half-degree bands, since a tenth of a degree decides nothing), then by 3' self-complementarity, then by how near the cut sits to 250 bases from the primer it would be read with."
            : "Pairs that clear every hard requirement, ordered by closeness of the two melting temperatures (in half-degree bands), then by 3' self-complementarity, then by product length, longest first, since a longer amplicon under the merge ceiling loses fewer large deletions.",
        notUsable: annotated.filter(a => !a.usable).map(a => ({ pair: a.pair, because: a.disqualifiedBecause })),
        // Written out as sets, so a second choice can be read off rather than
        // assembled from the per-pair lists.
        independentPrimerSiteGroups: [...new Set(annotated.map(a => a.primerSiteGroup))].sort()
            .map(g => ({ group: g, pairs: annotated.filter(a => a.primerSiteGroup === g).map(a => a.pair) })),
        aSecondChoiceMustComeFromADifferentGroup:
            "Pairs in one group are the same two primer sites shifted by a base or two. Whatever stops one stops the rest, so a fallback taken from the same group is not a fallback. If every usable pair is in one group, say that there is no independent second choice.",
        note: "An order, not a verdict. Every number behind it is in the pair entries; disagree with it if you can say what you are weighing instead."
    }
}

// What a frameshift at this position may fail to do.
//
// Late in the coding sequence, most of the protein is upstream of the cut and
// survives: a truncated product can keep partial function, and for some genes
// acts as a dominant negative, neither of which an indel spectrum can show.
// Right at the start, translation can restart at a downstream in-frame ATG and
// produce a shortened but working protein. In the middle, neither applies.
function _gcaiCodingCaution(coding) {
    const n = coding.proteinLength
    if (!n || !coding.codon) return null
    const frac = coding.codon / n
    if (frac > 0.5) {
        return `The cut is ${Math.round(frac * 100)}% of the way through the protein, so a frameshift leaves most of it intact upstream. ` +
               "A truncated product can retain partial function, and for some proteins acts as a dominant negative. " +
               "The indel spectrum cannot show either, so confirm the loss at the protein level rather than inferring it from editing efficiency."
    }
    if (frac < 0.1) {
        return `The cut is only ${Math.round(frac * 100)}% into the protein. That is where a frameshift removes the most, but it is also close enough to the start ` +
               "that translation can reinitiate at a downstream in-frame ATG and make a shortened protein that still works. Worth a look at the protein if the phenotype is weaker than expected."
    }
    return null
}

// The parts of the brief that only apply to some exports.
//
// One guide in one gene is not one situation. The cut may be in coding
// sequence, in a UTR, in an intron, or outside every transcript; the library
// may spell the gene differently from the annotation; the guide may have been
// matched only after dropping a leading G it does not share with the genome;
// the template may hold no repeat at all. Each of those changes what a useful
// answer looks like, and a model that has to work them out from the data gets
// some of them wrong. So they are decided here, where the facts are, and only
// the lines that apply are written into the file.
function _gcaiCaseNotes(v, tx, cur, csvWarning) {
    const out = []

    if (!tx) {
        out.push("NO TRANSCRIPT. No RefSeq transcript was found in this window, so nothing here says which exon the cut falls in or what it " +
                 "does to a protein. Do not guess at either. Say the guide's position is confirmed but its consequence for the gene is not " +
                 "described by this file.")
    } else if (!v.coding) {
        out.push("THE CUT IS NOT IN CODING SEQUENCE. The file says where it falls — an intron, a UTR, or outside the transcript — and there " +
                 "is no codon number because there is no codon. Do not make a frameshift argument. A cut in an intron or a UTR usually does " +
                 "not knock a gene out, and if that looks unintended it is the most useful thing you can tell them. Judging the primers is " +
                 "unaffected: the amplicon still has to span the cut.")
    } else {
        out.push("THE CUT IS IN CODING SEQUENCE and the file gives the codon, the protein length and how far through the protein it falls. " +
                 "Use those rather than counting from the exon list, which is easy to get wrong by a codon. A frameshift early in a protein " +
                 "is a more convincing knockout than one near the end, and a cut far enough from the last exon junction should also trigger " +
                 "nonsense-mediated decay.")
    }

    if (cur.site && cur.site.trimmed) {
        out.push("THIS GUIDE CARRIES AN EXTRA G. The spacer as the library lists it begins with a G that the genome does not have at that " +
                 "position, and it matched only once that G was dropped. That is a normal design choice for U6 transcription, not an error, " +
                 "but it means the oligo they order is one base longer than the sequence it targets. Mention it once, plainly, and do not " +
                 "treat it as a mismatch.")
    }

    if (cur.locus && cur.locus.renamed) {
        out.push("THE GENE WAS LOOKED UP UNDER A DIFFERENT SYMBOL from the one the library lists, because the library predates the current " +
                 "name. The file records both. Say which name was used to find it, so they can check it is the gene they meant.")
    }

    if (!(v.repeatRanges || []).length) {
        out.push("NO REPEAT was annotated anywhere in this template, so repeats are simply not a constraint here. If you would otherwise have " +
                 "raised them, say plainly that there are none rather than leaving it unsaid.")
    }

    if (csvWarning) {
        out.push("THE PASTED PRIMER RESULTS MAY NOT MATCH THIS TEMPLATE. The file carries a warning about it. Positions in the primer table " +
                 "are then measured along a different sequence from the one here, so every distance from the cut is unreliable. Lead with " +
                 "that, and tell them to rerun the export with the flank set as it was when they ran Primer-BLAST.")
    }

    if (!out.length) return ""
    return "ABOUT THIS PARTICULAR EXPORT:\n" + out.map(t => "- " + t).join("\n") + "\n\n"
}

// =============================================================================
// The file
// =============================================================================

function GC_aiBuild(pairs, question, csvWarning) {
    const v = _gcView()
    const cur = v.cur
    const tx = cur.tx
    const win = (typeof _gcPrimerWindows === "function") ? _gcPrimerWindows(v) : null
    // Which readout the primers were asked for. The file used to explain
    // itself in ICE and TIDE terms whatever the settings said, so an export
    // made for amplicon NGS carried NGS numbers under Sanger reasoning and
    // read as though the user had got their own settings wrong.
    const presetId = (typeof _gcPbActivePreset === "function") ? _gcPbActivePreset() : "sanger"
    const pbNow = (typeof _gcPbLoad === "function") ? _gcPbLoad() : {}
    const ngsLike = presetId === "ngs" ||
        (presetId === "custom" && Number(pbNow.productMax) > 0 && Number(pbNow.productMax) <= 400)
    const readout = ngsLike ? "ngs" : "sanger"
    const readoutName = presetId === "ngs" ? "amplicon NGS"
        : presetId === "sanger" ? "Sanger sequencing, read by ICE or TIDE"
        : (ngsLike ? "amplicon NGS, with the numbers changed by hand" : "Sanger sequencing, read by ICE or TIDE, with the numbers changed by hand")
    const annotated = pairs && pairs.length ? _gcaiAnnotatePairs(pairs, v, readout) : null
    const strandWord = s => s === "+" ? "plus" : "minus"

    const present = [
        "guide — the sgRNA, the library it came from, and the gene",
        "locus — where it sits in the genome, and in which exon",
        "template — the sequence around it, with the spacer, PAM and cut site located in it",
        "repeatsAndAwkwardSequence — which parts of that template are repetitive, and how much room is left for a primer"
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
            (question
                ? "WHAT THEY ASKED, in their own words: \"" + String(question).replace(/"/g, "'") + "\"\n" +
                  "Answer that. The rest of these instructions describe the usual case and are there to tell you what the file can support; " +
                  "where their question points somewhere else, follow their question.\n\n"
                : "") +
            (readout === "ngs"
                ? "WHAT THEY ARE DOING: they have made a CRISPR knockout with the sgRNA described here and need PCR primers to amplify the " +
                  "edited site for amplicon NGS, where a short product is sequenced many times and the indels are counted from the reads. " +
                  "They chose that readout in the tool, so judge the primers by it and not by ICE or TIDE. The product has to be short " +
                  "enough for the paired reads to overlap and merge, and long enough that a deletion does not reach a primer.\n\n"
                : "WHAT THEY ARE DOING: they have made a CRISPR knockout with the sgRNA described here and need PCR primers to amplify the " +
                  "edited site so they can sequence it and measure the editing by ICE or TIDE. Both methods read a Sanger trace across the " +
                  "cut and infer the spectrum of insertions and deletions.\n\n") +
            "OPEN YOUR REPLY with one short paragraph, no heading: which guide and gene this is, what you are being asked, and — if primer " +
            "candidates came with the file — how many there are to choose between.\n\n" +
            (annotated
                ? "THEN RECOMMEND ONE PAIR and say plainly why, in two or three sentences. The numbers you need are already worked out for each " +
                  "pair: how far each primer sits from the cut, whether the product spans it, and whether it fits the ICE and TIDE guidance. " +
                  "Do not recompute them from the positions; they are relative to the template in this file and easy to get wrong. " +
                  "SAY WHICH PRIMER TO SEQUENCE WITH. One trace is read from one end, the file judges each direction separately, and " +
                  "sequenceThisProductWith names the end to use; a pair that is out of reach one way is often ideal the other way, so a " +
                  "recommendation without that sentence is incomplete. " +
                  "THE SHORTLIST IS ORDERED. shortlist.bestFirst holds the pairs that clear every hard requirement, in order, by the rule " +
                  "written beside it. Recommend the first of them unless you can say what you are weighing instead; picking further down " +
                  "without a reason usually means a comparison was made by eye that the file had already made. " +
                  "ACCOUNT FOR THE ONES YOU LEAVE OUT in a clause each: shortlist.notUsable says why each is out, and a pair with perfect " +
                  "numbers that cannot report the edit is exactly the one the reader will ask about. " +
                  "Name a second choice that uses different primer sites from the first, and say what would make you switch to it: a pair " +
                  "that is the same two sites shifted by a base is not a fallback, and each pair says which others those are. " +
                  "Mention a real risk if there is one, and say plainly when there is not.\n\n"
                : "THEN, since no primer candidates came with the file, do not invent any. Designing primers needs melting temperatures computed " +
                  "under real salt conditions and a genome-wide search for where else they would prime, and neither can be done reliably by " +
                  "reading a sequence. Say so in one sentence, then help with what this file does support: checking the guide is where it should " +
                  "be, what part of the gene it cuts, and — where the file gives a codon — whether the edit is likely to disrupt the protein. " +
                  "Tell them they can rerun the export with the Primer-BLAST CSV pasted in, and you will pick between the pairs.\n\n") +
            "DO NOT REDESIGN THE PRIMER-BLAST REQUEST. The search windows and the product length in this file were set by the tool from the " +
            "readout the user chose, and they are already correct. Primer-BLAST then runs its own genome-wide specificity search and will not " +
            "return a primer that matches in many places, so it excludes repeats by itself: told it may use a whole flank, it comes back using " +
            "only the part that is not repetitive. Telling the user to narrow the windows, avoid a repeat or change a length is redundant work " +
            "you are asking of them for no gain. If something about the locus genuinely limits the design, say what it is and leave the settings " +
            "alone.\n\n" +
            "ABOUT REPEATS: this file already carries the RepeatMasker annotation for the template and says which stretches are free of " +
            "repeat, so do not try to spot repeats by eye from the sequence. Use it to explain the shape of the result, not to change the " +
            "request: if the candidates are crowded into one narrow stretch, or there are fewer of them than expected, the repeat section " +
            "usually says why, and that is worth telling them because it is a property of the locus rather than a mistake.\n\n" +
            _gcaiCaseNotes(v, tx, cur, csvWarning) +
            (annotated
                ? "THE PRIMERS BELONG TO THIS SEQUENCE. Green Listed checked every one of them against the template in this file before " +
                  "writing it, and would not have written it otherwise, so you do not need to verify that yourself. If you ever receive " +
                  "a file of this kind without that confirmation, do not recommend a pair: primer positions mean nothing against the " +
                  "wrong sequence, and every number derived from them would be wrong in a way that looks entirely reasonable.\n\n"
                : "") +
            "DO NOT COMPARE NUMBERS ACROSS PAIRS BY EYE. Every comparison that decides between pairs is already worked out: the distance " +
            "from each primer to the cut, the difference between the two melting temperatures, and which other pairs are the same two " +
            "primer sites shifted by a base. Ten pairs of numbers read off a list is where these answers go wrong.\n\n" +
            "THROUGHOUT: numbers support the answer, they are not the answer. Give the two or three that matter, each with what it means. " +
            "If something important is missing, say what you would need and how they would get it, in terms of what they would click. " +
            "Do not pad the reply to cover every section of the file; say what bears on their situation and stop.",

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
            // Counting codons across an exon list is easy to get wrong by one,
            // and "which codon" is the first thing anyone asks of a knockout,
            // so it is worked out here rather than left to be inferred.
            cutSiteInTheCodingSequence: v.coding ? {
                codingBaseImmediatelyAfterTheCut: v.coding.cdsBase,
                codonNumber: v.coding.codon,
                proteinLength: v.coding.proteinLength,
                fractionOfTheProteinUpstreamOfTheCut: v.coding.proteinLength
                    ? Number((v.coding.codon / v.coding.proteinLength).toFixed(3)) : null,
                note: "Numbered along " + (tx ? tx.name : "the transcript") +
                      ". A frameshift here truncates everything downstream of this codon.",
                // Where in the protein the cut falls decides whether "frameshift"
                // and "knockout" are the same thing, and the two ends of the
                // coding sequence fail in opposite ways. Worked out here, because
                // it is a consequence of a number already in this file and only
                // one reader in six raised it unprompted.
                caution: _gcaiCodingCaution(v.coding)
            } : null,
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

        repeatsAndAwkwardSequence: _gcaiRepeatSection(v),

        designConstraints: win ? {
            readoutTheseWereDesignedFor: readoutName,
            theseAreAlreadySet: "Green Listed derived these from the readout the user chose and filled them into Primer-BLAST. " +
                "They are recorded so you can see what was asked, not so they can be revised. Primer-BLAST applies its own " +
                "specificity search on top of them.",
            whatPrimerBlastWasAskedFor: {
                forwardPrimerWithin: [win.fwdStart, win.fwdEnd],
                reversePrimerWithin: [win.revStart, win.revEnd],
                minimumClearanceFromTheCutSite: win.minDist,
                minimumProductLength: pbNow.productMin != null && pbNow.productMin !== "" ? pbNow.productMin : null,
                maximumProductLength: pbNow.productMax != null && pbNow.productMax !== "" ? pbNow.productMax : null
            },
            why: readout === "ngs"
                ? "Neither primer may sit near the cut, or a deletion can land under a primer, that allele then fails to amplify, and the " +
                  "result is biased toward looking unedited. The ceiling on the product is set by the read length: on a 2x150 paired-end " +
                  "run the two reads have to overlap before they can be merged, which caps the amplicon near 280 bp. Shorter is not " +
                  "better, so the product should be the longest the reads can still merge across. CRISPResso2 ignores the outermost 15 bp " +
                  "of an amplicon, so the cut must sit well inside it."
                : "Neither primer may sit near the cut, or an indel can land under a primer and the Sanger trace has no clean sequence " +
                  "before the edit. ICE asks for at least 150 bp of clearance and a 400-800 bp product; TIDE prefers the cut about 200 bp " +
                  "into the read, needs at least 100 bp before it, and a 500-1500 bp product."
        } : null,

        primerCandidates: annotated,
        shortlist: annotated ? _gcaiShortlist(annotated, readout !== "ngs") : null,
        // Stated in the file, not only enforced in the dialog. A reader has no
        // other way to tell a pair that belongs to this guide from one that
        // belongs to another, because both look equally reasonable.
        primerCandidatesBelongToThisSequence: annotated
            ? "Checked. Every primer below was found in the sequence in this file, at the position given: the forward primer reading " +
              "along it and the reverse primer as its reverse complement. Primer-BLAST positions are meaningless against any other " +
              "sequence, and each guide has its own, so this is what rules out results pasted from a different guide or a different " +
              "flank. Green Listed will not write this file if the check fails."
            : null,

        primerCandidatesSource: annotated
            ? "NCBI Primer-BLAST, run against the " + v.g.organism + " reference genome with its specificity check on. Positions are " +
              "template coordinates; the cut-relative figures and the repeat check were added by Green Listed. Primer-BLAST returns only " +
              "pairs it judged specific under the settings used, but the downloaded table carries no off-target hit list, so this file " +
              "cannot show the evidence for that judgement and you should not claim to have seen it."
            : null,
        primerCandidatesWarning: csvWarning || null,

        howToJudgeAPrimerPair: readout === "ngs" ? [
            "The product must span the cut site. A pair that does not cannot report the edit at all.",
            "The product has to be short enough for the paired reads to overlap and merge. About 280 bp is the ceiling on a 2x150 run, about 450 bp on a 2x250 run.",
            "Within that ceiling, longer is better, not worse. A deletion that reaches a primer site destroys the amplicon, that allele vanishes from the data rather than being counted as edited, and the result is biased toward looking unedited.",
            "Neither primer should sit within about 50 bp of the cut, and CRISPResso2 ignores the outermost 15 bp of the amplicon, so the cut has to sit well inside the product.",
            "Neither primer may lie inside an annotated repeat. This file says which ones do.",
            "Specificity matters more than a perfect melting temperature. A pair that also primes elsewhere gives a mixture of products and the counts become meaningless.",
            "Between pairs that all satisfy the above, prefer closely matched melting temperatures and low self- and cross-complementarity."
        ] : [
            "The product must span the cut site. A pair that does not cannot report the edit at all.",
            "Neither primer should sit within about 150 bp of the cut. An indel under a primer stops it annealing, and the alleles carrying the biggest deletions are then the ones you fail to amplify, which biases the result toward looking unedited.",
            "The first 20-50 bases of a Sanger read are unreliable, so the distance from the sequencing primer to the cut needs to be comfortably more than that. Around 150-250 bp is the usual target.",
            "There must be enough clean sequence after the cut as well, since ICE and TIDE both infer the indel spectrum from the mixed trace downstream of it. Longer helps when deletions are large.",
            "Neither primer may lie inside an annotated repeat. This file says which ones do.",
            "A pair is read from ONE end, so say which. The file judges each direction separately and names one in sequenceThisProductWith; a pair can be unusable one way and ideal the other, and a recommendation that does not say which primer to sequence with is incomplete.",
            "A Sanger read is not reliable much past 700 bases, so a cut further than that from the sequencing primer cannot be read from that end however good the pair is.",
            "Specificity matters more than a perfect melting temperature. A pair that also primes elsewhere in the genome gives a mixed trace that looks like editing.",
            "Between pairs that all satisfy the above, prefer closely matched melting temperatures and low self- and cross-complementarity. The difference between the two temperatures is given for each pair; do not work it out by eye across the pairs.",
            "fitsGuidance is per direction. Do not report that a pair fails unless it fails in both directions, and do not treat a false in one direction as a reason to reject a pair whose other direction is fine.",
            "usable and disqualifiedBecause on each pair are the hard pass or fail; notes are things to know about a pair that can still be used. Do not write that there are no risks in the same answer as a note or a disqualification.",
            "A second choice is only worth naming if it uses different primer sites. Primer-BLAST offers the same site again shifted by a base or two, and each pair says which others are the same two sites as itself. A fallback that shares both of them fails for every reason the first one does."
        ],

        notIncluded: {
            thisFileDoesNotKnow: [
                "Whether a primer sits on a common SNP in the cell line or strain being used, which can cause allele dropout. Repeats and long homopolymers ARE in this file, under repeatsAndAwkwardSequence; SNPs are not.",
                "Whether the cell line carries a mutation under the spacer or the PAM, which would stop the guide cutting that allele.",
                "Where else in the genome a primer would prime. Primer-BLAST checked this and returned only pairs it passed, but the evidence is not in the downloaded table.",
                "The polymerase, cycling conditions or sequencing provider, so annealing temperature is not tuned to a protocol.",
                "Anything about the actual edited sample, such as its clonality or the editing efficiency."
            ],
            howToAddPrimerCandidates:
                "In Green Listed, open the guide's Context panel, press Open in Primer-BLAST, run it, then on the results page use " +
                "Download primer pairs > CSV. Press Export for AI again and choose or paste that file before exporting.",
            // People do hand an assistant both files instead, which looks like
            // the same thing and is not: the tool checks every primer against
            // this template before writing the file, and nothing checks it in
            // the other route. Two files in one folder can be a different
            // guide, or the same guide at a different flank length, and every
            // distance computed from the wrong pairing looks entirely
            // reasonable.
            ifYouWereAlsoGivenARawPrimerBlastFile:
                "Its positions are relative to whatever sequence was submitted to Primer-BLAST, which may not be the template in this " +
                "file. Before using any of them, check that each primer sequence actually occurs in the template here — the forward " +
                "primer reading along it, the reverse primer as the reverse complement — and say which ones do not. Distances to the " +
                "cut, product lengths and read directions are all wrong, plausibly wrong, if the two do not belong together. Exporting " +
                "again with the results chosen in the dialog does that check for you and works out the distances as well."
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
        `spacer, PAM and cut site marked, and the primer pairs Primer-BLAST found, each re-expressed as its distance from the cut. ` +
        `Attach it to an assistant and ask which pair to order.</p>` +

        `<label class="gcaiLabel" for="gcaiCsv">Primer-BLAST results <span class="gcaiNeed">paste these in</span></label>` +
        `<p class="gcaiHint"><b>Do this first.</b> Press <i>Open in Primer-BLAST</i>, run it, and on the results page either select the ` +
        `primer table and copy it or use any of the links under <i>Download primer pairs</i> &mdash; <b>Text</b>, <b>CSV</b> and ` +
        `<b>Tabular</b> all work. Paste it here, or drop the file on this box.</p>` +
        `<p class="gcaiHint"><label class="gcaiPick"><input type="file" id="gcaiFile" accept=".csv,.tsv,.txt,text/plain,text/csv" ` +
        `onchange="GC_aiPickFile(this)">Choose the downloaded file&hellip;</label> or paste it in the box below.</p>` +
        `<p class="gcaiHint">Without it there is nothing to choose between and no assistant can fill the gap: picking primers needs ` +
        `melting temperatures computed under real salt conditions and a genome-wide search for where else each one would prime, and ` +
        `neither can be done by reading a sequence. The file is still worth exporting without them &mdash; it will tell you where the ` +
        `guide cuts and what that does to the protein &mdash; but it will not name a pair to order.</p>` +
        `<textarea id="gcaiCsv" class="gcaiArea" rows="5" placeholder="Primer pair #,Forward primer Sequence (5'->3'),..." ` +
        `oninput="GC_aiCheckCsv()"></textarea>` +
        `<p class="gcaiStatus" id="gcaiCsvStatus"></p>` +

        `<label class="gcaiLabel" for="gcaiQ">What do you want to ask? <span class="gcaiOpt">(optional)</span></label>` +
        `<textarea id="gcaiQ" class="gcaiArea" rows="2" placeholder="Which primer pair should I order, and why?">${_escapeHtml(q)}</textarea>` +

        `<div class="gcxRow gcxCenter"><button class="validate-btn" id="gcaiRunBtn" onclick="GC_aiRun()">Export .json</button>` +
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
    // Say what an empty box means before the export button is pressed, not
    // after the file has been written and attached.
    GC_aiCheckCsv()
}

// The downloaded Primer-BLAST file, chosen rather than pasted. Dropping it on
// the box has always worked, but a line of small print saying so is not a
// button, and the file is sitting in the Downloads folder anyway.
function GC_aiPickFile(input) {
    const f = input && input.files && input.files[0]
    if (!f) return
    const area = document.getElementById("gcaiCsv")
    const r = new FileReader()
    r.onload = () => {
        area.value = String(r.result || "")
        GC_aiCheckCsv()
    }
    r.onerror = () => {
        document.getElementById("gcaiCsvStatus").textContent = "That file could not be read. Open it and paste the contents instead."
    }
    r.readAsText(f)
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
    if (!txt) {
        out.textContent = "No primer pairs yet. Export now and the file describes the locus only."
        out.className = "gcaiStatus gcaiWarn"
        return null
    }
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
        out.innerHTML = `Read ${pairs.length} primer ${pairs.length === 1 ? "pair" : "pairs"}, but they reach position ${maxPos} of a ${v.n} bp sequence, so they were not run ` +
            `on this template. That needs a flank of at least ${atLeast} bp — set the flank to what you used, press Show, then export.`
        out.className = "gcaiStatus gcaiBad"
        return null
    }
    // Positions inside the template are not enough: a position can fall inside
    // a sequence the primers have nothing to do with. Check the bases.
    const check = _gcaiVerifyPairs(pairs, v)
    if (!check.ok) {
        const b = check.bad[0]
        out.innerHTML = `These primers are not from this sequence. Pair ${b.pair}'s ${b.which} primer should be ` +
            `<b>${_escapeHtml(b.expected)}</b> at position ${b.at[0]}, but this template has ` +
            `<b>${_escapeHtml(b.found || "nothing")}</b> there` +
            (check.bad.length > 1 ? `, and ${check.bad.length - 1} other ${check.bad.length === 2 ? "primer is" : "primers are"} wrong too` : "") +
            `. Primer-BLAST results belong to the one sequence they were run on, and every guide has its own. ` +
            `Open this guide's own panel, press <i>Open in Primer-BLAST</i>, and use those results.`
        out.className = "gcaiStatus gcaiBad"
        return null
    }
    out.textContent = `Read ${pairs.length} primer ${pairs.length === 1 ? "pair" : "pairs"}, and every primer is where it says it is in this ${v.n} bp template.`
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
        // The same check the status line runs, enforced here too: the button
        // must not write a file the box has already said is wrong. A file that
        // pairs one guide's primers with another guide's cut site reads as
        // entirely reasonable to whoever opens it, because every number in it
        // is internally consistent and all of them are about the wrong thing.
        if (!_gcaiVerifyPairs(pairs, v).ok) { GC_aiCheckCsv(); return }
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
