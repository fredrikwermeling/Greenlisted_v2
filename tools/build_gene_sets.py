#!/usr/bin/env python3
"""
Rebuild geneSets.json — the curated gene lists offered under "Curated lists…".

Run from the repository root:      python3 tools/build_gene_sets.py

geneSets.json is a build artefact, not hand-maintained. Re-run this when the
upstream sources publish new releases; it downloads everything it needs.

Two species. The picker shows the lists matching the selected library, so
every set is built for human and for mouse. Where a source is a UniProt
keyword or GO term the mouse list is queried natively rather than projected,
which is more accurate; the human-only sources (Human Protein Atlas, OncoKB,
Lambert, HGNC) are mapped through MGI's human/mouse homology report, so those
mouse lists lose the genes with no one-to-one orthologue.

Sourcing note. DGIdb carries every functional category in one file and was
tempting to use throughout, but its category data is stamped Feb-14 and its
coverage is uneven: KINASE resolved to ~1850 genes against a kinome of ~518,
PROTEIN PHOSPHATASE to ~97 against a phosphatome of ~200, and DNA REPAIR
omitted ATM, BRCA2, MLH1, NBN, LIG4 and PRKDC. It is no longer used.

Each class comes from whichever source actually curates it, and each list is
checked against a panel of genes it must obviously contain (see AUDIT below)
before it ships. Choices settled that way:

  * Cell surface means surface-EXPOSED, not merely plasma-membrane located.
    UniProt's Cell membrane keyword alone admits KRAS, HRAS, SRC, RHOA and
    GNAS — lipid-anchored proteins facing the cytoplasm that no antibody or
    CAR can reach. The list is the union of two definitions that disagree at
    the margins and neither of which is complete on its own:
      - the in silico human surfaceome (Bausch-Fluck 2018, vendored in
        tools/data/), which is a machine-learning prediction and so has false
        negatives — TFRC, CD3E and SLC7A11 are all absent from it;
      - UniProt cell membrane AND (transmembrane OR GPI anchor), which catches
        those but misses ~570 that SURFY includes.
    Union is the right bias for a list meant to be edited down: a missing
    surface target costs more than one the user deletes. It contains none of
    the inner-leaflet proteins above.
  * HPA's membrane class intersected with its antibody-based plasma-membrane
    localisation was tried first and dropped CD19, PDCD1 and TFRC — the
    localisation data is too sparse to gate on.
  * HPA's ion channel class covers only voltage-gated channels (132 genes,
    no PIEZO1 or ORAI1), so ion channels use a UniProt keyword.
  * HPA's "RAS pathway related proteins" was rejected outright: it contains
    RAF1 but neither BRAF nor ARAF, and a RAS-pathway list missing that
    pathway's canonical drug target would mislead more than help.

Every symbol is resolved against the union of symbols in that species' built-in
libraries, directly or through the matching synonym table, so a list can never
suggest a gene no library can target.
"""

import csv, json, io, os, sys, urllib.parse, urllib.request, zipfile, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "greenlisted-gene-sets/1.0"}

LIBS = {
    "Human": ({"Jacquere (human).txt": 2, "Brunello (human).txt": 2, "Gattinara (human).txt": 2,
               "VBC (human).txt": 1, "GeCKO v2 (human) A+B.txt": 1}, "human synonym.txt", 9606),
    "Mouse": ({"Julianna (mouse).txt": 2, "Brie (mouse).txt": 2, "Gouda (mouse).txt": 2,
               "VBC (mouse).txt": 1, "GeCKO v2 (mouse) A+B.txt": 1}, "mouse synonym.txt", 10090),
}

# Genes each list must obviously contain. A list that fails its panel is a
# sourcing mistake, not a judgement call — this is the check that caught
# DGIdb's DNA repair category omitting ATM, BRCA2, MLH1 and PRKDC.
AUDIT = {
    "cancer": ["TP53", "KRAS", "MYC", "BRAF", "PTEN", "RB1"],
    "kinase": ["CDK1", "PLK1", "AURKA", "ATM", "MTOR", "SRC"],
    "phosphatase": ["PTEN", "PTPN11", "PPP1CA", "CDC25A"],
    "tf": ["MYC", "SOX2", "STAT3", "GATA1"],
    "ddr": ["TP53", "MDM2", "CHEK2", "ATM", "BRCA2", "MLH1", "NBN", "LIG4", "PRKDC"],
    "surface": ["CD19", "PDCD1", "CD274", "EGFR", "ERBB2", "CD55", "THY1"],
    "cd": ["CD19", "CD4", "CD8A", "PTPRC"],
    "druggable": ["EGFR", "PARP1", "BCL2"],
    "fda": ["EGFR", "ERBB2", "HMGCR"],
    "gpcr": ["CXCR4", "SMO", "ADRB2"],
    "ionchannel": ["CFTR", "PIEZO1", "ORAI1", "TRPV1"],
    "transporter": ["SLC7A11", "ABCB1", "SLC2A1"],
    "protease": ["CASP3", "ADAM17", "BACE1"],
}
def fetch(url, label):
    sys.stderr.write(f"  fetching {label}\n")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def text(url, label):
    return fetch(url, label).decode("utf-8", "replace")


