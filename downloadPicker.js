//
// Green Listed v2.0
//
// Download format picker.
//
// Each output used to sit behind one link per format, which made the row read
// as though .csv and .xlsx were two different results rather than two ways of
// saving the same one. There is now a single Download button per output, and
// the format is asked for on the way out.
//
// The download paths themselves are unchanged: the anchors that carry the blob
// URL and filename for each delimited output are still in the table (hidden)
// and still populated after every run, and the picker clicks them. Only the
// two plain-text outputs, which never had a prepared blob, are built here.
//

// What each output can be saved as, in the order offered. `anchor` names a
// hidden <a> whose href is set after a run; `run` is called instead when the
// file is built on demand.
const _DL_OUTPUTS = {
    adapter: {
        label: "Output with adapters",
        formats: [
            { ext: ".csv", note: "For MAGeCK and other analysis tools", anchor: "adapterDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("adapter") }
        ]
    },
    mageck: {
        label: "Output for MAGeCK",
        formats: [
            { ext: ".csv", note: "The file MAGeCK reads", anchor: "MAGeCKDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("mageck") }
        ]
    },
    full: {
        label: "Full output",
        formats: [
            { ext: ".csv", note: "Every library column for the selected guides", anchor: "fullDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("full") }
        ]
    },
    cnAnnotation: {
        label: "Copy number per gene",
        formats: [
            { ext: ".csv", note: "Copy number for each targeted gene", anchor: "cnAnnotationDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("cnAnnotation") }
        ]
    },
    notFound: {
        label: "Symbols not found",
        formats: [
            { ext: ".csv", note: "Symbols with no match in this library", anchor: "notFoundDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("notFound") }
        ]
    },
    settings: {
        label: "Run settings",
        formats: [
            { ext: ".txt", note: "Every setting this run used",
              run: () => _dlText(SET_settingsToStr(), _outName() + " Settings.txt") },
            { ext: ".xlsx", note: "Excel workbook", run: () => XLS_download("settings") }
        ]
    },
    methods: {
        label: "Methods text",
        formats: [
            { ext: "Copy", note: "Straight to the clipboard, ready to paste", run: () => copyMethodsOutput() },
            { ext: ".txt", note: "Short and full versions, plus references",
              run: () => _dlText(METH_text(), _outName() + " Methods.txt") },
            { ext: ".xlsx", note: "Excel workbook", run: () => XLS_download("methods") }
        ]
    },
    validation: {
        label: "Validation results",
        formats: [
            { ext: ".csv", note: "Every sequence and the libraries it appears in", anchor: "validationDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("validation") }
        ]
    },
    validationNotFound: {
        label: "Sequences not found",
        formats: [
            { ext: ".csv", note: "Sequences matching no published library", anchor: "validationNotFoundDownload" },
            { ext: ".xlsx", note: "Excel workbook", run: () => XLS_download("validationNotFound") }
        ]
    },
    cnTable: {
        label: "Copy-number table",
        formats: [
            { ext: ".csv", note: "The table as shown", anchor: "cnDownload" },
            { ext: ".xlsx", note: "Excel workbook — keeps gene symbols intact", run: () => XLS_download("cnTable") }
        ]
    },
    all: {
        label: "Every output",
        formats: [
            { ext: ".zip", note: "One file per output, as separate .csv and .txt files", run: () => downloadAll() },
            { ext: ".xlsx", note: "One workbook, one sheet per output", run: () => downloadAllExcel() }
        ]
    }
}

// Plain-text outputs are built here and handed straight to the browser. The
// delimited ones go through their anchors, which already hold a blob URL from
// the last run; these two have no anchor to inherit from.
function _dlText(text, filename) {
    _downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename)
}

function DL_open(key) {
    const spec = _DL_OUTPUTS[key]
    if (!spec) return
    document.getElementById("downloadModalTitle").textContent = `Download — ${spec.label}`

    const body = document.getElementById("downloadModalBody")
    body.innerHTML = ""
    spec.formats.forEach((fmt, i) => {
        body.appendChild(_dlOption(key, fmt, i))
    })

    document.getElementById("downloadModal").className = "fazeIn upset-modal-overlay"
}

// One row in the picker. A format backed by a prepared file is rendered as a
// real anchor carrying that file's blob URL, so the user's click activates the
// download directly — a script-dispatched click is a weaker signal that
// browsers may refuse once a page has saved a few files. Formats that build
// on demand stay buttons, since there is nothing to point an anchor at yet.
function _dlOption(key, fmt, index) {
    const label = `<span class="fmtName">${_escapeHtml(fmt.ext)}</span>` +
                  `<span class="fmtNote">${_escapeHtml(fmt.note)}</span>`
    if (fmt.run) {
        const btn = document.createElement("button")
        btn.className = "fmtBtn"
        btn.innerHTML = label
        btn.onclick = () => { DL_close(); fmt.run() }
        return btn
    }

    const source = document.getElementById(fmt.anchor)
    const href = source && source.getAttribute("href")
    if (!href) {
        const btn = document.createElement("button")
        btn.className = "fmtBtn"
        btn.innerHTML = label
        btn.onclick = () => {
            DL_close()
            _setStatus("statusSearch", "Nothing to download yet — run first.")
        }
        return btn
    }

    const a = document.createElement("a")
    a.className = "fmtBtn"
    a.href = href
    a.download = source.download || (_outName() + fmt.ext)
    a.innerHTML = label
    a.onclick = () => DL_close()
    return a
}

function DL_close() {
    document.getElementById("downloadModal").className = "fazeOut upset-modal-overlay"
}
