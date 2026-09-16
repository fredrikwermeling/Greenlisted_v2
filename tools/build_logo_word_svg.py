#!/usr/bin/env python3
"""
Trace the wordmark half of the logo into logo-word.svg.

    python3 tools/build_logo_word_svg.py

The original artwork is one 779x188 PNG holding the name, the v2.0 and the
leaves. logo-word.png is the name half of it, cut along the blank column
between the "0" and the first leaf. That crop is only 491 px across, and the
page now draws the name wider than that, so the bitmap was being stretched
past its own pixels: soft on an ordinary screen, softer on a retina one.

The name is one flat colour, #83AA3D on white, which makes it cheap to trace
exactly rather than redraw. Coverage is read off the red channel, which runs
255 to 131 across the antialiased edge; the mask is enlarged four times so
the contour lands on quarter-pixel boundaries; marching squares gives the
outlines; and the whole thing becomes one even-odd path so the counters of
the letters stay open.

This traces the shapes that were drawn. It is not a reconstruction in a
guessed font, and it must not become one: if the logo is ever redrawn,
replace logo-mark.png and run this again.

The leaves are left as a bitmap. They are shaded rather than flat, so they
would not trace cleanly, and nothing on the page enlarges them.
"""

import numpy as np
from PIL import Image
from skimage import measure
import os

SCALE = 4
INK = 131.0          # red channel of the flat green, #83AA3D
TOLERANCE = 0.45     # in the 4x mask, so about a tenth of an original pixel

def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    im = Image.open("logo-word.png").convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.float32)
    cov = np.clip((255.0 - a[:, :, 0]) / (255.0 - INK), 0.0, 1.0)

    big = np.asarray(Image.fromarray((cov * 255).astype(np.uint8)).resize(
        (W * SCALE, H * SCALE), Image.BICUBIC)).astype(np.float32) / 255.0
    # One blank pixel all round, so a shape touching the edge still closes.
    pad = np.zeros((big.shape[0] + 2, big.shape[1] + 2), np.float32)
    pad[1:-1, 1:-1] = big

    parts = []
    for c in measure.find_contours(pad, 0.5):
        c = measure.approximate_polygon(c, tolerance=TOLERANCE)
        if len(c) < 4:
            continue
        xs = (c[:, 1] - 1) / SCALE
        ys = (c[:, 0] - 1) / SCALE
        parts.append("M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in zip(xs, ys)) + "Z")

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'role="img" aria-label="Green Listed v2.0">'
           f'<path fill="#83AA3D" fill-rule="evenodd" d="{"".join(parts)}"/></svg>')
    with open("logo-word.svg", "w") as fh:
        fh.write(svg)
    print(f"logo-word.svg: {len(parts)} subpaths, {len(svg)} bytes")

if __name__ == "__main__":
    main()
