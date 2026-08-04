//
// Green Listed 2.0 — hover explanations
// MIT Open source
// -
// The browser's own tooltip is slow to appear, small, and truncates long text,
// which matters here because most of the help in this app is a paragraph or
// two hanging off a title attribute. This borrows that text and shows it in a
// readable box after a short delay, then puts the attribute back so nothing
// else loses it.
//
// Adapted from the same mechanism in Correlate, so the two apps explain
// themselves in the same way. The selector differs: Green Listed hangs its
// help off <span> info dots as well as buttons and labels.
//

const HELP_DELAY_MS = 550;
const HELP_SELECTOR = 'button[title], label[title], a[title], span[title], option[title], [data-help]';

document.addEventListener("DOMContentLoaded", () => {
    let timer = null;
    let current = null;
    let box = null;

    const hide = () => {
        clearTimeout(timer);
        timer = null;
        if (box) { box.remove(); box = null; }
        // Restore the native tooltip so the element is left as it was found.
        if (current && current._helpText != null) {
            current.setAttribute("title", current._helpText);
            current._helpText = null;
        }
        current = null;
    };

    const show = (el, text) => {
        if (box) box.remove();
        box = document.createElement("div");
        box.className = "help-popout";
        box.textContent = text;
        document.body.appendChild(box);
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const margin = 8;
        let left = r.left + r.width / 2 - b.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin));
        // Below the control by default, above it when there is no room.
        let top = r.bottom + 6;
        if (top + b.height > window.innerHeight - margin) top = r.top - b.height - 6;
        top = Math.max(margin, Math.min(top, window.innerHeight - b.height - margin));
        box.style.left = Math.round(left) + "px";
        box.style.top = Math.round(top) + "px";
    };

    document.addEventListener("mouseover", (e) => {
        const el = e.target.closest ? e.target.closest(HELP_SELECTOR) : null;
        if (!el || el === current) return;
        if (el.closest(".help-popout")) return;
        hide();
        const text = el.dataset.help || el.getAttribute("title") || "";
        if (!text.trim()) return;
        current = el;
        // Take the native tooltip away so both don't show at once.
        if (el.hasAttribute("title")) {
            el._helpText = el.getAttribute("title");
            el.removeAttribute("title");
        }
        timer = setTimeout(() => { if (current === el && el.isConnected) show(el, text); }, HELP_DELAY_MS);
    }, true);

    document.addEventListener("mouseout", (e) => {
        if (!current) return;
        const to = e.relatedTarget;
        if (to && current.contains(to)) return;
        hide();
    }, true);

    // A click means the user has decided; the explanation is just in the way.
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("blur", hide);
    document.addEventListener("scroll", hide, true);
});
