//
// Green Listed v2.0
//
// Image export for the genomic-context panel.
//
// The panel is a figure people want in a lab book, a slide or a paper, so it
// exports the same way Correlate's charts do: PNG, SVG, PDF, TIFF and a
// single-slide PowerPoint, with the width and resolution asked for up front.
//
// Everything starts from a hand-built SVG rather than a screenshot of the
// page. The sequence is a monospace grid, so its geometry is known exactly —
// that gives crisp text at any size, a vector PDF-quality SVG for figure
// editors, and a file that does not carry the app's chrome into the figure.
// The raster formats are that same SVG drawn onto a canvas at the requested
// resolution, so every format shows the identical picture.
//
// The TIFF, PDF, PPTX and PNG-density writers are ported from Correlate so
// the two apps produce interchangeable files. JSZip is already loaded for the
// workbook export, so PowerPoint needs no new dependency.
//

const _GCX_FORMATS = [
    { id: "png", label: "PNG", note: "Raster image at the resolution you choose" },
    { id: "svg", label: "SVG", note: "Vector — scales without blurring, editable in Illustrator or Inkscape" },
    { id: "pdf", label: "PDF", note: "Single page at the exact width, for printing or a figure panel" },
    { id: "tiff", label: "TIFF", note: "Journal-ready RGB at the chosen resolution" },
    { id: "pptx", label: "PowerPoint", note: "One 16:9 slide with the figure placed on it" }
]

const _GCX_DPIS = [150, 300, 600]
const _GCX_STORE = "greenlisted.contextExport"

// Layout constants for the drawn figure. The base advance is what makes the
// grid line up: every glyph in a monospace face occupies the same width, so
// a base at column i sits at x0 + i * ADVANCE and the coloured panel behind
// it can be drawn as a plain rectangle.
const _GCX = {
    fontPx: 11,
    // Placeholder. The real advance is measured from the font actually
    // resolved in this browser (see _gcxAdvance) — a guessed constant wider
    // than the glyphs leaves a ragged gap after every narrow letter, because
    // each character is positioned individually.
    advance: 6.62,
    lineH: 17,
    perLine: 60,
    groupGap: 0.55,       // extra advances inserted every 10 bases
    padX: 16,
    padY: 14,
    numW: 40,
    face: "'DejaVu Sans Mono','Liberation Mono',Menlo,Consolas,'Courier New',monospace",
    sans: "Helvetica,Arial,sans-serif",
    colors: {
        spacer: "#bbf7d0",
        pam: "#fecaca",
        exonC: "#dbeafe",
        exonU: "#ede9fe",
        cut: "#dc2626",
        text: "#111827",
        muted: "#6b7280",
        rule: "#d1d5db",
        head: "#065f46"
    }
}

// The width of one character in the export face. Every glyph in a monospace
// font has the same advance, so one measurement fixes the whole grid: the
// per-character x positions, the coloured panels behind them, and the page
// width. Measured once and cached; falls back to a ratio of the font size if
// the canvas is unavailable.
var _gcxAdvanceCache = null
function _gcxAdvance() {
    if (_gcxAdvanceCache) return _gcxAdvanceCache
    try {
        const ctx = document.createElement("canvas").getContext("2d")
        ctx.font = `${_GCX.fontPx}px ${_GCX.face}`
        // Averaged over a run rather than taken from one glyph, so a face that
        // is not perfectly monospaced still lands on a sensible pitch.
        const w = ctx.measureText("acgtACGT".repeat(8)).width / 64
        if (w > 1 && w < _GCX.fontPx * 1.5) { _gcxAdvanceCache = w; return w }
    } catch (e) { /* fall through */ }
    _gcxAdvanceCache = _GCX.fontPx * 0.6
    return _gcxAdvanceCache
}

// Font and fill go in a style attribute rather than as presentation
// attributes. The app's stylesheet opens with a `*` reset that sets a font on
// every element, SVG text included, and a stylesheet rule beats a
// presentation attribute — so `font-family="...monospace"` was being
// overridden and the sequence rendered in the page's proportional face, with
// every narrow glyph leaving a gap in the grid. An inline style wins.
function _gcxFont(family, size, extra) {
    return `font-family:${family};font-size:${size}px;${extra || ""}`
}

function _gcxEsc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

// Where base `i` of a line sits, in advances from the start of the row. The
// grouping gap every ten bases is part of the coordinate, so the coloured
// panels and the glyphs cannot drift apart.
function _gcxCol(i) {
    return i + Math.floor(i / 10) * _GCX.groupGap
}

