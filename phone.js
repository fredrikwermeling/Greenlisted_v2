//
// Green Listed v2.0
//
// Phone layout: collapsible panels and clamped reference text.
//
// The three steps already stack below 900px, but stacking alone leaves a
// phone scrolling through every optional setting to reach Run. On a small
// screen a settings panel nobody is going to change should be a line you can
// tap, not a block you have to scroll past.
//
// Modelled on the same mechanism in Correlate, with two differences that come
// from this app's markup. Every panel here is a .smallPlate whose first child
// is its .smallTitle and whose remaining children are the controls, so the
// body can be found structurally rather than by walking siblings. And the
// panels are never rebuilt, so the open/closed state can live on the element
// instead of being keyed by title text.
//
const _PHONE_MAX = 640

function _phoneOn() {
    return window.innerWidth <= _PHONE_MAX
}

// Which panels start closed. A panel is only worth collapsing if it is
// optional: the library picker, the gene box and Run are the job itself and
// stay open. "Symbols not found" is a result rather than a setting, so it
// opens closed and is worth opening when something is missing.
const _PHONE_PANELS = [
    { match: /^Controls/i, open: false },
    { match: /^Sequence modifications/i, open: false },
    { match: /^Pick human cell line/i, open: false },
    { match: /^Symbols not found/i, open: false },
    { match: /^Symbol matching/i, open: true }
]

function _phoneWire(plate, spec) {
    if (plate.dataset.phoneWired) return
    const title = plate.querySelector(":scope > .smallTitle")
    if (!title) return
    const rest = [...plate.children].filter(c => c !== title)
    if (!rest.length) return

    plate.dataset.phoneWired = "1"
    // The stylesheet keys the tap target and the caret off this, so it has to
    // be on the plate whether the panel is open or closed. phone-collapsed is
    // the state; phone-collapsible is the fact that it has one.
    plate.classList.add("phone-collapsible")
    // One wrapper around everything below the heading. `display: contents`
    // when open rather than `block`, so the panel's own flex rules still
    // apply to the controls and an open panel is indistinguishable from one
    // that was never made collapsible.
    var body = plate.querySelector(":scope > [data-phone-body]")
    if (!body) {
        body = document.createElement("div")
        body.setAttribute("data-phone-body", "1")
        plate.insertBefore(body, rest[0])
        rest.forEach(c => body.appendChild(c))
    }

    const caret = document.createElement("span")
    caret.className = "phone-caret"
    caret.textContent = "▾"
    caret.setAttribute("aria-hidden", "true")
    title.appendChild(caret)

    plate._phoneBody = body
    plate._phoneOpen = !!(spec && spec.open)

    title.setAttribute("role", "button")
    title.setAttribute("tabindex", "0")
    title.addEventListener("click", e => {
        // The library panel's heading holds the library dropdown, and an info
        // dot is a control of its own. Neither should fold the panel.
        if (e.target.closest("input, select, textarea, button, a, .infoDot")) return
        _phoneSet(plate, !plate._phoneOpen)
    })
    title.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        _phoneSet(plate, !plate._phoneOpen)
    })
}

function _phoneSet(plate, open) {
    plate._phoneOpen = open
    plate.classList.toggle("phone-collapsed", !open)
    const title = plate.querySelector(":scope > .smallTitle")
    if (title) title.setAttribute("aria-expanded", open ? "true" : "false")
    if (plate._phoneBody) plate._phoneBody.style.display = open ? "contents" : "none"
}

// Put every panel back the way it was found. Rotating a phone from portrait
// to landscape crosses the breakpoint, and a panel left folded there would be
// a line of text with no way to open it, since the heading is only tappable
// under the phone stylesheet.
function _phoneRelease(plate) {
    plate.classList.remove("phone-collapsed")
    plate.classList.remove("phone-collapsible")
    if (plate._phoneBody) plate._phoneBody.style.display = "contents"
}

// The library reference: title, authors, journal, DOI and a link, five lines
// deep before the first control. Clamped to its first two lines with a line
// to open it, rather than hidden: which library this is and who published it
// is worth seeing without asking.
function _phoneClampLibraryInfo(on) {
    const info = document.getElementById("libraryInfo")
    if (!info) return
    var more = document.getElementById("libraryInfoMore")
    if (!more) {
        more = document.createElement("button")
        more.id = "libraryInfoMore"
        more.className = "phoneMore"
        more.type = "button"
        more.addEventListener("click", () => {
            const open = info.classList.toggle("phone-clamp-open")
            more.textContent = open ? "Show less" : "Show the full reference"
        })
        info.parentElement.insertBefore(more, info.nextSibling)
    }
    // Nothing to clamp until a library has been chosen and its citation has
    // arrived, and nothing to clamp if it already fits.
    const worth = on && info.textContent.trim().length > 0 && info.scrollHeight > 70
    info.classList.toggle("phone-clamp", worth)
    if (!worth) info.classList.remove("phone-clamp-open")
    more.hidden = !worth
    if (worth && !info.classList.contains("phone-clamp-open")) more.textContent = "Show the full reference"
}

