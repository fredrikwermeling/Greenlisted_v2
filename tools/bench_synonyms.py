#!/usr/bin/env python3
"""
Benchmark symbol resolution between libraries.

    python3 tools/bench_synonyms.py

Takes every gene symbol in library A and looks it up in library B, exactly as
the app would, then reports how many resolve and — more importantly — how many
resolve to the WRONG gene. Run before and after a change to the synonym tables
or the resolution policy.

Pairs cover human->human, mouse->mouse and human<->mouse, because each stresses
a different part of the machinery: same-species pairs test alias and rename
handling, cross-species pairs test orthologue mapping.

Correctness is judged against the nomenclature authorities, not against the
synonym files being tested:
  * same species — a resolution is right if query and target are the same gene
    (HGNC/MGI id), i.e. an alias or a rename;
  * cross species — right if they are orthologues in MGI's homology report.
A resolution to any other gene is counted as wrong, which is the failure mode
that matters: the user asked for one gene and silently received another.
"""

import csv, collections, os, sys

USE_GROUPS = os.environ.get("NO_GROUPS") != "1"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = "/tmp"

LIB = {  # name: (file, symbol column, species)
    "Jacquere":  ("Jacquere (human).txt", 2, "human"),
    "Brunello":  ("Brunello (human).txt", 2, "human"),
    "Gattinara": ("Gattinara (human).txt", 2, "human"),
    "GeCKOv2-h": ("GeCKO v2 (human) A+B.txt", 1, "human"),
    "Julianna":  ("Julianna (mouse).txt", 2, "mouse"),
    "Brie":      ("Brie (mouse).txt", 2, "mouse"),
    "Gouda":     ("Gouda (mouse).txt", 2, "mouse"),
    "GeCKOv2-m": ("GeCKO v2 (mouse) A+B.txt", 1, "mouse"),
}

PAIRS = [
    ("Jacquere", "Brunello"), ("Jacquere", "Gattinara"), ("Jacquere", "GeCKOv2-h"),
    ("Julianna", "Brie"), ("Julianna", "Gouda"), ("Julianna", "GeCKOv2-m"),
    ("Jacquere", "Julianna"), ("Julianna", "Jacquere"),
]


def libsyms(name):
    fname, col, _ = LIB[name]
    out = set()
    with open(os.path.join(ROOT, "libraries", fname), encoding="utf-8", errors="replace") as fh:
        fh.readline()
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) >= col and p[col - 1].strip():
                out.add(p[col - 1].strip().upper())
    return out


def load_synonyms(fname):
    """Exactly what library.js does: symmetric map, plus the gene-group columns."""
    m = collections.defaultdict(set)
    groups = collections.defaultdict(set)
    own = {}
    with open(os.path.join(ROOT, "libraries", fname), encoding="utf-8", errors="replace") as fh:
        fh.readline()
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 2 and p[0].strip() and p[1].strip():
                a, b = p[0].strip().upper(), p[1].strip().upper()
                m[a].add(b)
                m[b].add(a)
                g = p[3].strip() if len(p) > 3 else ""
                if g:
                    groups[a].add(g)
                    groups[b].add(g)
                    if a == b:
                        own[a] = g
    return m, groups, own


def resolve(q, library, syn, groups, own, use_groups):
    """The app's matcher: candidates in the library, filtered by gene group."""
    cand = syn.get(q, set()) & library
    if not (use_groups and own.get(q)):
        return cand
    g = own[q]
    return {c for c in cand if (own[c] == g if c in own else g in groups.get(c, set()))}


