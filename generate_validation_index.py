#!/usr/bin/env python3
"""
Generates species-specific sgRNA validation index files from all built-in CRISPR libraries.
  - libraries/sgRNA_validation_index_human.txt
  - libraries/sgRNA_validation_index_mouse.txt

This index is used by the Validate sgRNA feature for reverse lookup (sgRNA → gene).
Sequences sourced from Addgene (addgene.org) and Broad Institute GPP
(portals.broadinstitute.org/gpp/public/pool/index).

Usage: python3 generate_validation_index.py
"""

import json
import os
import sys

try:
    import openpyxl
except ImportError:
    print("openpyxl is required: pip3 install openpyxl", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "settingsLibraries.json")
OUTPUT_FILE_HUMAN = os.path.join(SCRIPT_DIR, "libraries", "sgRNA_validation_index_human.txt")
OUTPUT_FILE_MOUSE = os.path.join(SCRIPT_DIR, "libraries", "sgRNA_validation_index_mouse.txt")

# Libraries classified by species (based on synonymName in settingsLibraries.json)
HUMAN_LIBRARIES = {
    "Brunello (human)",
    "GeCKO v2 (human) A+B",
    "Gattinara (human)",
    "Jacquere (human)",
    "VBC (human)",
}

MOUSE_LIBRARIES = {
    "Brie (mouse)",
    "GeCKO v2 (mouse) A+B",
    "Gouda (mouse)",
    "Julianna (mouse)",
    "VBC (mouse)",
}

# Validation-only libraries (XLSX files from Addgene, not used for screen design)
VALIDATION_ONLY_XLSX = [
    {
        "name": "Yusa Human v1",
        "species": "human",
        "file": "libraries/yusa_human_v1_raw.xlsx",
        "gene_col": "Gene",
        "seq_col": "Guide_sequence",
    },
    {
        "name": "Yusa Mouse v2",
        "species": "mouse",
        "file": "libraries/yusa_mouse_v2_raw.xlsx",
        "gene_col": "gene",
        "seq_col": "guide_sequence",
    },
    {
        "name": "TKOv3 (human)",
        "species": "human",
        "file": "libraries/tkov3_raw.xlsx",
        "gene_col": "GENE",
        "seq_col": "SEQUENCE",
    },
    {
        "name": "mTKO (mouse)",
        "species": "mouse",
        "file": "libraries/mtko_raw.xlsx",
        "gene_col": "GENE",
        "seq_col": "SEQUENCE",
    },
    {
        "name": "MinLibCas9 (human)",
        "species": "human",
        "file": "libraries/minlibcas9_raw.xlsx",
        "gene_col": "Approved_Symbol",
        "seq_col": "WGE_Sequence",
        "trim_pam": 3,  # sequence includes 3bp PAM at end
    },
]

# Map of known score column header names
SCORE_HEADERS = {
    "Rule Set 2 score",
    "On-Target Efficacy Score",
    "Aggregate CFD Score",
    "VBC score",
}


def detect_score_columns(headers):
    """Return list of (column_index, header_name) for recognized score columns."""
    result = []
    for i, h in enumerate(headers):
        if h.strip() in SCORE_HEADERS:
            result.append((i, h.strip()))
    return result


def detect_gene_id_column(headers, symbol_col_idx, rna_col_idx):
    """Try to find a Gene ID column from the headers."""
    id_keywords = ["gene id", "gene_id", "target gene id", "annotated gene id"]
    for i, h in enumerate(headers):
        if h.strip().lower() in id_keywords and i != symbol_col_idx and i != rna_col_idx:
            return i
    # Fallback: for Brie/Brunello, column 0 is "Target Gene ID"
    for i, h in enumerate(headers):
        if "gene id" in h.strip().lower() and i != symbol_col_idx and i != rna_col_idx:
            return i
    return None


