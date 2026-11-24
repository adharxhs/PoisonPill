# Labelled arbitration development set

`clauses.tsv` holds one clause per line as `label<TAB>text`. Comments beginning
with `#` and blank lines are ignored. A positive label names the expected
arbitration rule. The `none` label marks a near miss and requires zero findings.

A category hit is any `forced_arbitration` finding. A rule hit requires the
labelled rule ID among the reported findings. The lexicon was developed using
these examples, so treat the results as regression measurements.

```sh
cargo test --manifest-path engine/Cargo.toml --test labelled
cargo test --manifest-path engine/Cargo.toml --test labelled -- --ignored --nocapture
```

The first command runs the regular guards. The second runs the optional recall
report. See [measurements](../../docs/MEASUREMENTS.md) for the recorded counts.
