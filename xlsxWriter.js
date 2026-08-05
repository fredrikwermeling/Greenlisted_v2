//
// Green Listed 2.0 — minimal .xlsx writer
// MIT Open source
// -
// Why this exists: Excel rewrites gene symbols when it opens a delimited
// file. MARCH1 through MARCH11, the SEPT genes and DEC1 all become dates, and
// aliases like 2E4 become 20000. It is the reason HGNC renamed those genes in
// 2020 (MARCH1 -> MARCHF1, SEPT1 -> SEPTIN1, DEC1 -> DELEC1), but the built-in
// libraries still carry 51 of the old spellings, so the problem is live here.
//
// Nothing inside a .csv or .tsv can prevent this. A leading apostrophe stops a
// formula when text is typed into a cell, but on opening a delimited file it
// is unreliable and often ends up displayed as part of the value. The only
// dependable fix is to hand Excel a file where the cell type is already
// decided, which is what a real workbook does.
//
// A .xlsx is a zip of XML parts, and JSZip is already loaded for "Download
// all", so this needs no new dependency. Cells are written as inline strings
// (t="inlineStr"), which Excel never reinterprets.
//

// A cell is written as a number only if it is a plain decimal. Scientific
// notation is deliberately excluded: 2E4 is a real gene alias, and typing it
// as a number would turn it into 20000 — the same class of damage this file
// exists to prevent. Everything else, gene symbols included, stays text.
const _XLSX_PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function _xlsxEsc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        // Control characters are not legal in XML and would corrupt the file.
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function _xlsxColName(n) {
    var s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) {
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    }
    return s;
}

// Excel sheet names cannot exceed 31 characters or contain : \ / ? * [ ]
function _xlsxSheetName(name, taken) {
    var s = String(name || "Sheet").replace(/[:\\\/?*\[\]]/g, " ").slice(0, 31).trim() || "Sheet";
    var base = s, i = 2;
    while (taken.has(s.toLowerCase())) {
        const suffix = " " + i++;
        s = base.slice(0, 31 - suffix.length) + suffix;
    }
    taken.add(s.toLowerCase());
    return s;
}

function _xlsxSheetXml(rows) {
    var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    for (var r = 0; r < rows.length; r++) {
        out += '<row r="' + (r + 1) + '">';
        const cells = rows[r];
        for (var c = 0; c < cells.length; c++) {
            const raw = cells[c];
            if (raw === "" || raw == null) continue;
            const ref = _xlsxColName(c) + (r + 1);
            if (_XLSX_PLAIN_NUMBER.test(String(raw).trim())) {
                out += '<c r="' + ref + '"><v>' + _xlsxEsc(String(raw).trim()) + '</v></c>';
            } else {
                out += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
                       _xlsxEsc(raw) + '</t></is></c>';
            }
        }
        out += '</row>';
    }
    return out + '</sheetData></worksheet>';
}

// sheets: [{ name, rows: [[cell, ...], ...] }]
async function XLSX_build(sheets) {
    if (typeof JSZip === "undefined") throw new Error("JSZip is not loaded");
    const zip = new JSZip();
    const taken = new Set();
    const named = sheets.map(s => ({ name: _xlsxSheetName(s.name, taken), rows: s.rows }));

    zip.file("[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        named.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
            '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
        '</Types>');

    zip.folder("_rels").file(".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>');

    const xl = zip.folder("xl");
    xl.file("workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        named.map((s, i) => '<sheet name="' + _xlsxEsc(s.name) + '" sheetId="' + (i + 1) +
            '" r:id="rId' + (i + 1) + '"/>').join("") +
        '</sheets></workbook>');

    xl.folder("_rels").file("workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named.map((_, i) => '<Relationship Id="rId' + (i + 1) +
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
            (i + 1) + '.xml"/>').join("") +
        '</Relationships>');

    const ws = xl.folder("worksheets");
    named.forEach((s, i) => ws.file("sheet" + (i + 1) + ".xml", _xlsxSheetXml(s.rows)));

    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// Turn one of the app's delimited outputs into rows. Leading "#" comment lines
// and the "Library: ..., Date: ..." banner are kept as single-cell rows so the
// provenance travels with the sheet.
function XLSX_rowsFromDelimited(text, delimiter) {
    const d = delimiter || "\t";
    return String(text || "").replace(/\r/g, "").split("\n")
        .filter((line, i, all) => line !== "" || i < all.length - 1)
        .map(line => (line.startsWith("#") || line.startsWith("Library:")) ? [line] : line.split(d));
}
