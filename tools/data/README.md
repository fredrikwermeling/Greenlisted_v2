# Vendored input data for `tools/build_gene_sets.py`

## `surfaceome_ids.txt`

The 2886 UniProt entry names of the *in silico* human surfaceome:

> Bausch-Fluck D, Goldmann U, Müller S, van Oostrum M, Müller M, Schubert OT,
> Wollscheid B. *The in silico human surfaceome.* PNAS 2018;115(46):E10988–97.
> <https://wollscheidlab.org/SURFY/>

Vendored rather than downloaded at build time because the SURFY site serves a
Git LFS pointer in place of the file — `table_S3_surfaceome.xlsx` comes back as
132 bytes of pointer text, not a spreadsheet — and every direct URL returns the
HTML page. The ID list is small, stable and citable, so it is kept here.

Entry names, not gene symbols: the build maps them through UniProt.