// The output section on a phone.
//
// Nobody downloads a file to a phone, so the Download buttons and the format
// picker behind them are hidden there — the buttons stay in the page so every
// other code path that populates them still works, they are simply not shown.
// And the seven outputs stacked one per row made the section taller than four
// screens before the first table. Only the oligo list is offered; the rest are
// behind a line you tap.
function _phoneOutputs(on) {
    const table = document.getElementById("outputTable")
    if (!table) return
    const rows = [...table.querySelectorAll("tr")]
    const first = rows.find(r => r.querySelector("#outLabelAdapter"))
    const others = rows.filter(r => r !== first && r.querySelector(".outLabel"))
    if (!first || !others.length) return

    var more = document.getElementById("phoneMoreOutputs")
    if (!more) {
        more = document.createElement("button")
        more.id = "phoneMoreOutputs"
        more.className = "phoneMore phoneMoreOutputs"
        more.type = "button"
        more.addEventListener("click", () => {
            const open = table.classList.toggle("phone-outputs-open")
            more.textContent = open ? "Hide the other outputs" : "Other outputs"
        })
        // Inside the table's own flex container, so it sits with the rows
        // rather than beside them.
        const host = table.querySelector("tbody") || table
        host.appendChild(more)
    }
    // The labels are written to wrap over two lines for the desktop's three
    // narrow columns. A phone row is the full width, so the line break is
    // replaced by a space rather than removed: dropping the <br> in CSS left
    // "Oligos toorder". The original is kept so a rotation puts it back.
    for (const label of table.querySelectorAll(".outLabel")) {
        if (label.dataset.wideHtml == null) label.dataset.wideHtml = label.innerHTML
        const want = on ? label.dataset.wideHtml.replace(/<br\s*\/?>/gi, " ") : label.dataset.wideHtml
        if (label.innerHTML !== want) label.innerHTML = want
    }
    // The title is the control on a phone, so it carries the tap. The Show
    // button it stands in for is still the thing clicked, so every code path
    // behind it — the active marker, the pane switching — is unchanged.
    for (const label of table.querySelectorAll(".outLabel")) {
        if (label.dataset.phoneTap) continue
        label.dataset.phoneTap = "1"
        label.addEventListener("click", e => {
            if (!table.classList.contains("phone-outputs")) return
            if (e.target.closest(".infoDot")) return
            const btn = label.parentElement.querySelector("button[data-show]")
            if (!btn) return
            btn.click()
            // Chosen from a grid that sits above the table, so the answer is
            // below the fold the moment it is drawn.
            // Not inside requestAnimationFrame: a frame callback can be held
            // back indefinitely, and the scroll then never happens at all.
            // The table is already in the document by the time click()
            // returns, so there is nothing to wait for.
            if (typeof APP_scrollIntoView === "function") {
                APP_scrollIntoView(document.getElementById("fileContentContainer"))
            }
        })
        label.setAttribute("role", "button")
        label.setAttribute("tabindex", "0")
        label.addEventListener("keydown", e => {
            if (e.key !== "Enter" && e.key !== " ") return
            e.preventDefault()
            label.click()
        })
    }
    table.classList.toggle("phone-outputs", on)
    if (!on) table.classList.remove("phone-outputs-open")
    more.hidden = !on
    if (on && !table.classList.contains("phone-outputs-open")) more.textContent = "Other outputs"
}

function PHONE_apply() {
    const on = _phoneOn()
    for (const plate of document.querySelectorAll(".smallPlate")) {
        const title = plate.querySelector(":scope > .smallTitle")
        if (!title) continue
        const text = title.textContent.replace(/[▾▸]/g, "").trim()
        const spec = _PHONE_PANELS.find(p => p.match.test(text))
        if (!spec) continue
        if (on) {
            _phoneWire(plate, spec)
            plate.classList.add("phone-collapsible")
            // Only on the first pass, so returning to a phone width does not
            // undo what the user has opened since.
            if (!plate.dataset.phoneApplied) {
                plate.dataset.phoneApplied = "1"
                _phoneSet(plate, !!spec.open)
            }
        } else if (plate.dataset.phoneWired) {
            _phoneRelease(plate)
            delete plate.dataset.phoneApplied
        }
    }
    _phoneClampLibraryInfo(on)
    _phoneOutputs(on)
}

document.addEventListener("DOMContentLoaded", () => {
    PHONE_apply()
    var t = null
    window.addEventListener("resize", () => {
        clearTimeout(t)
        t = setTimeout(PHONE_apply, 150)
    })
})