// =============================================================================
// The figure
// =============================================================================

// A vector drawing of what the panel shows: the identifying lines, the
// annotated sequence, and a legend. `v` is the view object from gcontext.js.
function GC_buildSvg(v) {
    const cur = v.cur
    const tx = cur.tx
    const C = _GCX.colors
    const perLine = _GCX.perLine
    _GCX.advance = _gcxAdvance()
    const rowAdvances = _gcxCol(perLine - 1) + 1
    const seqW = rowAdvances * _GCX.advance
    const x0 = _GCX.padX + _GCX.numW
    const width = Math.ceil(x0 + seqW + _GCX.padX)

    const strandWord = s => s === "+" ? "plus" : "minus"
    const head = [
        `${cur.guideId}  —  5'-${cur.site.spacer}-3'`,
        `${v.g.assembly}  ${v.region}  (${strandWord(v.viewStrand)} strand shown, ${v.n.toLocaleString("en-US")} bp)`,
        tx ? `${tx.gene}  ${tx.name}  (${tx.track}, ${strandWord(tx.strand)} strand, ${tx.exons.length} exons)`
           : `No RefSeq transcript overlaps this window`,
        [`Spacer ${v.spacerR.start}–${v.spacerR.end}`,
         `PAM ${v.pamR.start}–${v.pamR.end}`,
         `cut between ${v.cutAfter} and ${v.cutAfter + 1}`,
         _gcExonSummary(v.bases, tx)].join("  ·  ")
    ]

    const headH = _GCX.padY + head.length * 15 + 10
    const nLines = Math.ceil(v.n / perLine)
    const seqH = nLines * _GCX.lineH
    const legendH = 34
    const footH = 26
    const height = Math.ceil(headH + seqH + legendH + footH + _GCX.padY)

    var s = `<?xml version="1.0" encoding="UTF-8"?>\n`
    s += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
    s += `<rect width="${width}" height="${height}" fill="#ffffff"/>\n`

    // ---- header lines
    var y = _GCX.padY + 11
    head.forEach((line, i) => {
        const bold = i === 0
        s += `<text x="${_GCX.padX}" y="${y}" style="${_gcxFont(_GCX.sans, bold ? 12 : 10.5, `fill:${bold ? C.head : C.muted};${bold ? "font-weight:bold;" : ""}`)}">${_gcxEsc(line)}</text>\n`
        y += 15
    })
    s += `<line x1="${_GCX.padX}" y1="${headH - 6}" x2="${width - _GCX.padX}" y2="${headH - 6}" stroke="${C.rule}" stroke-width="1"/>\n`

    // ---- sequence
    // Feature panels are drawn first as runs of identical colour, so a 500 bp
    // exon is one rectangle rather than 500, then the glyphs go on top.
    const bg = b => b.spacer ? C.spacer : b.pam ? C.pam : b.exon ? (b.coding ? C.exonC : C.exonU) : null
    var seqSvg = "", textSvg = "", cutSvg = ""

    for (var ln = 0; ln < nLines; ln++) {
        const start = ln * perLine
        const end = Math.min(v.n, start + perLine)
        const rowY = headH + ln * _GCX.lineH
        const baseY = rowY + 12

        // line number, right-aligned against the sequence
        seqSvg += `<text x="${x0 - 8}" y="${baseY}" text-anchor="end" ` +
                  `style="${_gcxFont(_GCX.face, _GCX.fontPx - 1, `fill:${C.muted};`)}">${start + 1}</text>\n`

        var runStart = -1, runColor = null
        for (var i = start; i <= end; i++) {
            const b = i < end ? v.bases[i] : null
            const col = b ? bg(b) : null
            if (col !== runColor) {
                if (runColor) {
                    const rx = x0 + _gcxCol(runStart - start) * _GCX.advance - 0.4
                    const rw = (_gcxCol(i - 1 - start) - _gcxCol(runStart - start) + 1) * _GCX.advance + 0.8
                    seqSvg += `<rect x="${rx.toFixed(2)}" y="${(rowY + 1.5).toFixed(2)}" width="${rw.toFixed(2)}" height="${_GCX.lineH - 3}" fill="${runColor}"/>\n`
                }
                runStart = i; runColor = col
            }
            if (!b) break
        }

        // glyphs, one <text> per line with per-character positioning so the
        // grouping gaps survive in every renderer
        var chars = "", xs = []
        for (var i = start; i < end; i++) {
            const b = v.bases[i]
            chars += (b.spacer || b.pam) ? b.base.toUpperCase() : b.base.toLowerCase()
            xs.push((x0 + _gcxCol(i - start) * _GCX.advance).toFixed(2))
            if (b.cutAfter) {
                const cx = x0 + (_gcxCol(i - start) + 1) * _GCX.advance - _GCX.advance * 0.5 + _GCX.advance * 0.5
                cutSvg += `<line x1="${cx.toFixed(2)}" y1="${(rowY + 1).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(rowY + _GCX.lineH - 1).toFixed(2)}" stroke="${C.cut}" stroke-width="1.6"/>\n`
            }
        }
        textSvg += `<text x="${xs.join(" ")}" y="${baseY}" xml:space="preserve" ` +
                   `style="${_gcxFont(_GCX.face, _GCX.fontPx, `fill:${C.text};`)}">${_gcxEsc(chars)}</text>\n`
    }
    s += seqSvg + textSvg + cutSvg

    // ---- legend
    const legY = headH + seqH + 16
    const items = [
        ["spacer", C.spacer], ["PAM", C.pam],
        ["exon (coding)", C.exonC], ["exon (UTR)", C.exonU],
        ["intron / intergenic", "#ffffff"]
    ]
    var lx = _GCX.padX
    for (const [label, col] of items) {
        s += `<rect x="${lx}" y="${legY - 8}" width="10" height="10" fill="${col}" stroke="${C.rule}" stroke-width="0.8"/>\n`
        s += `<text x="${lx + 14}" y="${legY}" style="${_gcxFont(_GCX.sans, 9.5, `fill:${C.muted};`)}">${_gcxEsc(label)}</text>\n`
        lx += 14 + label.length * 5.1 + 16
    }
    s += `<line x1="${lx + 2}" y1="${legY - 8}" x2="${lx + 2}" y2="${legY + 2}" stroke="${C.cut}" stroke-width="1.6"/>\n`
    s += `<text x="${lx + 8}" y="${legY}" style="${_gcxFont(_GCX.sans, 9.5, `fill:${C.muted};`)}">cut site</text>\n`

    // ---- provenance, so a figure lifted out of context still says where it came from
    s += `<text x="${_GCX.padX}" y="${height - _GCX.padY}" style="${_gcxFont(_GCX.sans, 9, `fill:${C.muted};`)}">` +
         `${_gcxEsc(`Green Listed (greenlisted.cmm.se). Sequence and annotation from the UCSC Genome Browser API (${v.g.assembly}). Cut site assumes SpCas9, 3 nt from the PAM.`)}</text>\n`

    s += `</svg>\n`
    return { svg: s, width: width, height: height }
}

