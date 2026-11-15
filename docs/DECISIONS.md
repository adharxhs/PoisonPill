# Decisions

Architecture decision records for the `v0.1.0-base` mechanism milestone. Each
entry records what was chosen, what was rejected, and what the choice costs. The
contract itself is in [`CONTRACT.md`](CONTRACT.md); rule authoring is in
[`RULES.md`](RULES.md).

## 1. The wire contract is one snake_case JSON envelope

**Status:** accepted (commit `9f103d2`).

**Context.** The engine is called from a worker and consumed by TypeScript. The
boundary must be stable enough that a content script never parses English and
never guesses at an error string.

**Decision.** `engine/src/model.rs` owns `ClauseFinding`, `DocumentReport`, the
typed error, and the canonical envelope. `analyze_json` returns exactly one of:

```json
{"status":"ok","report":{...}}
{"status":"error","error":{"code":"invalid_input","message":"..."}}
```

All fields are snake_case. `extension/src/types.ts` mirrors the Rust structs by
hand and is updated in the same commit. `schema_version` is `"1.0"` and only
changes when an existing consumer would break.

**Rejected.** Throwing across the Wasm boundary; returning a bare report and
using a sentinel field for errors; camelCase on the TS side with a mapping layer.
Each adds a place for the two sides to disagree.

**Cost.** The TypeScript mirror is manual. The contract is small enough that
keeping it in one reviewable file is cheaper than code generation.

## 2. One finding per category per clause, sorted by offset

**Status:** accepted (commit `72ccb49`).

**Context.** A single sentence can mention a class action, a jury trial, and
mandatory arbitration. Emitting every matching rule would let one clause dominate
the poison index and produce three near-identical quotes in the UI.

**Decision.** Rules are evaluated in registry order. For each clause, the first
matching rule in a category wins, so a category contributes at most one finding
per clause. Findings are emitted in sentence order; ties break on registry order.
No hash map participates in output ordering.

**Rejected.** Emitting all matches, then de-duplicating by category in
TypeScript. That moves a scoring decision out of Rust and makes the report depend
on the consumer.

**Cost.** A clause that is both a class-action waiver and a jury waiver reports
one of them. The specific rule is chosen by registry priority, not by severity.

## 3. Rules are Rust `const` data, not JSON or regex

**Status:** accepted (commit `72ccb49`).

**Context.** The spec asks for a declarative rule format so a content engineer
can add categories without touching the matcher. JSON files would make the
engine depend on a parser and a file loader inside Wasm, and regex would add
backtracking risk and locale dependence.

**Decision.** A rule is a `RuleSpec` value: ids, label, `Modality`, weight,
`required`/`optional`/`prohibited` predicate lists, proximity window, and an
`inversion_sensitive` flag. Predicates are `AnyPhrase`, `AllPhrases`, or `Near`.
Matching is ASCII-case-insensitive substring search over the lexicon. Adding a
category means adding lexicon constants, `RuleSpec`s, a registration entry, and
fixtures — no control flow changes.

**Rejected.** A JSON rule file compiled into the binary; a regex per rule; a DSL.
Each moves the authoring surface away from the compiler and the `cargo test` gate.

**Cost.** Adding a category is a Rust change, so a non-Rust engineer needs a
reviewer. `engine/tests/rule_format.rs` demonstrates that a synthetic category
can be registered purely as data; that test must stay green.

## 4. Failure modes are explicit: prohibited first, optional never gates

**Status:** accepted (commit `72ccb49`).

**Decision.** `prohibited` is checked before `optional`. A `prohibited` hit
suppresses the rule entirely; an `optional` hit only adds supporting evidence to
`reason`. A rule that fires must be able to explain itself from matched phrases
(`matched "waive", "class member" in the clause`).

**Rejected.** Treating optional phrases as weighted scores. A rule would then
fire without a sentence it can point at, which is unexplainable on the wire.

**Cost.** Some true positives are missed when the wording is right but the
supporting evidence is absent. Precision is preferred over recall here.

## 5. Inversion calculus is opt-in and ignores quoted markers

**Status:** accepted (commit `0fa2666`).