def uniprot(query, organism, label):
    """Reviewed proteins of one organism matching a UniProt query -> gene symbols."""
    url = ("https://rest.uniprot.org/uniprotkb/stream?query="
           + urllib.parse.quote(f"reviewed:true AND organism_id:{organism} AND {query}")
           + "&format=tsv&fields=gene_primary")
    return {r.strip().upper() for r in text(url, label).splitlines()[1:] if r.strip()}


def main():
    os.chdir(ROOT)

    # Nomenclature authorities, fetched first because the resolvers below need
    # their synonym tables. UniProt and the libraries do not always agree on a
    # symbol — UniProt calls mouse p53 "Tp53" where MGI and every mouse library
    # call it "Trp53" — and without this layer ~6% of each mouse list silently
    # failed to resolve, p53 among them.
    hgnc_txt = text("https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
                    "HGNC complete set")
    mgi_markers = text("https://www.informatics.jax.org/downloads/reports/MRK_List2.rpt",
                       "MGI marker list")

    authority_alias = {"Human": {}, "Mouse": {}}
    for r in csv.DictReader(io.StringIO(hgnc_txt), delimiter="\t"):
        sym = (r.get("symbol") or "").strip().upper()
        if not sym:
            continue
        for field in ("alias_symbol", "prev_symbol"):
            for a in (r.get(field) or "").split("|"):
                a = a.strip().upper()
                if a:
                    authority_alias["Human"].setdefault(a, sym)
    for r in csv.DictReader(io.StringIO(mgi_markers), delimiter="\t"):
        sym = (r.get("Marker Symbol") or "").strip().upper()
        if not sym:
            continue
        for a in (r.get("Marker Synonyms (pipe-separated)") or "").split("|"):
            a = a.strip().upper()
            if a:
                authority_alias["Mouse"].setdefault(a, sym)

    # --- what each species' libraries can target -----------------------------
    resolvers = {}
    for species, (libfiles, synfile, _org) in LIBS.items():
        # Upper-case key -> the library's own spelling, so the lists come out in
        # the right nomenclature: HUGO upper-case for human, MGI sentence-case
        # for mouse (Trp53, not TRP53). Matching stays case-insensitive.
        libsyms = {}
        for fname, symcol in libfiles.items():
            with open(f"libraries/{fname}", encoding="utf-8", errors="replace") as fh:
                fh.readline()
                for line in fh:
                    parts = line.rstrip("\n").split("\t")
                    if len(parts) >= symcol:
                        sym = parts[symcol - 1].strip()
                        if sym:
                            libsyms.setdefault(sym.upper(), sym)
        alias = {}
        with open(f"libraries/{synfile}", encoding="utf-8", errors="replace") as fh:
            fh.readline()
            for line in fh:
                p = line.rstrip("\n").split("\t")
                if len(p) >= 2:
                    a, b = p[0].strip().upper(), p[1].strip().upper()
                    if a and b:
                        alias.setdefault(a, b)

        def make(libsyms=libsyms, alias=alias, auth=authority_alias[species]):
            def resolve(name):
                n = (name or "").strip().upper()
                if not n:
                    return None
                if n in libsyms:
                    return libsyms[n]
                for table in (alias, auth):
                    m = table.get(n)
                    if m and m in libsyms:
                        return libsyms[m]
                return None
            return lambda names: {r for r in (resolve(x) for x in names) if r}
        resolvers[species] = make()

    # --- human -> mouse orthologues, from MGI's homology report ---------------
    mgi = text("https://www.informatics.jax.org/downloads/reports/HOM_MouseHumanSequence.rpt",
               "MGI human/mouse homology")
    byclass = collections.defaultdict(lambda: {"human": set(), "mouse": set()})
    for r in csv.DictReader(io.StringIO(mgi), delimiter="\t"):
        key, org, sym = r.get("DB Class Key"), (r.get("Common Organism Name") or ""), r.get("Symbol")
        if not key or not sym:
            continue
        if org.startswith("human"):
            byclass[key]["human"].add(sym.upper())
        elif org.startswith("mouse"):
            byclass[key]["mouse"].add(sym.upper())
    h2m = collections.defaultdict(set)
    for grp in byclass.values():
        for h in grp["human"]:
            h2m[h] |= grp["mouse"]

    def to_mouse(human_symbols):
        out = set()
        for h in human_symbols:
            out |= h2m.get(h.upper(), set())
        return out

    # --- sources -------------------------------------------------------------
    KINASE_Q = "(keyword:KW-0723 OR keyword:KW-0829)"
    SURFACE_Q = "keyword:KW-1003 AND (keyword:KW-0812 OR keyword:KW-0336)"

    # SURFY entry names -> gene symbols, through UniProt's own id/gene table.
    entry_to_gene = {}
    for line in text("https://rest.uniprot.org/uniprotkb/stream?query=reviewed:true+AND+"
                     "organism_id:9606&format=tsv&fields=id,gene_primary",
                     "UniProt entry-name map").splitlines()[1:]:
        cols = line.rstrip("\n").split("\t")
        if len(cols) >= 2 and cols[0].strip() and cols[1].strip():
            entry_to_gene[cols[0].strip().upper()] = cols[1].strip().upper()
    with open(os.path.join(ROOT, "tools", "data", "surfaceome_ids.txt")) as fh:
        surfy = {entry_to_gene[e] for e in (l.strip().upper() for l in fh)
                 if e and e in entry_to_gene}
    sys.stderr.write(f"  SURFY: {len(surfy)} of 2886 entry names mapped to symbols\n")

    hpa_zip = fetch("https://www.proteinatlas.org/download/proteinatlas.tsv.zip",
                    "Human Protein Atlas")
    with zipfile.ZipFile(io.BytesIO(hpa_zip)) as z:
        with z.open("proteinatlas.tsv") as fh:
            hpa_rows = list(csv.DictReader(io.TextIOWrapper(fh, "utf-8"), delimiter="\t"))

    def hpa(*classes):
        want = set(classes)
        return {r["Gene"].upper() for r in hpa_rows
                if want & {c.strip() for c in (r.get("Protein class") or "").split(",")}}

    cancer_h = {g["hugoSymbol"].upper() for g in json.loads(
        text("https://www.oncokb.org/api/v1/utils/cancerGeneList", "OncoKB cancer genes"))}

    tf_h = {s.upper() for s in text(
        "https://humantfs.ccbr.utoronto.ca/download/v_1.01/TF_names_v_1.01.txt",
        "Lambert human TFs").split() if s.strip()}

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
    pp_h = {r["symbol"].upper() for r in csv.DictReader(io.StringIO(hgnc_txt), delimiter="\t")
            if {g.strip() for g in (r.get("gene_group") or "").split("|")} & PP_GROUPS}

    # (key, label, description, source, human symbols, mouse symbols)
    UP = "UniProt"
    HPA_SRC = "Human Protein Atlas protein classes"
    ORTHO = " (mouse via MGI orthologues)"
    SPECS = [
        ("cancer", "Cancer genes", "Genes with an established role in cancer.",
         "OncoKB Cancer Gene List", cancer_h, to_mouse(cancer_h), True),
        ("kinase", "Kinases", "The protein kinome — serine/threonine and tyrosine protein kinases.",
         f"{UP} (kinase keywords)",
         uniprot(KINASE_Q, 9606, "UniProt kinases, human"),
         uniprot(KINASE_Q, 10090, "UniProt kinases, mouse"), False),
        ("phosphatase", "Phosphatases", "Protein phosphatases, the counterparts to the kinases.",
         "HGNC gene groups", pp_h, to_mouse(pp_h), True),
        ("tf", "Transcription factors", "Sequence-specific DNA-binding transcription factors.",
         "Lambert et al. 2018, The Human Transcription Factors", tf_h, to_mouse(tf_h), True),
        ("ddr", "DNA damage response & repair",
         "Repair enzymes plus the checkpoint and signalling layer — includes TP53, MDM2, CHEK2 and ATM.",
         f"{UP} (GO:0006974)",
         uniprot("go:0006974", 9606, "UniProt DDR, human"),
         uniprot("go:0006974", 10090, "UniProt DDR, mouse"), False),
        ("surface", "Cell surface",
         "Surface-exposed proteins — the fraction an antibody or CAR can actually reach, "
         "excluding lipid-anchored proteins that face the cytoplasm.",
         "SURFY surfaceome (Bausch-Fluck 2018) + UniProt topology",
         surfy | uniprot(SURFACE_Q, 9606, "UniProt surfaceome, human"),
         uniprot(SURFACE_Q, 10090, "UniProt surfaceome, mouse"), False),
        ("cd", "CD markers", "Cluster-of-differentiation surface markers used to type and sort cells.",
         HPA_SRC, hpa("CD markers"), to_mouse(hpa("CD markers")), True),
        ("druggable", "Druggable genome",
         "Targets of an approved drug, plus those judged tractable to small molecules or biologics.",
         HPA_SRC, hpa("FDA approved drug targets", "Potential drug targets"),
         to_mouse(hpa("FDA approved drug targets", "Potential drug targets")), True),
        ("fda", "FDA-approved drug targets",
         "Proteins targeted by a drug already approved for clinical use.",
         HPA_SRC, hpa("FDA approved drug targets"), to_mouse(hpa("FDA approved drug targets")), True),
        ("gpcr", "GPCRs", "G protein-coupled receptors.",
         HPA_SRC, hpa("G-protein coupled receptors"), to_mouse(hpa("G-protein coupled receptors")), True),
        ("ionchannel", "Ion channels",
         "Ion channels — voltage-gated, ligand-gated and mechanosensitive.",
         f"{UP} (ion channel keyword)",
         uniprot("keyword:KW-0407", 9606, "UniProt ion channels, human"),
         uniprot("keyword:KW-0407", 10090, "UniProt ion channels, mouse"), False),
        ("transporter", "Transporters", "Solute carriers, ABC transporters and pumps.",
         HPA_SRC, hpa("Transporters"), to_mouse(hpa("Transporters")), True),
        ("protease", "Proteases", "Proteases and peptidases.",
         f"{UP} (protease keyword)",
         uniprot("keyword:KW-0645", 9606, "UniProt proteases, human"),
         uniprot("keyword:KW-0645", 10090, "UniProt proteases, mouse"), False),
    ]

    species_sets = {"Human": [], "Mouse": []}
    for key, label, desc, source, human, mouse, projected in SPECS:
        if not projected:
            # Native mouse query UNION the orthologues of the human result.
            # Neither alone is complete: UniProt returns mouse p53 as "Tp53"
            # while MGI and the libraries call it "Trp53", and MGI lists that
            # gene's synonyms as p53|p44 — so no synonym table bridges the two
            # and Trp53 fell out of every native mouse list. The union closes
            # that class of gap for a handful of extra genes.
            mouse = mouse | to_mouse(human)
        for species, raw in (("Human", human), ("Mouse", mouse)):
            genes = sorted(resolvers[species](raw))
            if not genes:
                continue
            species_sets[species].append({
                "key": key, "label": label, "description": desc,
                "source": source + (ORTHO if (projected and species == "Mouse") else (" (mouse: native + MGI orthologues)" if species == "Mouse" else "")),
                "genes": genes,
            })

    out = {
        "_doc": "Curated gene lists for the Green Listed symbol box. Built by "
                "tools/build_gene_sets.py; do not edit by hand. Lists are per species and "
                "every symbol is resolved against that species' built-in libraries, so a "
                "list can only ever suggest genes some library can target. These are "
                "starting points to edit, not definitive gene families.",
        "species": species_sets,
    }
    with open("geneSets.json", "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    # --- report + audit ------------------------------------------------------
    print()
    for species in ("Human", "Mouse"):
        print(f"--- {species} ---")
        for s in species_sets[species]:
            names = {g.upper() for g in s["genes"]}
            want = AUDIT.get(s["key"], [])
            if species == "Mouse":
                # any orthologue counts — human CD55 maps to both Cd55 and
                # Cd55b, and requiring both would flag a list that is fine
                want = [sorted(h2m.get(w, {w})) for w in want]
            else:
                want = [[w] for w in want]
            missing = [w for w in want if not (set(w) & names)]
            flag = f"   MISSING {missing}" if missing else ""
            print(f"  {len(s['genes']):>5}  {s['label']:<30} [{s['source']}]{flag}")
        print()
    print(f"geneSets.json: {round(os.path.getsize('geneSets.json')/1024)} KB")


if __name__ == "__main__":
    main()