// =============================================================================
// Raster
// =============================================================================

// The SVG drawn onto a canvas at `scale`. Routed through a blob URL rather
// than a data: URI because Safari refuses to decode large data-URI SVGs.
function _gcxRasterise(svgStr, width, height, scale) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
            try {
                const c = document.createElement("canvas")
                c.width = Math.max(1, Math.round(width * scale))
                c.height = Math.max(1, Math.round(height * scale))
                const ctx = c.getContext("2d")
                ctx.fillStyle = "#ffffff"
                ctx.fillRect(0, 0, c.width, c.height)
                ctx.drawImage(img, 0, 0, c.width, c.height)
                URL.revokeObjectURL(url)
                resolve(c)
            } catch (e) { URL.revokeObjectURL(url); reject(e) }
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not render the figure")) }
        img.src = url
    })
}

// Baseline uncompressed RGB TIFF with the export density in the resolution
// tags. Ported from Correlate so both apps emit the same kind of file.
function _gcxCanvasToTiff(canvas, dpi) {
    const w = canvas.width, h = canvas.height
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data
    const strip = new Uint8Array(w * h * 3)
    for (var i = 0, j = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255
        strip[j++] = Math.round(data[i] * a + 255 * (1 - a))
        strip[j++] = Math.round(data[i + 1] * a + 255 * (1 - a))
        strip[j++] = Math.round(data[i + 2] * a + 255 * (1 - a))
    }
    const nTags = 12
    const ifdSize = 2 + nTags * 12 + 4
    const extra = 8 + ifdSize
    const bpsOff = extra, xresOff = extra + 6, yresOff = extra + 14, stripOff = extra + 22
    const buf = new ArrayBuffer(stripOff + strip.length)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true)
    var p = 8
    dv.setUint16(p, nTags, true); p += 2
    const tag = (id, type, count, value) => {
        dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true)
        dv.setUint32(p + 4, count, true); dv.setUint32(p + 8, value, true); p += 12
    }
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 3, bpsOff); tag(259, 3, 1, 1)
    tag(262, 3, 1, 2); tag(273, 4, 1, stripOff); tag(277, 3, 1, 3); tag(278, 4, 1, h)
    tag(279, 4, 1, strip.length); tag(282, 5, 1, xresOff); tag(283, 5, 1, yresOff); tag(296, 3, 1, 2)
    dv.setUint32(p, 0, true)
    dv.setUint16(bpsOff, 8, true); dv.setUint16(bpsOff + 2, 8, true); dv.setUint16(bpsOff + 4, 8, true)
    const d = Math.round(dpi) || 300
    dv.setUint32(xresOff, d, true); dv.setUint32(xresOff + 4, 1, true)
    dv.setUint32(yresOff, d, true); dv.setUint32(yresOff + 4, 1, true)
    new Uint8Array(buf).set(strip, stripOff)
    return buf
}

