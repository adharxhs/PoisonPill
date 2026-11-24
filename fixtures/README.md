# Fixtures

- [Regression cases](cases/) cover positive findings, hard negatives, and
  ordinary negative prose. A test enforces at least two hard negatives per
  positive. The matching [goldens](golden/) capture the canonical engine
  envelopes.
- The [labelled development set](labelled/README.md) measures targeted
  arbitration rules and guards against known false positives.
- The [exact-rule panel](exact-rules/tos100.tsv) records expected rule IDs
  for selected ToS-100 source rows. See the
  [benchmark instructions](../docs/MEASUREMENTS.md#exact-rule-check-on-real-agreements)
  to reproduce it using the original CSV.
- The [original held-out report](heldout/REPORT.md) is a frozen snapshot of the
  base artifact. Preserve the report and use a new corpus to measure
  generalization.

## Add a regression case

1. Place the smallest example in the appropriate `cases/` subdirectory. For
   each positive, include two plausible near misses as hard negatives.
2. Inspect the engine output with
   `cargo run --release --manifest-path engine/Cargo.toml --bin analyze -- --pretty <file>`.
3. Run `make goldens` and review the exact changes. Include the fixture and its
   golden in the same change, then run `make verify`.
