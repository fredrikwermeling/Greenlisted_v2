#!/usr/bin/env python3
"""
Find the sgRNAs that sit in both a human and a mouse library.

    python3 tools/build_cross_species.py

Reads the two Validate sgRNA indexes and writes three files:

  libraries/sgRNA_cross_species.txt
      One line per shared spacer: the human libraries and genes, the mouse
      libraries and genes. Small enough (about 1 MB) to load after every run,
      where the two 35 MB indexes are not, so the result tables can say for
      each guide whether the other species' libraries carry it too.

  libraries/Human-mouse shared (human).txt
  libraries/Human-mouse shared (mouse).txt
      The same guides laid out as a library, one row per guide and gene, so
      they can be searched like any other: by human symbol in the first, by
      mouse symbol in the second. A guide that targets the same gene in both
      species can then be used in a screen run in human and mouse cells.

A guide is shared when its spacer is identical in both indexes. Most of them
target orthologs in a stretch of sequence the two genomes share; some are
reporter controls (LacZ, EGFP, luciferase) that are not genomic at all.
"""

import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "libraries")

INDEX = {
    "human": os.path.join(LIB, "sgRNA_validation_index_human.txt"),
    "mouse": os.path.join(LIB, "sgRNA_validation_index_mouse.txt"),
}


def read_index(path):
    """spacer -> {"libs": set, "genes": {UPPER: (symbol, geneId)}}"""
    out = defaultdict(lambda: {"libs": set(), "genes": {}})
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or line.startswith("sgRNA Sequence"):
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 3:
                continue
            seq = cols[0].strip().upper()
            lib = cols[1].strip()
            sym = cols[2].strip()
            gid = cols[3].strip() if len(cols) > 3 else ""
            if not seq:
                continue
            e = out[seq]
            if lib:
                e["libs"].add(lib)
            if sym and sym.upper() not in e["genes"]:
                e["genes"][sym.upper()] = (sym, gid)
    return out


def main():
    human = read_index(INDEX["human"])
    mouse = read_index(INDEX["mouse"])
    shared = sorted(set(human) & set(mouse))

    join = lambda xs: "; ".join(sorted(xs, key=str.lower))
    syms = lambda e: [s for s, _ in e["genes"].values()]

    with open(os.path.join(LIB, "sgRNA_cross_species.txt"), "w", encoding="utf-8") as f:
        f.write("# sgRNAs found in both a human and a mouse library, from the Validate sgRNA "
                "indexes. Built by tools/build_cross_species.py\n")
        f.write("sgRNA Sequence\tHuman libraries\tHuman genes\tMouse libraries\tMouse genes\n")
        for seq in shared:
            h, m = human[seq], mouse[seq]
            f.write(f"{seq}\t{join(h['libs'])}\t{join(syms(h))}\t{join(m['libs'])}\t{join(syms(m))}\n")

    same_count = 0
    for species, mine, other in (("human", human, mouse), ("mouse", mouse, human)):
        cap = species.capitalize()
        oth = "Mouse" if species == "human" else "Human"
        path = os.path.join(LIB, f"Human-mouse shared ({species}).txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"Gene Symbol\tsgRNA\tLibraries (both species)\t{cap} libraries\t"
                    f"{oth} libraries\t{oth} gene\tSame gene in both\n")
            for seq in shared:
                a, b = mine[seq], other[seq]
                other_upper = set(b["genes"])
                n = len(a["libs"]) + len(b["libs"])
                for up, (sym, _gid) in sorted(a["genes"].items()):
                    same = "yes" if up in other_upper else "no"
                    if species == "human" and same == "yes":
                        same_count += 1
                    f.write(f"{sym}\t{seq}\t{n}\t{join(a['libs'])}\t{join(b['libs'])}\t"
                            f"{join(syms(b))}\t{same}\n")

    print(f"{len(shared):,} shared spacers; {same_count:,} human rows name the same gene in mouse")


if __name__ == "__main__":
    main()