**Context.** "We will not waive your right to a jury trial" contains a waiver
phrase but says the opposite. A `prohibited` string list does not generalise to
every marker.

**Decision.** `inversion_sensitive: true` enables a marker count (`except`,
`unless`, `provided that`, `notwithstanding`, `save for`, `at our sole
discretion`) outside quoted text:

- even count → `canceled`; polarity stands, the rule may fire;
- odd count over a positive base → `inverted`; the rule is suppressed;
- negated/compliant base followed by a hostile carve-out →
  `compliance_then_carve_out`; always fires.

Marker counting is a deliberately small model, not natural-language negation.

**Rejected.** Enabling inversion for every rule. Explicit arbitration language
("the parties shall arbitrate") is not made non-predatory by a stray "unless".

**Cost.** The shipped Arbitration rules set `inversion_sensitive: false`; the
calculus is proven by `engine/tests/rule_format.rs` and reserved for categories
whose phrasing needs it.

## 6. Opt-out is clause-scoped and stops at detection

**Status:** accepted (commit `7e58dcf`); gap recorded in
[`KNOWN_LIMITS.md`](KNOWN_LIMITS.md).

**Decision.** A finding sets `opt_out_available` only when the same sentence
contains an opt-out action *and* a window. `optout.rs` extracts the first valid
address, lowercased and rebuilt from its parts, accepting common obfuscation. A
bare email address is never an opt-out. `opt_out_target` is omitted, not `null`,
when absent. The engine never drafts mail or opens `mailto:`.

**Rejected.** Document-wide association of an address with every arbitration
finding. It is easy to implement and wrong: a privacy address at the top of a
fifty-page document is not the arbitration opt-out.

**Cost.** Four held-out documents state the window in a sentence separate from
the finding and report `opt_out_available: false`. Cross-clause association is
backlog work, not a mechanism change to rush in.

## 7. Input work is capped at 512 KiB and truncates gracefully

**Status:** accepted (commit `22a6adc`).

**Decision.** The engine analyses at most 524,288 bytes (roughly 80,000 words).
Beyond the cap it cuts on a UTF-8 character boundary, sets `truncated: true`, and
returns findings for the prefix. Offsets always index the original string.
`raw_text == input[start..end]` is asserted for every golden.

**Rejected.** Returning an error for oversize input; silently scanning a
different string; truncating to a byte that splits a character.

**Cost.** A truncated document can under-report. The flag is the caller's signal;
the reference shell does not invent a retry.

## 8. Determinism is an output property, tested byte for byte

**Status:** accepted; strengthened in commit `6ea6df8`.

**Decision.** No timestamps, no locale-dependent operations, no hash-map ordering
in the report. `analyze_json` must be byte-identical across native and Wasm for
the same input. Goldens store the whole canonical envelope on one line.

**The `-0.0` fix.** `Iterator::sum` seeds floats with `-0.0`, so an empty report
serialised `"poison_index":-0.0`. It is valid JSON but a surprising value for a
consumer and an easy source of equality bugs. `poison_index` now folds from an
explicit `0.0`, and `empty_document_scores_zero` asserts the sign. Goldens, the
playback copy, the Wasm artifact, and the held-out report were regenerated; the
held-out diff was only that value and the artifact digest.

**Cost.** Rounding happens once at document level, so per-clause sums are not
available on the wire. Consumers that want them must recompute from `severity`.

## 9. Wasm is built `no-modules` and `wasm-opt` stays off

**Status:** accepted (commit `1e663b4`).

**Context.** Chrome loads `worker.js` as a classic worker, so the glue cannot be
an ES module. The `wasm-opt` bundled with the toolchain rejects the current
bulk-memory module.

**Decision.** Build with `wasm-pack --target no-modules`; the worker uses
`importScripts`. `wasm-opt` is disabled. Artifact size is gated at 2 MiB by
`scripts/check-size.sh` and recorded in [`MEASUREMENTS.md`](MEASUREMENTS.md).

**Rejected.** Switching the worker to a module worker to satisfy `wasm-pack`'s
default target. MV3 classic workers are the supported path here; changing the
loader is more risk than the size win is worth.

