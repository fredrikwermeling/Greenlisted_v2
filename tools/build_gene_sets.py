#!/usr/bin/env python3
"""
Rebuild geneSets.json — the curated gene lists offered under "Curated lists…".

Run from the repository root:      python3 tools/build_gene_sets.py

geneSets.json is a build artefact, not hand-maintained. Re-run this when the
upstream sources publish new releases; it downloads everything it needs.

Sourcing note. DGIdb carries every functional category in one file and is
tempting to use throughout, but its coverage is uneven: its KINASE category
resolves to ~1850 genes against a canonical kinome of ~518, its PROTEIN
PHOSPHATASE category to only ~97 against a phosphatome of ~200, and its
DNA REPAIR category omits ATM, BRCA2, MLH1, NBN, LIG4 and PRKDC. So each
class is taken from whichever source actually curates it, and DGIdb is kept
only for the classes where its categorisation holds up (checked against
marker panels: cell surface, GPCRs, ion channels, transporters, proteases).

Every symbol is resolved against the union of symbols in the built-in human
libraries, directly or through libraries/human synonym.txt, so a list can
never suggest a gene no library can target.
"""

import csv, json, io, os, sys, urllib.parse, urllib.request, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "greenlisted-gene-sets/1.0"}

HUMAN_LIBS = {
    "Jacquere (human).txt": 2, "Brunello (human).txt": 2, "Gattinara (human).txt": 2,
    "VBC (human).txt": 1, "GeCKO v2 (human) A+B.txt": 1,
}


def fetch(url, label):
    sys.stderr.write(f"  fetching {label}\n")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8", "replace")


def uniprot(query, label):
    """Reviewed human proteins matching a UniProt query -> set of gene symbols."""
    url = ("https://rest.uniprot.org/uniprotkb/stream?query="
           + urllib.parse.quote(f"reviewed:true AND organism_id:9606 AND {query}")
           + "&format=tsv&fields=gene_primary")
    rows = fetch(url, label).splitlines()[1:]
    return {r.strip().upper() for r in rows if r.strip()}


