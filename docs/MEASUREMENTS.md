# Measurements

Recorded at the Wasm milestone (`v0.1.0-base`). Numbers are informative, not
assertions. The only enforced limits are the 2 MiB size gate
(`scripts/check-size.sh`) and the 200 ms native budget
(`engine/tests/budgets.rs`), both run by `make verify`.

## Environment

| Item | Value |
| :--- | :--- |
| CPU | AMD Ryzen 7 7435HS |
| OS | Linux 7.3.3-200.fc44.x86_64 (x86_64) |
| Rust | rustc 1.97.1 (2026-07-14) |
| wasm-pack | 0.15.1 |
| Node | v22.23.1 |
| Profile | release, `opt-level = "z"`, LTO, `panic = "abort"`, `strip` |
| `wasm-opt` | disabled (bundled version rejects the current bulk-memory module) |

## Artifact size

| Artifact | Bytes | Budget |
| :--- | ---: | :--- |
| `extension/public/engine.wasm` | 113,158 (110.5 KiB) | 2,097,152 (2 MiB) |
| `extension/public/engine.js` (glue) | 11,354 (11.1 KiB) | — |
| sha256 (`engine.wasm`) | `e5162b546eefc3778766ac802a5e1686f90cb433baac332acd7a9e6c123f9b80` | — |

The artifact is ~5% of the size budget, so several categories can be authored
before size becomes a concern.

## Latency: 10,070 words

Fixture: the benign maintenance sentence from `engine/tests/budgets.rs`, repeated
530 times. This document produces no findings, so the number measures scanning
and sentence assembly, not report size. `analyzeJson` also serialises the empty
report.

| Path | Min | Median | Mean | Max | Notes |
| :--- | ---: | ---: | ---: | ---: | :--- |
| Native release (`analyze`) | — | 41.99 ms | — | — | One timed run after warm-up, including `Vec<ClauseFinding>` assembly. |
| Wasm (`analyzeJson`) | 10.01 ms | 10.20 ms | 10.37 ms | 11.25 ms | 20 timed runs after two warm-ups, Node 22. |

The hard budget is 200 ms, so the native path has ~4.8× headroom and the shipped
Wasm path ~20×. The native number being slower than Wasm is expected: the native
test builds debug-friendly `String`/`Vec` evidence through the same generic
code, while the Wasm release build has smaller data to serialise (empty report)
and different allocator behaviour. Neither number is used for cross-runtime
comparison; parity is asserted on bytes, not timing.

## Corpus

| Check | Result |
| :--- | :--- |
| Regression cases | 32 (8 positive, 16 hard negative, 8 ordinary negative) |
| Native/Wasm parity | 32/32 byte-identical canonical JSON |
| Findings offset invariant | Holds for every golden (`raw_text == input[start..end]`) |
| Determinism | Repeated `analyze_json` is byte-identical for every case |
| Truncation through Wasm | Oversize input marked `truncated`, offsets stay valid, no panic on a split character |

## Held-out run

Fourteen held-out documents, written before this milestone, analysed once through
the committed Wasm artifact. Full reports and input digests are in
`fixtures/heldout/REPORT.md`.

| Metric | Result |
| :--- | ---: |
| Documents | 14 |
| Documents with at least one finding | 10 |
| Total findings | 15 |
| `forced_arbitration.mandatory_arbitration` | 7 |
| `forced_arbitration.class_action_waiver` | 5 |
| `forced_arbitration.jury_trial_waiver` | 3 |
| `forced_arbitration.court_access_waiver` | 0 |

Notable misses, recorded without tuning the corpus afterwards:

- `06-marketplace-terms.txt` uses "shall be settled by arbitration", which is not
  in `MANDATORY_ARBITRATION`; the clause is predatory but does not fire.
- Four documents (`01`, `04`, `09`, `14`) state an opt-out window in a sentence
  separate from the arbitration finding. Detection is clause-scoped, so all 15
  held-out findings report `opt_out_available: false` even where the document
  offers an opt-out. This is a cross-clause association gap, not a failure to
  find the address.
- `02-saas-dpa.txt`, `08-insurance-policy.txt` and `10-housing-agreement.txt`
  correctly produce no findings.

