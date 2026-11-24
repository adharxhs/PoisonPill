# Product specification

PoisonPill helps readers identify potentially harmful wording in agreements and
find the source clause. Scans run locally. Each scored finding includes the
clause text, category, severity, and evidence used by the rule.

## Scan behavior

The top-level content script checks the URL, title, and main heading for a
likely legal page. It reads rendered text and accessible same-origin HTML embeds
and sends the text to the MV3 background service worker. Initial loads, tab
switches, and debounced text changes can trigger a scan. **Refresh report**
scans the active page on demand. The toolbar popup can open after the initial
scan of a newly loaded legal page on compatible browsers.

**Scan a PDF** reads selectable text in a local file using bundled PDF.js.
Extracted text goes to the same Rust/Wasm engine. The report remains in the
PDF scanner tab. See [Known Limits](KNOWN_LIMITS.md) for input caps and coverage.

## Detection and the Poison Index

Rules match phrases and bounded actor, action, and qualifier patterns.
Some rules use exception markers or adjacent clauses to resolve scope.
[Rule Format](RULES.md) lists the categories and weights. The
[Wire Contract](CONTRACT.md#documentreport) defines the score formula.

The strongest finding in each category contributes to the document score.
Additional categories raise it with diminishing returns. The index summarizes
the wording that fired the rules. Eligibility for an opt-out and legal
enforceability require more context than a scan can establish.

The optional web-page review model suggests similar wording in four categories.
It displays source excerpts separately from scored findings.

## Reports and actions

The popup shows grouped findings and supports **Jump to clause** for a uniquely
located source quote. Arbitration findings with a supported email opt-out can
offer an editable draft for copying. Eligible complete web scans compare the
visible text and findings with the previous local baseline for that page.

PDF reports group findings that share a source clause. They explain each issue
in plain language, offer practical next steps, and then show a brief technical
note. The filename is `poisonpill-<source>-<YYYY-MM-DD>.pdf`, with the website
hostname or imported PDF basename and the local scan date. The
[backlog](BACKLOG.md) records open product and detection work.