def main():
    os.chdir(ROOT)

    # --- symbols any built-in human library can target -----------------------
    libsyms = set()
    for fname, symcol in HUMAN_LIBS.items():
        with open(f"libraries/{fname}", encoding="utf-8", errors="replace") as fh:
            fh.readline()
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= symcol:
                    libsyms.add(parts[symcol - 1].strip().upper())

    alias = {}
    with open("libraries/human synonym.txt", encoding="utf-8", errors="replace") as fh:
        fh.readline()
        for line in fh:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 2:
                a, b = p[0].strip().upper(), p[1].strip().upper()
                if a and b:
                    alias.setdefault(a, b)

    def resolve(name):
        n = (name or "").strip().upper()
        if not n:
            return None
        if n in libsyms:
            return n
        m = alias.get(n)
        return m if m and m in libsyms else None

    def resolved(names):
        return {r for r in (resolve(n) for n in names) if r}

    # --- per-class sources ---------------------------------------------------
    kinases = resolved(uniprot("keyword:KW-0723", "UniProt Ser/Thr kinases")
                       | uniprot("keyword:KW-0829", "UniProt Tyr kinases"))

    # GO:0006974 rather than the DNA repair keyword: the keyword covers repair
    # enzymes but drops the signalling and checkpoint layer, so ATM, TP53,
    # MDM2, CHEK2 and CDKN1A all fall out of a list users expect them in.
    ddr = resolved(uniprot("go:0006974", "UniProt GO DNA damage response"))

    tfs = resolved(fetch("https://humantfs.ccbr.utoronto.ca/download/v_1.01/TF_names_v_1.01.txt",
                         "Lambert human TFs").split())

    cancer = resolved(g["hugoSymbol"] for g in
                      json.loads(fetch("https://www.oncokb.org/api/v1/utils/cancerGeneList",
                                       "OncoKB cancer genes")))

    # HGNC protein-phosphatase groups. Catalytic and protein-directed only —
    # the regulatory-subunit groups would add ~200 genes that dephosphorylate
    # nothing themselves.
    PP_GROUPS = {
        "Atypical dual specificity phosphatases", "CDC14 phosphatases", "CTD family phosphatases",
        "Class II Cys-based phosphatases", "Class III Cys-based CDC25 phosphatases",
        "EYA transcriptional coactivator and phosphatases", "HAD Asp-based protein phosphatases",
        "LAR protein receptor tyrosine phosphatase family", "MAP kinase phosphatases",
        "PTEN protein phosphatases", "Protein phosphatase catalytic subunits", "Protein phosphatases",
        "Protein phosphatases, Mg2+/Mn2+ dependent", "Protein tyrosine phosphatase 4A family",
        "Protein tyrosine phosphatases non-receptor type", "Protein tyrosine phosphatases receptor type",
        "Serine/threonine phosphatases", "Slingshot protein phosphatases",
    }
    hgnc = fetch("https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
                 "HGNC complete set")
    phosphatases = resolved(
        r["symbol"] for r in csv.DictReader(io.StringIO(hgnc), delimiter="\t")
        if {g.strip() for g in (r.get("gene_group") or "").split("|")} & PP_GROUPS)

    dg_rows = list(csv.DictReader(io.StringIO(
        fetch("https://dgidb.org/data/latest/categories.tsv", "DGIdb categories")), delimiter="\t"))
    dg_ver = dg_rows[0]["source_db_version"] if dg_rows else "?"
    bycat = collections.defaultdict(set)
    for r in dg_rows:
        s = resolve(r["name"])
        if s:
            bycat[r["name-2"]].add(s)

    def dg(*cats):
        return set().union(*[bycat.get(c, set()) for c in cats])

    DGIDB = f"DGIdb categories ({dg_ver})"
    sets = [
        ("cancer", "Cancer genes", cancer,
         "Genes with an established role in cancer.", "OncoKB Cancer Gene List"),
        ("kinase", "Kinases", kinases,
         "The protein kinome — serine/threonine and tyrosine protein kinases.",
         "UniProt (reviewed human, kinase keywords)"),
        ("phosphatase", "Phosphatases", phosphatases,
         "Protein phosphatases, the counterparts to the kinases.", "HGNC gene groups"),
        ("tf", "Transcription factors", tfs,
         "Sequence-specific DNA-binding transcription factors.",
         "Lambert et al. 2018, The Human Transcription Factors"),
        ("ddr", "DNA damage response & repair", ddr,
         "Repair enzymes plus the checkpoint and signalling layer — includes TP53, MDM2, CHEK2 and ATM.",
         "UniProt (GO:0006974)"),
        ("surface", "Cell surface", dg("CELL SURFACE", "EXTERNAL SIDE OF PLASMA MEMBRANE"),
         "Proteins at the cell surface — the fraction reachable by antibodies and CAR targets.", DGIDB),
        ("druggable", "Druggable genome", dg("DRUGGABLE GENOME", "CLINICALLY ACTIONABLE"),
         "Genes whose products are considered tractable to small molecules or biologics.", DGIDB),
        ("gpcr", "GPCRs", dg("G PROTEIN COUPLED RECEPTOR"), "G protein-coupled receptors.", DGIDB),
        ("ionchannel", "Ion channels", dg("ION CHANNEL"), "Ion channels.", DGIDB),
        ("transporter", "Transporters", dg("TRANSPORTER", "ABC TRANSPORTER"),
         "Solute carriers and ABC transporters.", DGIDB),
        ("protease", "Proteases", dg("PROTEASE"), "Proteases and peptidases.", DGIDB),
    ]

    out = {
        "_doc": "Curated gene lists for the Green Listed symbol box. Built by "
                "tools/build_gene_sets.py; do not edit by hand. Every symbol is resolved "
                "against the built-in human libraries (directly or through the human synonym "
                "table), so each list holds only genes at least one library can target. "
                "These are starting points to edit, not definitive gene families.",
        "sets": [{"key": k, "label": l, "description": d, "source": s, "genes": sorted(g)}
                 for k, l, g, d, s in sets if g],
    }
    with open("geneSets.json", "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    for s in out["sets"]:
        print(f"  {len(s['genes']):>5}  {s['label']:<30} [{s['source']}]")
    print(f"\ngeneSets.json: {round(os.path.getsize('geneSets.json')/1024)} KB")


if __name__ == "__main__":
    main()