def truth():
    """
    symbol -> set of gene ids, and canonical symbols -> orthologues.

    A symbol maps to its own gene when it is a current official symbol, and
    otherwise to every gene that lists it as an alias or previous symbol. That
    second case is what makes a rename count as correct: a library still
    spelling the gene AARS is the same gene as a query for AARS1, even though
    AARS is no longer an official symbol.
    """
    official = {"human": {}, "mouse": {}}
    alias = {"human": collections.defaultdict(set), "mouse": collections.defaultdict(set)}
    for r in csv.DictReader(open(f"{CACHE}/hgnc.txt", encoding="utf-8", errors="replace"), delimiter="\t"):
        s = (r.get("symbol") or "").strip().upper()
        if not s:
            continue
        gid = r.get("hgnc_id") or s
        official["human"][s] = gid
        for f in ("alias_symbol", "prev_symbol"):
            for a in (r.get(f) or "").split("|"):
                a = a.strip().upper()
                if a:
                    alias["human"][a].add(gid)
    for r in csv.DictReader(open(f"{CACHE}/mrk.rpt", encoding="utf-8", errors="replace"), delimiter="\t"):
        if (r.get("Marker Type") or "").strip() != "Gene":
            continue
        s = (r.get("Marker Symbol") or "").strip().upper()
        if not s:
            continue
        gid = r.get("MGI Accession ID") or s
        official["mouse"][s] = gid
        for a in (r.get("Marker Synonyms (pipe-separated)") or "").split("|"):
            a = a.strip().upper()
            if a:
                alias["mouse"][a].add(gid)

    def ids(sym, species):
        if sym in official[species]:
            return {official[species][sym]}
        return set(alias[species].get(sym, ()))

    def canon(sym, species):
        """Current official symbol(s) this spelling refers to."""
        if sym in official[species]:
            return {sym}
        want = alias[species].get(sym, set())
        return {s for s, g in official[species].items() if g in want} if want else set()

    grp = collections.defaultdict(lambda: {"human": set(), "mouse": set()})
    for r in csv.DictReader(open(f"{CACHE}/mgi.rpt", encoding="utf-8", errors="replace"), delimiter="\t"):
        k, org, s = r.get("DB Class Key"), (r.get("Common Organism Name") or ""), (r.get("Symbol") or "").upper()
        if not k or not s:
            continue
        if org.startswith("human"):
            grp[k]["human"].add(s)
        elif org.startswith("mouse"):
            grp[k]["mouse"].add(s)
    ortho = collections.defaultdict(set)
    for g in grp.values():
        for h in g["human"]:
            ortho[h] |= g["mouse"]
        for m in g["mouse"]:
            ortho[m] |= g["human"]
    return ids, canon, ortho


def run(label):
    ids, canon, ortho = truth()
    print(f"\n================  {label}  ================")
    print(f"{'pair':<24}{'queries':>8}{'direct':>8}{'via syn':>9}{'unres':>8}{'WRONG':>7}")
    totals = collections.Counter()
    for a, b in PAIRS:
        A, B = libsyms(a), libsyms(b)
        sa, sb = LIB[a][2], LIB[b][2]
        # the app picks the synonym list from the library's species
        table = ("human synonym.txt" if sa == "human" else "mouse synonym.txt") if sa == sb \
                else "human+mouse synonym.txt"
        syn, groups, own = load_synonyms(table)
        direct = viasyn = unres = wrong = 0
        for q in A:
            if q in B:
                direct += 1
                continue
            cand = resolve(q, B, syn, groups, own, USE_GROUPS)
            if not cand:
                unres += 1
                continue
            viasyn += 1
            # is any candidate the same gene / an orthologue?
            if sa == sb:
                qi = ids(q, sa)
                ok = (not qi) or any(ids(c, sb) & qi for c in cand)
            else:
                qc = set().union(*[ortho.get(x, set()) for x in canon(q, sa)]) if canon(q, sa) else set()
                ok = (not qc) or any(canon(c, sb) & qc for c in cand)
            if not ok:
                wrong += 1
        print(f"{a+' -> '+b:<24}{len(A):>8}{direct:>8}{viasyn:>9}{unres:>8}{wrong:>7}")
        totals["q"] += len(A); totals["direct"] += direct
        totals["syn"] += viasyn; totals["unres"] += unres; totals["wrong"] += wrong
    q = totals["q"]
    print(f"{'TOTAL':<24}{q:>8}{totals['direct']:>8}{totals['syn']:>9}{totals['unres']:>8}{totals['wrong']:>7}")
    print(f"  resolved {100*(totals['direct']+totals['syn'])/q:.1f}%   "
          f"of the synonym resolutions, {100*totals['wrong']/max(1,totals['syn']):.1f}% went to the wrong gene")
    return totals


if __name__ == "__main__":
    run("groups ON" if USE_GROUPS else "groups OFF")
