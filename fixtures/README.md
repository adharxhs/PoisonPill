# Fixtures

Two immutable-ish corpora live here, for different jobs.

## `cases/` — the regression corpus

Three classes, each a flat directory of `.txt` files:

| Directory | Meaning | Test expectation |
| :--- | :--- | :--- |
| `positive/` | A predatory Arbitration clause. | At least one finding. |
| `hard_negative/` | Adversarial near-miss: compliance boilerplate, descriptive prose, provider-side waivers, unrelated "waive". | Zero findings. |
| `negative/` | Ordinary contract prose with nothing deontic to flag. | Zero findings. |

The hard negatives must stay at least **twice** the number of positives; a test
enforces this ratio. When adding a positive, add two hard negatives that could
plausibly fool the same rules.

`golden/<class>/<name>.json` holds the exact canonical `analyze_json` envelope
for the same-named case. Tests compare byte-for-byte. Goldens are **never**
written by the test suite; regenerate them only with `make goldens` and review
every line of the diff.

## `heldout/` — the one-shot corpus

Held-out documents are realistic excerpts written before the Wasm milestone and
run exactly **once**, against the shipped Wasm build, at that milestone. Their
reports are recorded in `heldout/REPORT.md` and are not used for tuning. Do not
add goldens for them; doing so turns them into training data.

## Adding a case

1. Write the smallest document that demonstrates the behaviour.
2. Run `engine/target/release/analyze --pretty <file>` and confirm the report is
   what you expect.
3. Run `make goldens`, read the diff, and commit the case and golden together.
