# Measurements

## Verification snapshot

Verified on 2026-11-24 at `3b990f3`. The enforced engine budgets are
200 ms for the native release fixture and 2 MiB for the shipped Wasm binary.

| Check | Result |
| :--- | :--- |
| `make verify` | Formatting, Clippy, TypeScript, Rust tests, and release budgets passed. |
| Rust tests | 109 passed, including the release budget and separately run labelled recall report. |
| Regression cases | 71 byte-identical native/Wasm envelopes across 21 positives, 42 hard negatives, and 8 ordinary negatives. |
| Native release latency | 14.41 ms for 10,070 words. |
| Node Wasm latency | 21.82 ms median, 21.62–22.72 ms over 20 timed runs on 10,070 words. |
| Shipped Wasm | 194,788 bytes. |

The latency fixture contains benign prose and produces an empty report. The
Node run used v22.23.1. These timings measure the engine on one machine.
They leave browser extraction, PDF parsing, and low-end device performance
unmeasured.

Isolated Brave smoke tests covered legal-page targeting and popup opening,
tab switches, manual refresh, live text changes, embedded HTML, exact-wording
highlighting, optional model suggestions, local PDF import, and grouped PDF
export. The sample PDF produced eight findings. A PDF with recoverable font
warnings still scanned successfully, while an unreadable file reported a
failure.

Reproduce the repository checks with `make verify` and the separate Wasm
timing with `make measure-wasm`.

## Arbitration development and original held-out results

The [labelled development set](../fixtures/labelled/README.md) has 32
positives and 21 near misses. The current recall run hit 12/12 mandatory
arbitration cases, 10/10 court-access waivers, and 10/10 class-action bars.
The near-miss guard passed. These cases informed the lexicon changes.

The [original held-out report](../fixtures/heldout/REPORT.md) records the
`v0.1.0-base` artifact. It found 15 findings across 14 documents, with one or
more findings in 10 documents. Later acceptance checks on those same examples
confirmed the marketplace arbitration phrasing and the opt-out associations
in documents 01, 04, 09, and 14. Those checks exercised known gaps. The
original report preserves the base outputs and scoring version.

During the earlier rule expansion, native runtime on a Windows test machine
went from 106–112 ms at the base to 342–347 ms with the extended lexicon and
the old phrase scanner. Skipping to candidate first bytes reduced it to
18–21 ms on that machine while preserving the goldens.

## Provider-separated ToS-100 review experiment

