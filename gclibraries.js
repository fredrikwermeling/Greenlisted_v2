//
// Green Listed v2.0
//
// "Which other libraries pick this guide?"
//
// A guide chosen by several independent library designs has been arrived at by
// several different scoring schemes, which is a useful second opinion on it.
// The data already exists: the Validate sgRNA index lists every guide in every
// published library for a species, so this is a lookup rather than a download.
//
// Only libraries of the same species are compared, and the library the design
// came from is left out of the count — it would otherwise say "found in 1" for
// every guide and mean nothing.
//
// The index is 35 MB a species, which is too much to pull on the off-chance
// after every run, so it loads the first time something actually asks for it.
// Until then the column offers to fetch it rather than quietly doing so.
//

var _libxState = {
    loading: false,
    species: null,         // species the current view is showing
    notice: null           // element showing load progress, if any
}

function _libxSpecies() {
    const name = (typeof settings !== "undefined" && settings.libraryName) || ""
    if (/\(human\)/i.test(name)) return "human"
    if (/\(mouse\)/i.test(name)) return "mouse"
    return null
}

function _libxLoaded(species) {
    if (typeof _validateState === "undefined") return false
    return species === "human" ? _validateState.humanLoaded : _validateState.mouseLoaded
}

function _libxMap(species) {
    return species === "human" ? _validateState.indexMapHuman : _validateState.indexMapMouse
}

// Every OTHER library of this species holding the same spacer.
function LIBX_lookup(spacer, species, excludeLibrary) {
    const clean = String(spacer || "").trim().toUpperCase()
    if (!clean || !_libxLoaded(species)) return null
    const hits = _libxMap(species).get(clean)
    if (!hits) return []
    const skip = String(excludeLibrary || "").trim().toLowerCase()
    const seen = new Set()
    const out = []
    for (const h of hits) {
        const lib = (h.library || "").trim()
        if (!lib || lib.toLowerCase() === skip) continue
        if (seen.has(lib)) continue
        seen.add(lib)
        out.push({ library: lib, symbol: h.symbol, geneId: h.geneId, scores: h.scores })
    }
    out.sort((a, b) => a.library.localeCompare(b.library))
    return out
}

// How many same-species libraries there are to compare against, so the count
// can be read against something. The index is the authority on this, since it
// covers published libraries the app does not otherwise offer.
function LIBX_comparableCount(species, excludeLibrary) {
    if (!_libxLoaded(species)) return null
    const skip = String(excludeLibrary || "").trim().toLowerCase()
    const libs = new Set()
    for (const hits of _libxMap(species).values()) {
        for (const h of hits) {
            const lib = (h.library || "").trim()
            if (lib && lib.toLowerCase() !== skip) libs.add(lib)
        }
    }
    return libs.size
}

// Cached, because walking 600,000 entries to count libraries is not something
// to do once per rendered row.
var _libxComparableCache = {}
function _libxComparable(species, excludeLibrary) {
    const key = `${species}|${excludeLibrary}`
    if (!(key in _libxComparableCache)) _libxComparableCache[key] = LIBX_comparableCount(species, excludeLibrary)
    return _libxComparableCache[key]
}

// =============================================================================
// Loading
// =============================================================================

async function LIBX_load(species, statusEl) {
    if (_libxLoaded(species) || _libxState.loading) return _libxLoaded(species)
    _libxState.loading = true
    const say = t => { if (statusEl) statusEl.textContent = t }
    try {
        say(`Loading the ${species} sgRNA index (about 35 MB, once per session)…`)
        await VAL_loadIndex(species)
        _libxComparableCache = {}
        return true
    } catch (e) {
        console.error("Library index load failed:", e)
        say("Could not load the sgRNA index. Check your connection and try again.")
        return false
    } finally {
        _libxState.loading = false
    }
}

