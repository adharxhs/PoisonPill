# Backlog

## Detection and evaluation

1. **Independent full-agreement benchmark.** Freeze a new set of real agreements
   with positives and hard negatives across all seven categories. Measure
   extraction, rule precision and recall, and what the optional review model
   adds under its 25-suggestion limit. Preserve the original held-out report
   and the existing [benchmark history](MEASUREMENTS.md).
2. **Broader rule coverage.** Add evidenced patterns where the benchmark
   identifies gaps. Known examples include fixed-dollar liability caps, indirect
   IP grants, and data transfers without explicit advertising wording.
3. **Scope and exceptions.** Cover additional negation, nested or distant
   carve-outs, and opt-out actions and windows split across sentences. Preserve
   scope guards and the hard-negative fixture ratio.
4. **Score validation.** Assess the provisional severity weights and display
   bands against severity-labelled examples. Existing clause labels cover
   category agreement.

## Document and product coverage

- **Document sources.** Offline OCR, direct browser PDF viewer support,
  cross-origin embeds, shadow DOM, and non-English agreements are open.
- **Finding navigation.** Improve repeated-quote disambiguation. Persistent
  annotations and severity badges remain optional.
- **Opt-out action.** The current popup prepares a copyable draft. The original
  proposed email-client action remains optional.
- **Accessibility.** Audit keyboard navigation, focus after a scan, status
  announcements, and screen-reader access to findings and evidence. The popup
  already provides light and dark styles and respects reduced motion.

## Deferred work

- **Expanded scan history.** A browsable timeline and clause-by-clause
  structural diff would extend the current digest-based previous-scan comparison.
- **Release packaging and verification.** Reproducible extension ZIP, repeatable
  browser-worker profiling on low-end hardware, and review of the Wasm optimizer
  toolchain.
- **Authoring tools.** Consider a rule-authoring check script, a summarized golden
  diff, or structured rule loading if rule maintenance becomes a bottleneck.
