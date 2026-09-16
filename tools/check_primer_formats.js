#!/usr/bin/env node
//
// Primer-BLAST offers the same result in four shapes, and the exporter has to
// read all of them. Two of the four have already been missed once each:
//
//   Text      one labelled field per line, "Forward primer Start:   38"
//   Tabular   tab separated, header words joined by underscores
//   CSV       comma separated, header words separated by spaces
//   copied    the results table selected on the page, a row per primer
//
// Same run, four spellings. This parses one sample of each and checks they
// come out identical, so a change to the parser cannot quietly drop a format.
//
//     node tools/check_primer_formats.js

const fs = require("fs")
const path = require("path")

const src = fs.readFileSync(path.join(__dirname, "..", "gcai.js"), "utf8")
const { GC_aiParsePrimerCsv } = (new Function(src + "; return { GC_aiParsePrimerCsv };"))()

const TEXT = `Input PCR template:     lcl|Query_1 
Range:                  1 - 1020

Primer pair 1
Forward primer Sequence (5'->3'):           CCGTCCATTGGCCTCACATA
Forward primer Template strand:             Plus
Forward primer Length:                      20
Forward primer Start:                       38
Forward primer Stop:                        57
Forward primer Tm:                          59.82
Forward primer GC%:                         55.00
Forward primer Self complementarity:        5.00
Forward primer Self 3' complementarity:     2.00
Reverse primer Sequence (5'->3'):           GGGGGATGAACTCTCCAACC
Reverse primer Template strand:             Minus
Reverse primer Length:                      20
Reverse primer Start:                       704
Reverse primer Stop:                        685
Reverse primer Tm:                          59.74
Reverse primer GC%:                         60.00
Reverse primer Self complementarity:        4.00
Reverse primer Self 3' complementarity:     3.00
Product length:                             667
`

const cols = [
    "Primer_pair_#", "Forward_primer_Sequence_(5'->3')", "Forward_primer_Template_strand",
    "Forward_primer_Length", "Forward_primer_Start", "Forward_primer_Stop", "Forward_primer_Tm",
    "Forward_primer_GC%", "Forward_primer_Self_complementarity", "Forward_primer_Self_3'_complementarity",
    "Reverse_primer_Sequence_(5'->3')", "Reverse_primer_Template_strand", "Reverse_primer_Length",
    "Reverse_primer_Start", "Reverse_primer_Stop", "Reverse_primer_Tm", "Reverse_primer_GC%",
    "Reverse_primer_Self_complementarity", "Reverse_primer_Self_3'_complementarity", "Product_length"
]
const row = ["1", "CCGTCCATTGGCCTCACATA", "Plus", "20", "38", "57", "59.82", "55.00", "5.00", "2.00",
             "GGGGGATGAACTCTCCAACC", "Minus", "20", "704", "685", "59.74", "60.00", "4.00", "3.00", "667"]

const TABULAR = cols.join("\t") + "\n" + row.join("\t") + "\t\n"
const CSV = cols.map(c => c.replace(/_/g, " ")).join(",") + ",\n" + row.join(",") + ",\n"
const COPIED = [
    "Primer pair 1",
    "\tSequence (5'->3')\tTemplate strand\tLength\tStart\tStop\tTm\tGC%\tSelf complementarity\tSelf 3' complementarity",
    "Forward primer\tCCGTCCATTGGCCTCACATA\tPlus\t20\t38\t57\t59.82\t55.00\t5.00\t2.00",
    "Reverse primer\tGGGGGATGAACTCTCCAACC\tMinus\t20\t704\t685\t59.74\t60.00\t4.00\t3.00",
    "Product length\t667"
].join("\n")

const shapes = { Text: TEXT, Tabular: TABULAR, CSV: CSV, copied: COPIED }
const got = {}
let failed = 0

for (const name of Object.keys(shapes)) {
    const r = GC_aiParsePrimerCsv(shapes[name])
    if (r.error) { console.log(`FAIL ${name}: ${r.error}`); failed++; continue }
    if (r.pairs.length !== 1) { console.log(`FAIL ${name}: read ${r.pairs.length} pairs, expected 1`); failed++; continue }
    got[name] = r.pairs[0]
    console.log(`ok   ${name}`)
}

