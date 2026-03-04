#!/usr/bin/env python3
"""
Generates libraries/sgRNA_validation_index.txt from all built-in CRISPR libraries.
This index is used by the Validate sgRNA feature for reverse lookup (sgRNA → gene).

Usage: python3 generate_validation_index.py
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "settingsLibraries.json")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "libraries", "sgRNA_validation_index.txt")

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


def main():
    with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
        libraries = json.load(f)

    print(f"Processing {len(libraries)} libraries...")

    all_rows = []
    for lib in libraries:
        print(f"  {lib['name']}...")
        lib_rows = process_library(lib)
        all_rows.extend(lib_rows)
        print(f"    → {len(lib_rows)} sgRNAs")

    # Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("sgRNA Sequence\tLibrary\tGene Symbol\tGene ID\tScores\n")
        for row in all_rows:
            f.write(row + "\n")

    print(f"\nDone. Wrote {len(all_rows)} entries to {OUTPUT_FILE}")
    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"File size: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
