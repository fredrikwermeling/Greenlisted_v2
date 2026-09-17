#!/usr/bin/env python3
"""
Build essentialGenes.json: the genes that are essential in nearly every cell
line, so the output table can mark them.

Source: DepMap's inferred common essentials (CRISPRInferredCommonEssentials.csv
from the 26Q1 release), the same list DepMap uses to label a gene "common
essential" on its gene pages. About 1,800 human genes.

Mouse symbols are not in that file, so they are derived here: the app's synonym
table carries a homology group per symbol (column 4, "HOM:..."), which pairs a
human gene with its mouse orthologue. For each human essential we take the
symbols in its group that appear in the Julianna mouse library, which also
gives the symbol in the casing mouse genes are written in (Ran, Rps8).

Usage:
    python3 tools/build_essential_genes.py \
        /path/to/CRISPRInferredCommonEssentials.csv
"""
import csv, json, re, sys, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYNONYMS = os.path.join(HERE, "libraries", "human+mouse synonym.txt")
MOUSE_LIB = os.path.join(HERE, "libraries", "Julianna (mouse).txt")
HUMAN_LIB = os.path.join(HERE, "libraries", "Jacquere (human).txt")
OUT = os.path.join(HERE, "essentialGenes.json")
RELEASE = "26Q1"


def read_essentials(path):
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if not row or row[0].strip().lower() == "essentials":
                continue
            # "AAMP (14)" -> AAMP
            out.append(re.sub(r"\s*\(\d+\)\s*$", "", row[0].strip()).upper())
    return sorted(set(s for s in out if s))


def library_symbols(path, column):
    """symbol in lower case -> the spelling the library file uses."""
    seen = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        next(fh, None)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < column:
                continue
            sym = parts[column - 1].strip()
            if sym:
                seen.setdefault(sym.lower(), sym)
    return seen


def homology_groups(path):
    """lower-case symbol -> group id, and group id -> set of symbols."""
    by_symbol, by_group = {}, {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        next(fh, None)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4:
                continue
            name, group = parts[1].strip().lower(), parts[3].strip()
            if not name or not group.startswith("HOM:"):
                continue
            by_symbol[name] = group
            by_group.setdefault(group, set()).add(name)
    return by_symbol, by_group


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    human = read_essentials(sys.argv[1])
    by_symbol, by_group = homology_groups(SYNONYMS)
    mouse_lib = library_symbols(MOUSE_LIB, 2)
    human_lib = library_symbols(HUMAN_LIB, 2)

    mouse = set()
    for sym in human:
        group = by_symbol.get(sym.lower())
        if not group:
            continue
        for other in by_group.get(group, ()):
            # Any symbol in the same homology group that the mouse library
            # carries, in the library's own casing. Most mouse orthologues are
            # spelled like the human gene (Aamp for AAMP), so the human symbol
            # is not excluded here; only Trp53-style renamings differ.
            if other in mouse_lib:
                mouse.add(mouse_lib[other])

    data = {
        "_doc": ("Genes essential in nearly every cell line, used to mark rows "
                 "in the output. Human: DepMap inferred common essentials, "
                 f"{RELEASE}. Mouse: their orthologues, via the homology groups "
                 "in libraries/human+mouse synonym.txt, kept where the Julianna "
                 "mouse library carries the gene. Rebuild with "
                 "tools/build_essential_genes.py."),
        "source": f"DepMap {RELEASE} CRISPRInferredCommonEssentials",
        "human": human,
        "mouse": sorted(mouse),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=0)
        fh.write("\n")
    inlib = sum(1 for s in human if s.lower() in human_lib)
    print(f"human {len(human)} ({inlib} in Jacquere), mouse {len(data['mouse'])}")
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