// Single-page PDF holding the figure as a JPEG, page sized in points so it
// imports at the requested width. Ported from Correlate.
function _gcxCanvasToPdf(canvas, widthCm, heightCm) {
    const tmp = document.createElement("canvas")
    tmp.width = canvas.width; tmp.height = canvas.height
    const tctx = tmp.getContext("2d")
    tctx.fillStyle = "#fff"; tctx.fillRect(0, 0, tmp.width, tmp.height)
    tctx.drawImage(canvas, 0, 0)
    const b64 = tmp.toDataURL("image/jpeg", 0.95).split(",")[1]
    const bin = atob(b64)
    const jpeg = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
    const ptW = (widthCm || 10) / 2.54 * 72, ptH = (heightCm || 10) / 2.54 * 72
    const enc = new TextEncoder()
    const parts = [], offsets = []
    var len = 0
    const push = s => { const b = (typeof s === "string") ? enc.encode(s) : s; parts.push(b); len += b.length }
    push("%PDF-1.4\n")
    offsets.push(len); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    offsets.push(len); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    offsets.push(len); push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`)
    offsets.push(len); push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    push(jpeg); push("\nendstream\nendobj\n")
    const content = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q\n`
    offsets.push(len); push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
    const xrefStart = len
    var xref = "xref\n0 6\n0000000000 65535 f \n"
    for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n"
    push(xref)
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)
    const out = new Uint8Array(len)
    var o = 0
    for (const pt of parts) { out.set(pt, o); o += pt.length }
    return out.buffer
}

// Write a pHYs chunk so the PNG carries its intended print density.
function _gcxSetPngDpi(arrayBuffer, dpi) {
    const ppm = Math.round(dpi * 39.3701)
    const src = new Uint8Array(arrayBuffer)
    const T = (() => {
        const t = new Uint32Array(256)
        for (var n = 0; n < 256; n++) {
            var c = n
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
            t[n] = c >>> 0
        }
        return t
    })()
    const crc32 = bytes => {
        var c = 0xffffffff
        for (var i = 0; i < bytes.length; i++) c = T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
        return (c ^ 0xffffffff) >>> 0
    }
    const physData = new Uint8Array(9)
    const pdv = new DataView(physData.buffer)
    pdv.setUint32(0, ppm); pdv.setUint32(4, ppm); physData[8] = 1
    const typeAndData = new Uint8Array(13)
    typeAndData.set([0x70, 0x48, 0x59, 0x73]); typeAndData.set(physData, 4)
    const phys = new Uint8Array(21)
    new DataView(phys.buffer).setUint32(0, 9)
    phys.set(typeAndData, 4)
    new DataView(phys.buffer).setUint32(17, crc32(typeAndData))
    var pos = 8
    const chunks = []
    while (pos < src.length) {
        const len = new DataView(src.buffer, src.byteOffset + pos, 4).getUint32(0)
        const type = String.fromCharCode(src[pos + 4], src[pos + 5], src[pos + 6], src[pos + 7])
        const chunkLen = 4 + 4 + len + 4
        if (type !== "pHYs") chunks.push(src.subarray(pos, pos + chunkLen))
        pos += chunkLen
    }
    const head = src.subarray(0, 8)
    var total = head.length + phys.length
    for (const c of chunks) total += c.length
    const out = new Uint8Array(total)
    var off = 0
    out.set(head, off); off += head.length
    // IHDR first, then the density, then everything else.
    out.set(chunks[0], off); off += chunks[0].length
    out.set(phys, off); off += phys.length
    for (var i = 1; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length }
    return out.buffer
}

