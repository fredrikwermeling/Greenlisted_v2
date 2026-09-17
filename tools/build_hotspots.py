#!/usr/bin/env python3
"""
Build hotspotMutations.json: which genes carry a known hotspot mutation in
which human cell line.

Two DepMap tables, for two different things:

  OmicsSomaticMutationsMatrixHotspot.csv — the hotspot call itself, gene by
  cell line. 554 genes, and a line carries about two of them on average, so
  the whole thing is a short list per line rather than a matrix.

  OmicsInferredMolecularSubtypes.csv — the handful of variants DepMap names
  outright (KRAS p.G12D, BRAF p.V600E, EGFR p.L858R and so on). Where one of
  those applies, the name is carried through, since "BRAF p.V600E in A-375"
  says something "BRAF hotspot" does not.

Only the model's default entry is read: a line sequenced more than once
otherwise appears several times with different calls.

Usage:
    python3 tools/build_hotspots.py <DepMap release directory>
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "hotspotMutations.json")
RELEASE = "26Q1"


def read_hotspot_matrix(path):
    """cell line id -> set of gene symbols with a hotspot call."""
    out = {}
    with open(path, newline="", encoding="utf-8") as fh:
        r = csv.reader(fh)
        hdr = next(r)
        model_i = hdr.index("ModelID")
        default_i = hdr.index("IsDefaultEntryForModel")
        # Gene columns are written "TP53 (7157)".
        genes = [(i, h.split(" (")[0]) for i, h in enumerate(hdr)
                 if i > default_i and re.match(r"^[A-Za-z0-9_.-]+ \(\d+\)$", h)]
        for row in r:
            if row[default_i] != "Yes":
                continue
            hit = {g for i, g in genes if row[i] not in ("", "0", "0.0")}
            if hit:
                out[row[model_i]] = hit
    return out


def read_named_variants(path):
    """cell line id -> {gene: variant}, for the variants DepMap names."""
    out = {}
    with open(path, newline="", encoding="utf-8") as fh:
        r = csv.reader(fh)
        hdr = next(r)
        # "KRAS p.G12D" and "ALK Hotspot" are variants; "EWSR1-FLI1" is a
        # fusion and belongs to a different question.
        cols = []
        for i, h in enumerate(hdr):
            m = re.match(r"^([A-Z0-9orf-]+) (p\.[A-Za-z0-9*]+|exon \d+ del|Hotspot)$", h)
            if m:
                cols.append((i, m.group(1), m.group(2)))
        for row in r:
            named = {}
            for i, gene, variant in cols:
                if i < len(row) and row[i] == "True":
                    # A line can be positive for both "KRAS p.G12D" and the
                    # broader "KRAS p.G12"; the specific one wins.
                    if gene not in named or len(variant) > len(named[gene]):
                        named[gene] = variant
            if named:
                out[row[0]] = named
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    d = sys.argv[1]
    hotspots = read_hotspot_matrix(os.path.join(d, "OmicsSomaticMutationsMatrixHotspot.csv"))
    named = read_named_variants(os.path.join(d, "OmicsInferredMolecularSubtypes.csv"))

    genes = sorted({g for s in hotspots.values() for g in s})
    index = {g: i for i, g in enumerate(genes)}
    by_line = {cl: sorted(index[g] for g in s) for cl, s in hotspots.items()}
    # Named variants only for lines and genes that also carry the call, so the
    # two tables cannot disagree in the file.
    named_out = {}
    for cl, variants in named.items():
        keep = {g: v for g, v in variants.items() if g in hotspots.get(cl, ())}
        if keep:
            named_out[cl] = keep

    data = {
        "_doc": ("Genes carrying a known hotspot mutation, per human cell line. "
                 "genes is the symbol list; byCellLine holds indexes into it; "
                 "named carries the variant where DepMap names one. Rebuild with "
                 "tools/build_hotspots.py."),
        "source": f"DepMap {RELEASE}: OmicsSomaticMutationsMatrixHotspot, with named variants from OmicsInferredMolecularSubtypes",
        "genes": genes,
        "byCellLine": by_line,
        "named": named_out,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"{len(genes)} genes, {len(by_line)} cell lines, {len(named_out)} with a named variant")
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