def process_library(lib_config):
    """Process a single library file and return list of index rows."""
    name = lib_config["name"]
    filepath = os.path.join(SCRIPT_DIR, lib_config["fileName"])
    # settingsLibraries.json uses 1-based column indices
    symbol_col = lib_config["symbolColumn"] - 1
    rna_col = lib_config["RNAColumn"] - 1

    if not os.path.exists(filepath):
        print(f"  WARNING: File not found: {filepath}", file=sys.stderr)
        return []

    rows = []
    with open(filepath, "r", encoding="utf-8") as f:
        header_line = f.readline().rstrip("\n\r")
        headers = header_line.split("\t")
        score_cols = detect_score_columns(headers)
        gene_id_col = detect_gene_id_column(headers, symbol_col, rna_col)

        line_num = 1
        for line in f:
            line_num += 1
            line = line.rstrip("\n\r")
            if not line:
                continue
            cols = line.split("\t")
            if len(cols) <= max(symbol_col, rna_col):
                continue

            sgrna = cols[rna_col].strip()
            symbol = cols[symbol_col].strip()
            gene_id = cols[gene_id_col].strip() if gene_id_col is not None and gene_id_col < len(cols) else ""

            # Build scores string
            score_parts = []
            for sc_idx, sc_name in score_cols:
                if sc_idx < len(cols):
                    val = cols[sc_idx].strip()
                    if val:
                        score_parts.append(f"{sc_name}: {val}")
            scores = "; ".join(score_parts)

            rows.append(f"{sgrna}\t{name}\t{symbol}\t{gene_id}\t{scores}")

    return rows


def process_xlsx_library(config):
    """Process a validation-only XLSX library file and return list of index rows."""
    name = config["name"]
    filepath = os.path.join(SCRIPT_DIR, config["file"])

    if not os.path.exists(filepath):
        print(f"  WARNING: File not found: {filepath}", file=sys.stderr)
        return []

    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb[wb.sheetnames[0]]

    # Find column indices from header row
    headers = None
    gene_idx = None
    seq_idx = None
    rows = []

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip() if c else "" for c in row]
            for j, h in enumerate(headers):
                if h == config["gene_col"]:
                    gene_idx = j
                if h == config["seq_col"]:
                    seq_idx = j
            if gene_idx is None or seq_idx is None:
                print(f"  WARNING: Could not find columns '{config['gene_col']}'/'{config['seq_col']}' in {headers}", file=sys.stderr)
                return []
            continue

        gene = str(row[gene_idx]).strip() if row[gene_idx] else ""
        seq = str(row[seq_idx]).strip() if row[seq_idx] else ""
        if gene and seq:
            trim_pam = config.get("trim_pam", 0)
            if trim_pam:
                seq = seq[:-trim_pam]
            rows.append(f"{seq}\t{name}\t{gene}\t\t")

    wb.close()
    return rows


def write_index(rows, output_path, label):
    """Write index rows to a file."""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("# Sequences sourced from Addgene (addgene.org) and Broad Institute GPP (portals.broadinstitute.org/gpp/public/pool/index)\n")
        f.write("sgRNA Sequence\tLibrary\tGene Symbol\tGene ID\tScores\n")
        for row in rows:
            f.write(row + "\n")
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  {label}: {len(rows)} entries, {size_mb:.1f} MB → {output_path}")


def main():
    with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
        libraries = json.load(f)

    print(f"Processing {len(libraries)} libraries...")

    human_rows = []
    mouse_rows = []
    for lib in libraries:
        name = lib["name"]
        print(f"  {name}...")
        lib_rows = process_library(lib)
        print(f"    → {len(lib_rows)} sgRNAs")

        if name in HUMAN_LIBRARIES:
            human_rows.extend(lib_rows)
        elif name in MOUSE_LIBRARIES:
            mouse_rows.extend(lib_rows)
        else:
            print(f"    WARNING: '{name}' not classified as human or mouse, skipping", file=sys.stderr)

    # Process validation-only XLSX libraries
    print(f"\nProcessing {len(VALIDATION_ONLY_XLSX)} validation-only libraries...")
    for config in VALIDATION_ONLY_XLSX:
        name = config["name"]
        print(f"  {name}...")
        lib_rows = process_xlsx_library(config)
        print(f"    → {len(lib_rows)} sgRNAs")
        if config["species"] == "human":
            human_rows.extend(lib_rows)
        else:
            mouse_rows.extend(lib_rows)

    # Write species-specific outputs
    print()
    write_index(human_rows, OUTPUT_FILE_HUMAN, "Human")
    write_index(mouse_rows, OUTPUT_FILE_MOUSE, "Mouse")

    # Remove old combined file if it exists
    old_combined = os.path.join(SCRIPT_DIR, "libraries", "sgRNA_validation_index.txt")
    if os.path.exists(old_combined):
        os.remove(old_combined)
        print(f"\nRemoved old combined index: {old_combined}")

    print(f"\nDone. Total: {len(human_rows)} human + {len(mouse_rows)} mouse = {len(human_rows) + len(mouse_rows)} entries")


if __name__ == "__main__":
    main()