// Called from the offer above the table. Loads, then redraws whichever output
// is on screen so the column fills in.
async function LIBX_loadAndRefresh() {
    const species = _libxSpecies()
    if (!species) return
    const el = document.getElementById("libxNotice")
    const ok = await LIBX_load(species, el)
    if (!ok) return
    const active = document.querySelector("#outputTable button.show-active")
    if (active && active.dataset.show === "full") showFullOutput()
    else showAdapterOutput()
}

// Pull the index in the background once the app has settled, so the column is
// already filled the first time anyone looks at it. The copy-number matrix,
// which is larger, has been doing this since it was added.
function LIBX_prefetchWhenIdle() {
    const species = _libxSpecies()
    if (!species || _libxLoaded(species) || _libxState.loading) return
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    if (conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ""))) {
        console.log("sgRNA index prefetch skipped: metered or slow connection")
        return
    }
    const start = () => {
        if (_libxLoaded(species) || _libxState.loading) return
        LIBX_load(species).then(ok => {
            // If a result table is already on screen, fill the column in now
            // rather than leaving dashes until the next run.
            if (!ok) return
            const active = document.querySelector("#outputTable button.show-active")
            if (!active) return
            if (active.dataset.show === "full") showFullOutput()
            else if (active.dataset.show === "adapter") showAdapterOutput()
        }).catch(e => console.warn("sgRNA index prefetch failed (harmless):", e))
    }
    // Behind the copy-number matrix in the queue: that one is needed the
    // moment a cell line is picked, this only annotates a finished run.
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 15000 })
    else setTimeout(start, 9000)
}

// =============================================================================
// The extra column
// =============================================================================

// A rowExtra descriptor for _renderTsvAsTable: how many other libraries of the
// same species carry each guide. Null when there is no species to compare
// within, e.g. an uploaded library.
function LIBX_columnFor(spacerOf) {
    const species = _libxSpecies()
    if (!species) return null
    const mine = (typeof settings !== "undefined" && settings.libraryName) || ""
    const loaded = _libxLoaded(species)
    const total = loaded ? _libxComparable(species, mine) : null
    // The species and the word "other" moved into the heading. Spelled out on
    // every row they were the same 22 characters over and over, which made the
    // column wider than the sentence was worth and pushed the last column off
    // the table. No denominator: "1 of 7" only invited the question of whether
    // the library being designed from was inside the seven or outside it, and
    // the answer changed nothing.
    return {
        header: `Other ${species} libraries`,
        cell: cols => {
            const spacer = spacerOf(cols)
            if (!spacer) return ""
            if (!loaded) return `<span class="libxDim">…</span>`
            const hits = LIBX_lookup(spacer, species, mine)
            if (!hits || !hits.length) {
                return `<span class="libxNone" title="No other ${species} library in the index picks this guide.">none</span>`
            }
            const names = hits.map(h => h.library).join(", ")
            return `<span class="libxCount" title="Also picked by: ${_escapeHtml(names)}">${hits.length}</span>`
        }
    }
}

// The line above the table offering to fetch the index, shown only while it
// would actually change anything.
function LIBX_noticeHtml() {
    const species = _libxSpecies()
    if (!species || _libxLoaded(species)) return ""
    if (_libxState.loading) {
        return `<p class="libxOffer" id="libxNotice">Loading the ${species} sgRNA index in the background — the <b>Other libraries</b> column fills in when it arrives.</p>`
    }
    return `<p class="libxOffer" id="libxNotice">The <b>Other libraries</b> column needs the ${species} sgRNA index. ` +
           `<a href="javascript:void(0)" onclick="LIBX_loadAndRefresh()">Load it now</a> — about 35 MB, once per session.</p>`
}

// =============================================================================
// Per-guide popout
// =============================================================================

function LIBX_openFromButton(btn) {
    LIBX_open(btn.dataset.symbol, btn.dataset.spacer, btn.dataset.id)
}