// One 16:9 slide carrying the figure. The SVG rides along so PowerPoint 2016
// and later render true vector, with the PNG as the fallback.
async function _gcxCanvasToPptx(canvas, widthCm, heightCm, svgStr) {
    if (typeof JSZip === "undefined") throw new Error("JSZip unavailable")
    const EMU = 360000
    const cx = 12192000, cy = 6858000
    const figW = (widthCm || 10) * EMU, figH = (heightCm || 10) * EMU
    const scale = Math.min((cx * 0.88) / figW, (cy * 0.88) / figH)
    const picW = Math.round(figW * scale), picH = Math.round(figH * scale)
    const offX = Math.round((cx - picW) / 2), offY = Math.round((cy - picH) / 2)
    const pngB64 = canvas.toDataURL("image/png").split(",")[1]
    const useSvg = !!svgStr
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    const zip = new JSZip()
    zip.file("[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${useSvg ? '<Default Extension="svg" ContentType="image/svg+xml"/>' : ""}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`)
    zip.file("_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
    zip.file("ppt/presentation.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
    zip.file("ppt/_rels/presentation.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`)
    const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
    const emptyTree = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>`
    zip.file("ppt/slideMasters/slideMaster1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${emptyTree}</p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`)
    zip.file("ppt/slideLayouts/slideLayout1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
    zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)
    const solid = c => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`
    zip.file("ppt/theme/theme1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="${A}" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${solid("FFFFFF")}${solid("FFFFFF")}${solid("FFFFFF")}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${solid("000000")}</a:ln><a:ln w="12700">${solid("000000")}</a:ln><a:ln w="19050">${solid("000000")}</a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${solid("FFFFFF")}${solid("FFFFFF")}${solid("FFFFFF")}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`)
    const blip = useSvg
        ? `<a:blip r:embed="rId1"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId3"/></a:ext></a:extLst></a:blip>`
        : `<a:blip r:embed="rId1"/>`
    zip.file("ppt/slides/slide1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Genomic context"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${picW}" cy="${picH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    zip.file("ppt/slides/_rels/slide1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/><Relationship Id="rId2" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${useSvg ? `<Relationship Id="rId3" Type="${REL}/image" Target="../media/image2.svg"/>` : ""}</Relationships>`)
    zip.file("ppt/media/image1.png", pngB64, { base64: true })
    if (useSvg) zip.file("ppt/media/image2.svg", svgStr)
    return await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })
}

// =============================================================================
// Dialog and dispatch
// =============================================================================

function _gcxPrefs() {
    var stored = null
    try { stored = JSON.parse(localStorage.getItem(_GCX_STORE) || "null") } catch (e) { stored = null }
    return Object.assign({ format: "png", widthCm: 20, dpi: 300 }, stored || {})
}

function _gcxSavePrefs(p) {
    try { localStorage.setItem(_GCX_STORE, JSON.stringify(p)) } catch (e) { /* session only */ }
}

function GC_exportImage() {
    if (typeof _gcReady !== "function" || !_gcReady()) return
    const p = _gcxPrefs()
    const fig = GC_buildSvg(_gcView())
    const ratio = fig.height / fig.width
    const body = document.getElementById("gcxBody")
    body.innerHTML =
        `<p class="gcxNote">The figure is drawn fresh for export, so it carries the sequence and its annotation without the page around it.</p>` +
        `<div class="gcxFormats">` +
        _GCX_FORMATS.map(f =>
            `<label class="gcxFmt"><input type="radio" name="gcxFmt" value="${f.id}" ${p.format === f.id ? "checked" : ""} onchange="GC_xUpdate()">` +
            `<span class="gcxFmtName">${f.label}</span><span class="gcxFmtNote">${_gcxEsc(f.note)}</span></label>`).join("") +
        `</div>` +
        `<div class="gcxRow"><label>Width <input type="number" id="gcxW" min="5" max="60" step="1" value="${p.widthCm}" onchange="GC_xUpdate()"> cm</label>` +
        `<label id="gcxDpiWrap">Resolution <select id="gcxDpi" onchange="GC_xUpdate()">` +
        _GCX_DPIS.map(d => `<option value="${d}" ${Number(p.dpi) === d ? "selected" : ""}>${d} dpi</option>`).join("") +
        `</select></label></div>` +
        `<p class="gcxSize" id="gcxSize"></p>` +
        `<div class="gcxRow gcxCenter"><button class="validate-btn" onclick="GC_xRun()">Export</button>` +
        `<button class="validate-btn" onclick="GC_xClose()">Cancel</button></div>`
    document.getElementById("gcxModal").className = "fazeIn upset-modal-overlay"
    _GC.xRatio = ratio
    GC_xUpdate()
}

function GC_xClose() {
    document.getElementById("gcxModal").className = "fazeOut upset-modal-overlay"
}

function GC_xUpdate() {
    const fmt = (document.querySelector('input[name="gcxFmt"]:checked') || {}).value || "png"
    const w = parseFloat(document.getElementById("gcxW").value) || 20
    const dpi = parseInt(document.getElementById("gcxDpi").value, 10) || 300
    // SVG has no resolution to choose; PowerPoint places a vector picture.
    const wrap = document.getElementById("gcxDpiWrap")
    wrap.style.visibility = (fmt === "svg") ? "hidden" : "visible"
    const h = w * (_GC.xRatio || 1)
    const px = Math.round(w / 2.54 * dpi)
    const note = document.getElementById("gcxSize")
    note.textContent = (fmt === "svg")
        ? `${w} × ${h.toFixed(1)} cm, vector.`
        : `${w} × ${h.toFixed(1)} cm at ${dpi} dpi — ${px.toLocaleString("en-US")} × ${Math.round(px * (_GC.xRatio || 1)).toLocaleString("en-US")} pixels.`
}

function _gcxSave(blob, filename) {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function _gcxStamp() {
    const d = new Date()
    const p = n => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

async function GC_xRun() {
    const fmt = (document.querySelector('input[name="gcxFmt"]:checked') || {}).value || "png"
    const widthCm = Math.max(5, Math.min(60, parseFloat(document.getElementById("gcxW").value) || 20))
    const dpi = parseInt(document.getElementById("gcxDpi").value, 10) || 300
    _gcxSavePrefs({ format: fmt, widthCm: widthCm, dpi: dpi })

    const v = _gcView()
    const fig = GC_buildSvg(v)
    const heightCm = widthCm * (fig.height / fig.width)
    const base = `${String(v.cur.guideId).replace(/[^A-Za-z0-9_.-]/g, "_")} context_${_gcxStamp()}`
    const status = document.getElementById("gcxSize")
    const said = status ? status.textContent : ""
    if (status) status.textContent = "Building the file…"

    try {
        if (fmt === "svg") {
            _gcxSave(new Blob([fig.svg], { type: "image/svg+xml;charset=utf-8" }), `${base}.svg`)
        } else {
            // Scale so the raster prints at widthCm at the chosen density.
            const scale = (widthCm / 2.54 * dpi) / fig.width
            const canvas = await _gcxRasterise(fig.svg, fig.width, fig.height, scale)
            if (fmt === "tiff") {
                _gcxSave(new Blob([_gcxCanvasToTiff(canvas, dpi)], { type: "image/tiff" }), `${base}.tiff`)
            } else if (fmt === "pdf") {
                _gcxSave(new Blob([_gcxCanvasToPdf(canvas, widthCm, heightCm)], { type: "application/pdf" }), `${base}.pdf`)
            } else if (fmt === "pptx") {
                _gcxSave(await _gcxCanvasToPptx(canvas, widthCm, heightCm, fig.svg),
                         `${base}.pptx`)
            } else {
                const durl = canvas.toDataURL("image/png")
                if (!durl || durl.length < 100) throw new Error("The image is too large at this width and resolution.")
                var buf = await (await fetch(durl)).arrayBuffer()
                buf = _gcxSetPngDpi(buf, dpi)
                _gcxSave(new Blob([buf], { type: "image/png" }), `${base}.png`)
            }
        }
        GC_xClose()
    } catch (e) {
        console.error("Context image export failed:", e)
        if (status) status.textContent = `Export failed: ${e.message}. Try SVG, or a smaller width or resolution.`
        return
    }
    if (status) status.textContent = said
}
