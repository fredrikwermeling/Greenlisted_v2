#!/usr/bin/env python3
"""
Extract the control sgRNAs from Jacquere and Julianna into controlGuides.json.

    python3 tools/build_control_guides.py

VBC human and VBC mouse ship no control guides at all, so a screen designed
from them has no baseline unless one is borrowed. Rather than fetch a whole
4 MB library file at run time to get 1000 sequences, the control blocks are
extracted here into a small file the app can load on demand.

Jacquere and Julianna are the donors because they are the current
recommendation for human and mouse respectively, and because they carry both
kinds: 100 non-targeting (NegCtrl) and 900 safe-targeting (CutCtrl).

The file records the plain sequences. Whether a given guide suits the host
library is decided in the app, not here: VBC's guides all begin with G, and
borrowing a guide that does not would break the design convention of the
library it is being mixed into.
"""

import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DONORS = {
    # species: (library file, symbol column, sgRNA column)
    "Human": ("Jacquere (human).txt", 2, 1),
    "Mouse": ("Julianna (mouse).txt", 2, 1),
}

BLOCKS = {"safeTargeting": "CUTCTRL", "nonTargeting": "NEGCTRL"}


def main():
    os.chdir(ROOT)
    out = {
        "_doc": "Control sgRNAs extracted from Jacquere and Julianna by "
                "tools/build_control_guides.py, for libraries that ship none of "
                "their own. Sequences only; the app decides which of them suit "
                "the library they are being mixed into.",
        "species": {},
    }
    for species, (fname, symcol, rnacol) in DONORS.items():
        found = {k: [] for k in BLOCKS}
        with open(f"libraries/{fname}", encoding="utf-8", errors="replace") as fh:
            fh.readline()
            for line in fh:
                p = line.rstrip("\n").split("\t")
                if len(p) < max(symcol, rnacol):
                    continue
                sym = p[symcol - 1].strip().upper()
                seq = p[rnacol - 1].strip().upper()
                if not seq or set(seq) - set("ACGT"):
                    continue
                for key, marker in BLOCKS.items():
                    if sym == marker:
                        found[key].append(seq)
        out["species"][species] = {
            "source": fname.replace(".txt", ""),
            "safeTargeting": {"symbol": "CutCtrl", "guides": sorted(set(found["safeTargeting"]))},
            "nonTargeting": {"symbol": "NegCtrl", "guides": sorted(set(found["nonTargeting"]))},
        }

    with open("controlGuides.json", "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    for species, block in out["species"].items():
        print(f"  {species:<6} from {block['source']}")
        for key in BLOCKS:
            g = block[key]["guides"]
            starts_g = sum(1 for s in g if s.startswith("G"))
            print(f"      {key:<14} {len(g):>4} guides, {starts_g} start with G")
    print(f"\ncontrolGuides.json: {round(os.path.getsize('controlGuides.json')/1024)} KB")


if __name__ == "__main__":
    main()