// Every shape has to agree, field for field, with the Text one.
const ref = got.Text
if (ref) {
    for (const name of Object.keys(got)) {
        if (name === "Text") continue
        const a = JSON.stringify(ref), b = JSON.stringify(got[name])
        if (a !== b) {
            console.log(`FAIL ${name} disagrees with Text:\n  Text: ${a}\n  ${name}: ${b}`)
            failed++
        }
    }
    // And the numbers have to be the ones in the file, not merely consistent.
    const want = { fSeq: "CCGTCCATTGGCCTCACATA", fStart: 38, fEnd: 57, rFive: 704, rThree: 685, product: 667 }
    if (ref.forward.sequence !== want.fSeq || ref.forward.start !== want.fStart ||
        ref.forward.end !== want.fEnd || ref.reverse.fivePrimeEnd !== want.rFive ||
        ref.reverse.threePrimeEnd !== want.rThree || ref.productLength !== want.product) {
        console.log("FAIL Text parsed the wrong values: " + JSON.stringify(ref))
        failed++
    }
    // Primer-BLAST reports the reverse primer's 5' end as Start, so it is the
    // larger of the two, and the product spans from one outer end to the other.
    if (ref.reverse.fivePrimeEnd <= ref.reverse.threePrimeEnd) { console.log("FAIL reverse primer ends are the wrong way round"); failed++ }
    if (ref.reverse.fivePrimeEnd - ref.forward.start + 1 !== ref.productLength) { console.log("FAIL product length does not match the primer positions"); failed++ }
} else { failed++ }

// ---------------------------------------------------------------------------
// And the check that matters more than the parsing: do these primers come from
// the sequence they are about to be attached to?
//
// Two exports for two different guides in the same gene once had the same
// Primer-BLAST results pasted into both, and both files were written without
// complaint. Positions inside the template were the only test, and a position
// can fall inside a sequence the primers have nothing to do with.
const { _gcaiVerifyPairs } = (new Function(src + "; return { _gcaiVerifyPairs };"))()

const rc = s => s.split("").reverse().map(c => ({ A: "T", T: "A", C: "G", G: "C" }[c] || "N")).join("")
// A template whose bases are known, with the sample pair planted in it.
const template = (() => {
    const filler = c => c.repeat(1)
    let t = ""
    const rnd = ["A", "C", "G", "T"]
    for (let i = 0; i < 1020; i++) t += rnd[(i * 7 + (i >> 3)) % 4]
    const f = "CCGTCCATTGGCCTCACATA", r = rc("GGGGGATGAACTCTCCAACC")
    t = t.slice(0, 37) + f + t.slice(37 + f.length)
    t = t.slice(0, 684) + r + t.slice(684 + r.length)
    return t
})()
const v = { seq: template, n: template.length }
const samplePairs = GC_aiParsePrimerCsv(TEXT).pairs

const own = _gcaiVerifyPairs(samplePairs, v)
if (!own.ok) { console.log("FAIL a pair that IS in the template was rejected: " + JSON.stringify(own.bad[0])); failed++ }
else console.log("ok   primers from this template are accepted")

// The same pairs against a different sequence, which is the real-world fault.
const other = { seq: template.split("").reverse().join(""), n: template.length }
const foreign = _gcaiVerifyPairs(samplePairs, other)
if (foreign.ok) { console.log("FAIL primers from a different template were accepted"); failed++ }
else console.log("ok   primers from a different template are rejected")

// A reverse primer given the right coordinates but the wrong strand must fail:
// this is the one that would otherwise look correct at a glance.
const flipped = JSON.parse(JSON.stringify(samplePairs))
flipped[0].reverse.sequence = rc(flipped[0].reverse.sequence)
if (_gcaiVerifyPairs(flipped, v).ok) { console.log("FAIL a reverse primer on the wrong strand was accepted"); failed++ }
else console.log("ok   a reverse primer on the wrong strand is rejected")

console.log(failed ? `\n${failed} failure(s)` : "\nAll four formats read identically, and primers are checked against the template.")
process.exit(failed ? 1 : 0)