async function LIBX_open(symbol, spacer, guideId) {
    const species = _libxSpecies()
    document.getElementById("libxModal").className = "fazeIn upset-modal-overlay"
    document.getElementById("libxTitle").textContent = `Other libraries — ${guideId || symbol}`
    const body = document.getElementById("libxBody")
    if (!species) {
        body.innerHTML = `<p class="libxMsg">This only compares libraries of the same species, and an uploaded library does not say which species it is for.</p>`
        return
    }
    if (!_libxLoaded(species)) {
        body.innerHTML = `<p class="libxMsg" id="libxLoadMsg">Loading the ${species} sgRNA index (about 35 MB, once per session)…</p>`
        const ok = await LIBX_load(species, document.getElementById("libxLoadMsg"))
        if (!ok) return
    }
    _libxRender(symbol, spacer, guideId, species)
}

function _libxRender(symbol, spacer, guideId, species) {
    const mine = (typeof settings !== "undefined" && settings.libraryName) || ""
    const hits = LIBX_lookup(spacer, species, mine)
    const total = _libxComparable(species, mine)
    const body = document.getElementById("libxBody")

    var html = `<div class="gcMeta">` +
        `<div class="gcKey">Guide</div><div class="gcVal">${_escapeHtml(guideId || symbol)} — 5'-${_escapeHtml(spacer)}-3'</div>` +
        `<div class="gcKey">Gene</div><div class="gcVal"><i>${_escapeHtml(symbol)}</i></div>` +
        `<div class="gcKey">Selected in</div><div class="gcVal">${_escapeHtml(mine)}</div>` +
        `</div>`

    if (!hits || !hits.length) {
        html += `<p class="libxMsg">No other ${species} library in the index picks this guide. ` +
                `That is not a mark against it — the libraries were designed at different times against different rules, ` +
                `and each keeps only a handful of guides per gene.</p>`
    } else {
        html += `<p class="libxMsg">Also chosen by <b>${hits.length}</b> of the ${total} other ${species} ` +
                `${hits.length === 1 ? "library" : "libraries"} in the index. A guide several independent designs ` +
                `arrived at has passed several different scoring schemes.</p>` +
                `<table class="validationResultsTable"><thead><tr><th>Library</th><th>Gene</th><th>Scores</th></tr></thead><tbody>`
        for (const h of hits) {
            html += `<tr><td>${_escapeHtml(h.library)}</td><td><i>${_escapeHtml(h.symbol)}</i></td>` +
                    `<td>${_escapeHtml(h.scores || "—")}</td></tr>`
        }
        html += `</tbody></table>`
    }
    html += `<p class="gcFoot">From the same index the Validate sgRNA tool searches, built from the guide lists ` +
            `distributed via Addgene and the Broad Institute GPP portal. Only ${species} libraries are compared, ` +
            `and ${_escapeHtml(mine)} is left out of the count.</p>`
    body.innerHTML = html
}

function LIBX_close() {
    document.getElementById("libxModal").className = "fazeOut upset-modal-overlay"
}

// Offered only when there is something behind it. On a guide no other
// library picks, the popout could only repeat what the column already says,
// and a button per row that says nothing is a column of noise that pushes
// the useful ones off the edge of the table.
//
// While the index is still loading nothing is known, so nothing is offered;
// the column redraws with the buttons once it lands.
function LIBX_button(symbol, spacer, id) {
    const clean = String(spacer || "").trim().toUpperCase()
    if (!/^[ACGT]{15,30}$/.test(clean)) return ""
    const species = _libxSpecies()
    if (!species || !_libxLoaded(species)) return ""
    const mine = (typeof settings !== "undefined" && settings.libraryName) || ""
    const hits = LIBX_lookup(clean, species, mine)
    if (!hits || !hits.length) return ""
    return `<button class="gcBtn libxBtn" data-symbol="${_escapeHtml(symbol)}" data-spacer="${clean}" ` +
           `data-id="${_escapeHtml(id)}" onclick="LIBX_openFromButton(this)" ` +
           `title="The ${hits.length} other ${species} ${hits.length === 1 ? "library" : "libraries"} that also pick this guide, and with what scores.">Libraries</button>`
}
