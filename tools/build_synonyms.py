#!/usr/bin/env python3
"""
Rebuild the synonym tables in libraries/.

    python3 tools/build_synonyms.py

Writes human synonym.txt, mouse synonym.txt and human+mouse synonym.txt from
HGNC (human nomenclature), MGI (mouse nomenclature) and MGI's human/mouse
homology report, keeping every edge the previous tables already had.

Why the files gained a gene-group column
----------------------------------------
The old tables were a flat "this spelling means that gene" list, and the app
made them symmetric, so an alias edge was followed in both directions. That is
right for a rename — a library still spelling the gene AARS should answer a
query for AARS1 — but wrong when a symbol is a current gene in its own right
AND a historical alias of a different one. HGNC really does list PIM1 as a
former alias of LONP1, so a query for the PIM1 kinase could return LONP1
guides, and the user would never know.

Column 4 now carries a gene group: an MGI homology class where one exists, so
orthologues share it, otherwise the HGNC or MGI accession. The app uses it to
tell "same gene, different spelling" from "different gene entirely", and
refuses the second when the query is itself an official symbol. Every official
symbol also gets a self row, which is what marks it as official.

Legacy edges from the previous tables are kept rather than dropped. They add
coverage for spellings the authorities do not list, and the group check
neutralises the harmful ones without needing to decide, edge by edge, which
were wrong.
"""

import csv, collections, io, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = "/tmp"
UA = {"User-Agent": "greenlisted-synonyms/1.0"}

SOURCES = {
    "hgnc.txt": "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
    "mrk.rpt": "https://www.informatics.jax.org/downloads/reports/MRK_List2.rpt",
    "mgi.rpt": "https://www.informatics.jax.org/downloads/reports/HOM_MouseHumanSequence.rpt",
}

HEADER = "Gene Synonym\tGene name\tGene type\tGene stable ID\tGene description"


def cached(name):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path) or os.path.getsize(path) < 10000:
        sys.stderr.write(f"  downloading {name}\n")
        req = urllib.request.Request(SOURCES[name], headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as fh:
            fh.write(r.read())
    return open(path, encoding="utf-8", errors="replace")


def main():
    os.chdir(ROOT)

    # ---- nomenclature -------------------------------------------------------
    human = {}   # symbol -> (gene id, [aliases])
    for r in csv.DictReader(cached("hgnc.txt"), delimiter="\t"):
        s = (r.get("symbol") or "").strip().upper()
        if not s:
            continue
        al = []
        for f in ("alias_symbol", "prev_symbol"):
            al += [a.strip().upper() for a in (r.get(f) or "").split("|") if a.strip()]
        human[s] = ((r.get("hgnc_id") or s).strip(), al)

    mouse = {}
    for r in csv.DictReader(cached("mrk.rpt"), delimiter="\t"):
        if (r.get("Marker Type") or "").strip() != "Gene":
            continue
        s = (r.get("Marker Symbol") or "").strip().upper()
        if not s:
            continue
        al = [a.strip().upper() for a in (r.get("Marker Synonyms (pipe-separated)") or "").split("|") if a.strip()]
        mouse[s] = ((r.get("MGI Accession ID") or s).strip(), al)

    # ---- orthologue groups --------------------------------------------------
    cls = collections.defaultdict(lambda: {"human": set(), "mouse": set()})
    for r in csv.DictReader(cached("mgi.rpt"), delimiter="\t"):
        k, org, s = r.get("DB Class Key"), (r.get("Common Organism Name") or ""), (r.get("Symbol") or "").strip().upper()
        if not k or not s:
            continue
        if org.startswith("human"):
            cls[k]["human"].add(s)
        elif org.startswith("mouse"):
            cls[k]["mouse"].add(s)

    group = {"human": {}, "mouse": {}}
    for k, g in cls.items():
        for s in g["human"]:
            if s in human:
                group["human"][s] = "HOM:" + k
        for s in g["mouse"]:
            if s in mouse:
                group["mouse"][s] = "HOM:" + k
    for s, (gid, _) in human.items():
        group["human"].setdefault(s, gid)
    for s, (gid, _) in mouse.items():
        group["mouse"].setdefault(s, gid)

    # ---- edges --------------------------------------------------------------
    # (alias, official symbol, group). A row where alias == symbol marks that
    # symbol as official, which is what lets the app refuse to resolve it away.
    def species_rows(table, species):
        rows = set()
        for s, (_gid, aliases) in table.items():
            g = group[species][s]
            rows.add((s, s, g))
            for a in aliases:
                if a != s:
                    rows.add((a, s, g))
        return rows

    human_rows = species_rows(human, "human")
    mouse_rows = species_rows(mouse, "mouse")

    cross_rows = set()
    for k, g in cls.items():
        for h in g["human"]:
            for m in g["mouse"]:
                if h in human and m in mouse:
                    cross_rows.add((h, m, "HOM:" + k))
                    cross_rows.add((m, h, "HOM:" + k))

    # ---- keep what the old tables knew that the authorities do not ----------
    def legacy(fname, allowed_targets, species_of_target):
        keep = set()
        path = os.path.join("libraries", fname)
        if not os.path.exists(path):
            return keep
        with open(path, encoding="utf-8", errors="replace") as fh:
            fh.readline()
            for line in fh:
                p = line.rstrip("\n").split("\t")
                if len(p) < 2:
                    continue
                a, b = p[0].strip().upper(), p[1].strip().upper()
                if not a or not b or a == b or b not in allowed_targets:
                    continue
                keep.add((a, b, species_of_target[b]))
        return keep

    human_rows |= legacy("human synonym.txt", human, group["human"])
    mouse_rows |= legacy("mouse synonym.txt", mouse, group["mouse"])
    combined_group = dict(group["human"]); combined_group.update(group["mouse"])
    both_tables = set(human) | set(mouse)
    cross_rows |= legacy("human+mouse synonym.txt", both_tables, combined_group)

    # ---- write --------------------------------------------------------------
    def write(fname, rows, note):
        path = os.path.join("libraries", fname)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(HEADER + "\n")
            for a, b, g in sorted(rows):
                fh.write(f"{a}\t{b}\tgene\t{g}\t{note}\n")
        return len(rows)

    n1 = write("human synonym.txt", human_rows, "HGNC")
    n2 = write("mouse synonym.txt", mouse_rows, "MGI")
    n3 = write("human+mouse synonym.txt", human_rows | mouse_rows | cross_rows, "HGNC/MGI")
    print(f"  human synonym.txt        {n1:>7} rows")
    print(f"  mouse synonym.txt        {n2:>7} rows")
    print(f"  human+mouse synonym.txt  {n3:>7} rows  ({len(cross_rows)} cross-species)")


if __name__ == "__main__":
    main()