Sources: [ToS-100 course split](https://doi.org/10.5281/zenodo.22691656),
[Ruggeri et al.](https://doi.org/10.1007/s10506-021-09288-2), and
[Lippi et al.](https://doi.org/10.1007/s10506-019-09243-2).

The benchmark uses four ToS-100 labels with approximately corresponding
PoisonPill categories. The label scope is broader than several shipped rules.
For example, ToS-100 labels unilateral changes generally, while the scored
modification rule requires explicit permission to amend without notice. ToS-100
arbitration labels also differ from PoisonPill's combined arbitration and waiver
category. Counts therefore measure agreement with the corpus labels, rather than
enforceability or accuracy across PoisonPill's full taxonomy.

The training script groups related providers, gives priority to
test groups, and removes exact normalized text overlap from earlier splits.
The resulting split has 13,256 training clauses from 62 groups, 2,547
validation clauses from eight groups, and 2,032 test clauses from ten groups.
The held-out groups are Badoo, Foursquare, Grammarly, Pokémon, SyncMe, Twitch,
Zara, eBay, eDreams, and Imgur. Group alias decisions are recorded in the script.
Thresholds maximize F0.5 on validation output after quantization. Test labels
are used only for reported counts.

| Test label | Positives | Scored rule TP / FP | Additional review TP / FP | Combined recall (evaluation only) |
| --- | ---: | ---: | ---: | ---: |
| Arbitration | 11 | 5 / 12 | 1 / 1 | 54.5% |
| Unilateral change | 33 | 0 / 0 | 15 / 4 | 45.5% |
| Liability limitation | 47 | 0 / 0 | 17 / 3 | 36.2% |
| Termination | 43 | 0 / 0 | 24 / 5 | 55.8% |

Across these four label-by-clause comparisons the rules matched 5 positives.
The review layer added 57 positives and 13 suggestions outside the benchmark
labels. Among the 70 additional suggestions, observed precision was 81.4%.
This is one historical, English-language corpus. The benchmark evaluates
individual pre-tokenized clauses, so it does not estimate whole-document
recall under the popup's 25-suggestion limit. The model remains opt-in and
scored findings are produced by the rules alone.

### Current-rule rerun

On 2026-11-24 the same 2,032 clauses were evaluated against the current
rules and unchanged model. The opt-in path added 54 matches and 13 suggestions
outside the benchmark labels, for 80.6% agreement among added suggestions.
The additional matches were 14 for changes to terms, 16 for liability
limitations, and 24 for termination. Arbitration added zero matches and one
suggestion outside the benchmark labels. This is model value relative to the
current rule set on the existing clause split.

### Reproduce

Download and unpack the three CSVs from the DOI into a local directory. Verify
the published MD5 values (train `7cd0dc666b954db8db44db37c2be4c14`, validation
`56437ce8a707d6fe3144330fcb33ecaf`, test
`2c8f83c3c3ff3cf6a78f71e796c34942`). The extension bundles integer coefficients
and thresholds only. The benchmark CSVs stay outside the repository.

```sh
OPENBLAS_NUM_THREADS=1 python3 scripts/train-review-model.py /path/to/tos-100 --fit
cargo build --release --manifest-path engine/Cargo.toml --bin evaluate
OPENBLAS_NUM_THREADS=1 python3 scripts/train-review-model.py /path/to/tos-100 \
  --evaluate engine/target/release/evaluate
```

The recorded training used NumPy, SciPy, and scikit-learn 1.9.0. Features are hashed word
unigrams and bigrams and four-character n-grams, with 4,096 buckets and a
1,024-byte normalized input limit per clause. Both the native evaluator and the
Wasm extension use the same Rust inference code and the same 32,784-byte model.
The committed model's SHA-256 is
`1c0b0e14b6f8205767332a41a3d2e7d85439e0f0dda4bb588c8256a7284b09d6`.

## Exact-rule check on real agreements

The [ToS-100 test split](https://doi.org/10.5281/zenodo.22691656) supplied 35
selected clauses from ten providers. The [annotation panel](../fixtures/exact-rules/tos100.tsv)
records source-row IDs, expected PoisonPill rule IDs, and reasons. It uses the
original agreements as distributed in the test split. It contains no copies
of the source text. The clauses were labelled in isolation before the benchmark run without independent legal review. The panel specifically includes tricky near misses such as
advance notice, a fixed-dollar cap, or a service modification in place of a
contract modification.

Exact sets of rule IDs matched on 20 of 35 clauses. Across the panel's 23
positive rule labels, the engine matched 9, missed 14, and produced 2 additional
rule IDs. This gives 81.8% precision (9/11) and 39.1% recall (9/23) on this
small, deliberately selected panel. It is not a population estimate. The
panel lacks positive examples for advertising disclosure and two-sided
termination notice in this split. It also does not evaluate OCR or document
extraction.

Some misses exposed coverage gaps beyond the sentence and line wrapping
changes. A real provider can identify itself by name instead of “we” in a
no-notice amendment. Three broad content grants use provider names or
alternative license wording. An arbitration term may contain class and jury
restrictions in the same sentence, and the current overlap policy can choose
the waivers without emitting a separate arbitration rule ID. Misclassifying a
class bar as a class waiver counts as one additional rule and one missed rule.

Run against the original, checksum-pinned test CSV from the linked deposit:

```sh
cargo build --release --manifest-path engine/Cargo.toml --bin evaluate
python3 scripts/evaluate-exact-rules.py /path/to/tos-100/test.csv engine/target/release/evaluate
```

The script compares scored rule IDs only. The review classifier and the
published ToS-100 broad labels do not set expected results for this panel.
The panel was kept separate from model training. The figures above are
the initial readout, before using its misses to guide rule fixes.

### Targeted fix rerun

The same 35 clauses and unchanged annotations were used to retest the fixes.

| Input context | Exact clauses | Expected matches found | Missed | Extra |
| --- | ---: | ---: | ---: | ---: |
| Original text only | 34/35 | 22/23 | 1 | 0 |
| Text with the published provider label | 35/35 | 23/23 | 0 | 0 |

The lowercase eDreams excerpt in the text-only run lacks an explicit provider
role or capitalized name. Its published provider label gives the rule enough
context to tie the amendment to the provider. The browser supplies the page
hostname for equivalent cases. Both benchmark modes use the same rules and
keep the original clause offsets intact.

```sh
python3 scripts/evaluate-exact-rules.py /path/to/tos-100/test.csv engine/target/release/evaluate --with-provider
```

These are regression results on the panel used to diagnose the fixes. An
independent sample is needed to measure generalization.

## Poison Index v1.1 behavior check

The original scorer added each category occurrence and applied a 90% discount
when it detected opt-out wording. With the existing severity weights, 20
copies of one arbitration sentence hit the 100-point ceiling. A single
arbitration sentence with opt-out wording scored 0.5, despite the scanner
having no way to tell if an individual user's window was still open.

The revised scorer takes the strongest finding in each category. The product
formula retains the existing category ordering and adds breadth with
diminishing returns. It also removes the separate multiplier for broad
discretion phrases such as “at any time.” The examples below were run through
the old and updated shipped Wasm engines. These are behavior checks of the
formula. The rule evaluation corpus labels clause types and cannot calibrate
numerical severity or the popup's display bands.

| Scenario | v1.0 | v1.1 |
| --- | ---: | ---: |
| One arbitration clause | 5 | 50 |
| Same clause with opt-out wording | 0.5 | 50 |
| 20 copies of the arbitration clause | 100 | 50 |
| One no-notice amendment with “at any time” | 8 | 40 |
| One disclosure to advertisers | 3 | 30 |
| Arbitration, a no-notice amendment, and advertising disclosure | 12 | 79 |

All seven shipped categories together yield 97.07. A score of zero means the
scored rules produced no findings in the scanned text. Historical held-out
reports retain the scoring version used when they were recorded.
