/**
 * upset.js — Custom SVG UpSet plot renderer + modal for sgRNA library overlap
 */

let _upsetData = null;

function _formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
}

async function UPSET_loadData() {
    if (_upsetData) return _upsetData;
    const resp = await fetch("libraries/upset_data.json");
    _upsetData = await resp.json();
    return _upsetData;
}

function UPSET_render(speciesData, container, title) {
    const MAX_INTERSECTIONS = 40;
    const sets = speciesData.sets;
    const intersections = speciesData.intersections.slice(0, MAX_INTERSECTIONS);
    const n = sets.length;

    // Layout constants
    const dotR = 6;
    const colW = 28;
    const rowH = 24;
    const barAreaH = 140;
    const setBarW = 140;
    const labelW = 110;
    const padTop = 30;
    const padRight = 10;
    const gap = 8;

    const matrixW = intersections.length * colW;
    const matrixH = n * rowH;
    const totalW = labelW + setBarW + gap + matrixW + padRight;
    const totalH = padTop + barAreaH + gap + matrixH + 10;

    const maxBarVal = Math.max(...intersections.map(d => d.size), 1);
    const maxSetVal = Math.max(...sets.map(d => d.size), 1);

    const matrixLeft = labelW + setBarW + gap;
    const matrixTop = padTop + barAreaH + gap;

    // Build SVG
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", totalW);
    svg.setAttribute("height", totalH);
    svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
    svg.style.display = "block";
    svg.style.margin = "0 auto";

    function el(tag, attrs) {
        const e = document.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
    }

    function addTitle(parent, text) {
        const t = document.createElementNS(svgNS, "title");
        t.textContent = text;
        parent.appendChild(t);
    }

    // Title
    const titleEl = el("text", {
        x: totalW / 2, y: 16,
        "text-anchor": "middle",
        "font-size": "13", "font-weight": "bold", fill: "#333"
    });
    titleEl.textContent = title;
    svg.appendChild(titleEl);

    // --- Set size bars (left side, horizontal) ---
    for (let i = 0; i < n; i++) {
        const y = matrixTop + i * rowH + rowH / 2;
        // Label
        const label = el("text", {
            x: labelW - 4, y: y + 4,
            "text-anchor": "end",
            "font-size": "10", fill: "#333"
        });
        label.textContent = sets[i].name;
        svg.appendChild(label);

        // Bar
        const bw = (sets[i].size / maxSetVal) * setBarW;
        const bar = el("rect", {
            x: labelW, y: y - 7, width: bw, height: 14,
            rx: 2, fill: "rgb(120,167,77)", opacity: "0.85"
        });
        addTitle(bar, `${sets[i].name}: ${sets[i].size.toLocaleString()} sgRNAs`);
        svg.appendChild(bar);

        // Count text
        const countLabel = el("text", {
            x: labelW + bw + 3, y: y + 3,
            "font-size": "9", fill: "#666"
        });
        countLabel.textContent = _formatCount(sets[i].size);
        svg.appendChild(countLabel);
    }

    // --- Intersection bars (top, vertical) ---
    for (let j = 0; j < intersections.length; j++) {
        const inter = intersections[j];
        const x = matrixLeft + j * colW + colW / 2;
        const bh = (inter.size / maxBarVal) * barAreaH;
        const barY = padTop + barAreaH - bh;

        const isMulti = inter.sets.length > 1;
        const bar = el("rect", {
            x: x - 8, y: barY, width: 16, height: bh,
            rx: 2,
            fill: isMulti ? "rgb(80,130,55)" : "rgb(120,167,77)",
            opacity: "0.85"
        });
        const setNames = inter.sets.map(idx => sets[idx].name).join(" + ");
        addTitle(bar, `${setNames}: ${inter.size.toLocaleString()} sgRNAs`);
        svg.appendChild(bar);

        // Count on top of bar
        const countEl = el("text", {
            x: x, y: barY - 3,
            "text-anchor": "middle",
            "font-size": "8", fill: "#666"
        });
        countEl.textContent = _formatCount(inter.size);
        svg.appendChild(countEl);
    }

    // --- Dot matrix ---
    for (let j = 0; j < intersections.length; j++) {
        const inter = intersections[j];
        const x = matrixLeft + j * colW + colW / 2;
        const activeDots = [];

        for (let i = 0; i < n; i++) {
            const y = matrixTop + i * rowH + rowH / 2;
            const active = inter.sets.includes(i);
            const dot = el("circle", {
                cx: x, cy: y, r: dotR,
                fill: active ? "#333" : "#ddd",
                stroke: active ? "#333" : "#ccc",
                "stroke-width": "1"
            });
            svg.appendChild(dot);
            if (active) activeDots.push(y);
        }

        // Connecting line between active dots
        if (activeDots.length > 1) {
            const line = el("line", {
                x1: x, y1: Math.min(...activeDots),
                x2: x, y2: Math.max(...activeDots),
                stroke: "#333", "stroke-width": "2"
            });
            svg.appendChild(line);
        }
    }

    // Wrap in a titled div
    const wrapper = document.createElement("div");
    wrapper.style.minWidth = totalW + "px";
    wrapper.appendChild(svg);
    container.appendChild(wrapper);
}

function UPSET_showModal() {
    const modal = document.getElementById("upsetModal");
    modal.className = "fazeIn upset-modal-overlay";
    const content = document.getElementById("upsetContent");
    content.innerHTML = "<p style='text-align:center;color:#888;'>Loading...</p>";

    UPSET_loadData().then(data => {
        content.innerHTML = "";
        const flex = document.createElement("div");
        flex.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:30px;padding:10px;";

        if (data.human) UPSET_render(data.human, flex, "Human libraries");
        if (data.mouse) UPSET_render(data.mouse, flex, "Mouse libraries");
        content.appendChild(flex);
    }).catch(err => {
        content.innerHTML = `<p style="color:red;text-align:center;">Failed to load data: ${err.message}</p>`;
    });
}

function UPSET_closeModal() {
    const modal = document.getElementById("upsetModal");
    modal.className = "fazeOut upset-modal-overlay";
}

// Close on click outside
document.addEventListener("click", function (e) {
    const modal = document.getElementById("upsetModal");
    if (!modal) return;
    if (modal.classList.contains("fazeIn") && e.target === modal) {
        UPSET_closeModal();
    }
});

// Close on Escape
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        const modal = document.getElementById("upsetModal");
        if (modal && modal.classList.contains("fazeIn")) {
            UPSET_closeModal();
        }
    }
});