**Cost.** The shipped artifact is larger than a post-`wasm-opt` build would be.
At ~110 KiB it is ~5% of the budget, so several categories fit before this
matters. Re-enabling `wasm-opt` is backlog work.

## 10. Built Wasm artifacts are committed

**Status:** accepted (commit `c92d006`).

**Decision.** `extension/public/engine.js` and `engine.wasm` are committed.
Extension work needs only Node and `npm install`; Rust is needed only to change
detection. `make parity` compares the shipped Wasm output against native
goldens, so the committed bytes cannot drift silently.

**Rejected.** Requiring `make engine` before every extension build; committing
`dist/` instead (gitignored, since it is a derived bundle).

**Cost.** Every engine change touches two binary-ish files and must be followed
by `make engine` and `make parity`.

## 11. The content script writes nothing to the page

**Status:** accepted (commit `193a147`).

**Context.** The spec's product layer (highlights, badges, jump-to-clause,
theming) is large and easy to build on top of an unstable contract.

**Decision.** `content.ts` extracts page text, sends it to the worker, and stores
one `last_scan` record. It does not mutate the page. `popup.ts` renders that
record as plain text in the extension's own document. No highlighting, badges,
shields, jump-to-clause, history, or mail generation. The shell exists to prove
the contract end to end.

**Rejected.** Shipping a "minimal" highlighter. Any DOM annotation is a product
feature with its own offset-mapping and accessibility questions once the page
mutates, and it would blur what this milestone verifies.

**Cost.** The extension looks sparse. That is intentional; the backlog names the
product work.

## 12. Goldens are full envelopes and are never written by tests

**Status:** accepted (commit `3c4797d`).

**Decision.** Each case under `fixtures/cases/` has a golden under
`fixtures/golden/` containing the complete canonical envelope on one line. Tests
compare and never write. `make goldens` is the only writer, and its diff is
reviewed. Hard negatives outnumber positives 2:1, enforced by a test.

**Rejected.** Snapshot auto-accept on failure; asserting selected fields. Field
selection lets a regression hide in an unasserted field.

**Cost.** Any deliberate output change regenerates many files. That is the point:
it forces the change to be seen.

## 13. The held-out corpus is run once, then frozen

**Status:** accepted (commit `22a6adc`); re-run once for the `-0.0` fix.

**Decision.** `fixtures/heldout/` documents were written before the Wasm
milestone, are excluded from the golden harness, and are analysed once through
the committed artifact. `REPORT.md` is the honest snapshot, including misses.
The only re-run was the serialization fix; the diff was the artifact digest and
the empty-report values.

**Rejected.** Tuning phrases against the held-out misses and calling it
validation. Once a document informs the lexicon it is training data.

**Cost.** Known misses (see [`KNOWN_LIMITS.md`](KNOWN_LIMITS.md)) stay visible in
the shipped snapshot rather than disappearing from it.

## 14. Only Forced Arbitration is authored

**Status:** accepted.

**Decision.** `forced_arbitration` has five rules:
`class_action_waiver`, `jury_trial_waiver`, `court_access_waiver`,
`mandatory_arbitration`, and `class_action_bar`. The other four taxonomy
categories are empty registry slots with documented authoring steps.

**Rejected.** Seeding three categories with thin lexicons to look complete. A
category with no hard-negative corpus is a false-positive generator.

**Cost.** Detection coverage is narrow. Breadth is backlog work and each category
needs its own 2:1 hard-negative corpus before it ships.

## 15. Storage holds one record, not a history

**Status:** accepted (commit `193a147`).

**Decision.** The content script writes exactly
`chrome.storage.local["last_scan"] = { url, scanned_at, report }`, replacing the
previous record. `scanned_at` is owned by the UI and never appears in the report.
`manifest.json` requests `storage` only and keeps `host_permissions` empty.

**Rejected.** Unbounded scan history and any remote sync. Both invite storing
full contract text, which the threat model avoids.

**Cost.** The popup can only show the most recent scan. History is backlog work
and must store digests and offsets, not full text.