These are recall gaps in the authored lexicon, not mechanism failures. They are
listed in `docs/KNOWN_LIMITS.md` and `docs/BACKLOG.md` rather than fixed by
rewriting the held-out set.

## Post-base: opt-out association and lexicon breadth

Recorded after decisions 16 and 17. Different machine from the table above, so
latency numbers are only comparable within this section.

| Item | Value |
| :--- | :--- |
| OS | Windows 11 (x86_64) |
| Rust | rustc 1.100.0, `stable-x86_64-pc-windows-gnu` |
| Node | v24.12.0 |

### Latency (native release, `engine/tests/budgets.rs`, 3 runs each)

| Build | Result |
| :--- | ---: |
| `v0.1.0-base` source on this machine | 106–112 ms |
| Broadened lexicon, old `find_phrase` | 342–347 ms (**over** the 200 ms budget) |
| Broadened lexicon, first-byte-skip `find_phrase` | 18–21 ms |

The phrase count roughly doubled, and the naive scan checked every byte offset of
every sentence for every phrase. The rewrite skips to bytes that can begin the
phrase and drops the char-boundary checks for ASCII needles, where they are
always true. Every golden is byte-identical before and after the rewrite.

### Labelled dev set (`fixtures/labelled/clauses.tsv`)

32 positives, 21 near misses. Not a held-out set: the lexicon was extended while
looking at it.

| Rule | Cases | Hits at `v0.1.0-base` | Hits now |
| :--- | ---: | ---: | ---: |
| `mandatory_arbitration` | 12 | 2 | 12 |
| `court_access_waiver` | 10 | 3 | 10 |
| `class_action_bar` | 10 | 3 | 10 |
| Near misses firing (false positives) | 21 | 2 | 0 |

The two base false positives were "Our support team cannot answer questions
about class action settlements" (`class_action_bar`) and severability prose about
"the class action waiver … found unenforceable" (`class_action_waiver`).

### Regression corpus

| Check | Result |
| :--- | :--- |
| Regression cases | 47 (13 positive, 26 hard negative, 8 ordinary negative) |
| Existing goldens changed | 1: `positive/05-class-action-bar` `reason` now also cites the subject it matched (`"arbitrator"`) |
| Native/Wasm parity | 47/47 byte-identical canonical JSON |
| Wasm artifact | 119,689 bytes (116.9 KiB), sha256 `ea95f6b3139ad1b94fa9687d3dca31ead19222f985ff2c119612fd6a25dce697`; built with wasm-pack 0.15.1, `engine.js` glue unchanged |
| Wasm latency (`make measure-wasm`, Node 24) | median 9.95 ms, mean 10.09 ms, max 14.51 ms over 20 runs (10,070 words) |

### Held-out acceptance check (native, not a new estimate)

The handoff named held-out documents in the acceptance criteria and its text
quotes them, so this is an acceptance check, not a fresh held-out measurement.
`fixtures/heldout/REPORT.md` is untouched and remains the honest base record.

| Document | Base | Now |
| :--- | :--- | :--- |
| `01-online-course-terms.txt` | 2 findings, no opt-out | 2 findings, opt-out `legal@acme-learning.example` |
| `04-loan-agreement.txt` | 2 findings, no opt-out | 2 findings, opt-out (postal address, no email target) |
| `06-marketplace-terms.txt` | 0 findings | 1 `mandatory_arbitration` |
| `09-exchange-agreement.txt` | 2 findings, no opt-out | 2 findings, opt-out `arbitration@example.exchange` |
| `14-help-center.txt` | 2 findings, no opt-out | 2 findings, opt-out `optout@example.com` |
| `02`, `08`, `10`, `12` | 0 findings | 0 findings |
| `court_access_waiver` / `class_action_bar` hits | 0 / 0 | 0 / 0 |

Every other document's findings are unchanged. Documents with an associated
opt-out drop to `P_I = 1.0` because `τ = 0.1` applies.

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

The training script groups related providers conservatively, gives priority to
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

Training uses NumPy, SciPy, and scikit-learn 1.9.0. Features are hashed word
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
