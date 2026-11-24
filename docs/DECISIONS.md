# Design decisions

## Engine and browser boundary

The Rust engine runs in a classic Manifest V3 background service worker.
Content scripts send extracted text via extension messaging. The browser
restricts a content script from starting a worker from an extension URL.
The classic worker loads the `no-modules` wasm-bindgen output with
`importScripts`. The separate PDF.js worker handles local PDF text extraction.

Commit the built Wasm and glue so contributors can build and load the browser
extension with Node alone. Parity verifies the shipped artifact against the
native goldens. The bundled `wasm-opt` previously rejected the Rust
bulk-memory output, so the release profile uses size optimization and LTO and
the verification suite enforces the binary size limit.

## Rules, evidence, and scope

Use ordered Rust constants for rules. The registry tests runtime registration
without shipping a rule-file parser. Evaluate required matches and proximity
before guards, then use optional matches as evidence. Keep exception-marker
inversion opt-in because a marker may qualify a different right in a clause.

Keep opt-out association bounded so the engine can explain why a neighbouring
deadline or address belongs to a finding. Retain the source excerpt. The user
can review and copy an editable draft from the popup.

Keep model suggestions opt-in. The model extends wording coverage, while
scored findings require a specific rule and its evidence. See
[measurements](MEASUREMENTS.md#provider-separated-tos-100-review-experiment)
for the evaluation and its limits.

## Reports and storage

Use the strongest finding in each category when computing the Poison Index.
Repeated boilerplate should produce visible findings without inflating the
index. An extracted opt-out cannot establish whether a particular user can
still use it, so it leaves the score unchanged. The
[score comparisons](MEASUREMENTS.md#poison-index-v11-behavior-check) record
why this replaced v1.0 scoring.

Store a single latest web scan for the popup and bounded digest baselines for
comparison. Avoid keeping a history of agreement text. Jump to Clause uses
the CSS Custom Highlight API and scrolls to the source, leaving the page
markup intact. The popup bundles the scoring animation locally and honors
reduced-motion preferences.

## Evaluation records

Use goldens for regressions and wire parity. Regenerate them explicitly when
behavior changes. Keep the original [held-out report](../fixtures/heldout/REPORT.md)
as the measurement of the base artifact. Report later acceptance checks
and new benchmarks separately.
