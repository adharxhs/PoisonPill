# Backlog

Work deliberately left out of `v0.1.0-base`. Ordered by the order the project
intends to take it, not by size. Nothing here is required for the tag to be
correct; the tag promises the mechanism and one authored category, not coverage.

## Engine: detection

1. **Expand category coverage.** The registry has initial rules for no-notice
   changes, perpetual commercial IP grants, user indemnification with legal
   fees, advertising data disclosure, fees-paid liability caps, and asymmetric
   termination notice. Extend those narrowly with a corpus containing at least
   two hard negatives per positive. Follow [the rule format](RULES.md).

2. ~~**Broaden `MANDATORY_ARBITRATION` for real phrasings.**~~ *Done — decision
   17.* "shall be settled by
   arbitration" is the known miss in `06-marketplace-terms.txt`. Candidates:
   "settled by arbitration", "referred to arbitration", "subject to arbitration",
   "arbitration shall be the exclusive". Each needs a hard negative for benign
   settlement and for "arbitration is available" language.

3. ~~**Prove or fix `court_access_waiver` and `class_action_bar` recall.**~~
   *Done on a dev set — decision 17; a sampled labelled corpus is still item 8.* Both are
   fixture-positive but produced zero held-out hits. Build a small labelled set
   of real court-access and class-bar clauses, measure, and either add lexicon
   phrases or narrow the rule's claim in `docs/RULES.md`.

4. ~~**Cross-clause opt-out association.**~~ *Done, block-bounded — decision
   16.* The largest known recall gap: an opt-out
   window stated in a neighbouring sentence or section is not associated with the
   finding. The design needs a bounded, explainable rule — for example, a window
   and address in the same *section* with no competing address — not a
   document-wide search. Update `KNOWN_LIMITS.md` when this lands.

5. **Author a second modality of negation.** The inversion calculus counts
   markers and ignores quoted text. Double negation, "nothing ... shall be
   construed to waive", and conditional carve-outs are only partly covered by
   `COMPLIANCE_GUARDS`. Extend the data first; extend the calculus only with
   tests in `engine/tests/rule_format.rs`.

6. **Reconcile the spec's `P_I` weighting.** The spec uses per-category `w_k` in
   the `$P_I$` formula while the taxonomy table assigns different weights. The
   shipped code follows `RuleSpec.weight` and documents the table as
   authoritative. If the spec is revised, update `scoring.rs`, `CONTRACT.md`, and
   the goldens in one commit.

7. **Structured rule loading, if authoring becomes a bottleneck.** Rules are
   Rust `const` data today. A JSON or TOML rule file would let a non-Rust author
   add a category, at the cost of a parser and a loader inside Wasm. Only worth
   doing if the Rust-review step actually blocks content work; determinism and
   the `cargo test` gate must survive.

## Engine: measurement

8. **A precision/recall harness on a labelled corpus.** Fixtures prove
   invariants, not accuracy. Sample real contract text, label clause-level
   positives and hard negatives, and record precision/recall per category in
   `MEASUREMENTS.md`. Keep any held-out slice frozen and run once, as
   `fixtures/heldout/` already does.

9. **Re-enable `wasm-opt`.** The bundled binary rejects the current bulk-memory
   module. Pin a toolchain version that accepts it, compare artifact size and
   parity, and record both. Do not hand-edit the artifact.

10. **Chrome-side latency profile.** The 200 ms gate runs natively in a test. Add
    a repeatable measurement of `analyzeJson` inside a Chrome worker on a
    low-end profile, and record it separately from the Node numbers.

## Product

11. **In-page annotations.** The popup can jump to the smallest rendered
    element containing a unique exact source match. Highlighting, severity
    badges, and a mapping for ambiguous or changed quotes remain open.

12. **Opt-out drafting.** The popup can prepare and copy an editable draft
    from a finding with linked opt-out evidence. A direct mail action remains
    optional product work.

13. **Browsable scan history.** The popup and PDF compare a complete scan with
    the previous SHA-256 baseline for the same page. A browsable timeline and
    clause-by-clause diff remain open.

14. **SHA-256 tree-diff audit memory.** Explicitly out of this base. If added,
    digest clause text and offsets under `chrome.storage.local`; never store the
    source text itself.

15. **Theming and accessibility pass.** Dark/light surfaces, keyboard navigation
    for the findings list, focus management in the popup, and screen-reader
    labels for severity. A plain list is accessible by default; annotations and
    badges often are not.

16. **Rescan and SPA support.** Re-extract after client-side navigation or a
    "load more" expansion, with debouncing, and surface the shell's 120k-character
    cutoff instead of silently under-reporting.

17. **PDF and embed support.** Contracts are frequently PDFs. Local extraction
    inside the extension is a separate dependency and size/privacy decision; do
    not add a remote viewer or a network-backed extraction service.

## Tooling and delivery

18. **Category authoring checklist as a script.** A small `make` target that
    asserts a new category has a 2:1 hard-negative corpus, fixtures under both
    `positive/` and `hard_negative/`, and no new branch in the matcher. Today the
    rules are enforced by review and by `rule_format.rs`.

19. **Golden diff review ergonomics.** `make goldens` rewrites every changed
    envelope. A summary mode that prints rule id and `P_I` deltas per case would
    make review faster without changing what is written.

20. **Release packaging.** `make extension` produces `dist/`, which is
    intentionally not committed. A reproducible zip of `dist/` (no timestamps in
    the archive) would make handing a build to a reviewer easier.
