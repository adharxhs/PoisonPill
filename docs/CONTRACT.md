# Wire contract v1.1

This document is the boundary between the Rust engine and everything written in
TypeScript. The Rust source of truth is `engine/src/model.rs`; the TypeScript
mirror is `extension/src/types.ts`. Change both in the same commit and bump
`schema_version` when an existing consumer would break.

All JSON uses **snake_case**. The canonical representation is the Rust
`serde_json` string returned by `LegalEngine.analyze_json`. The worker parses
that string and unwraps the typed envelope.

## `ClauseFinding`

Findings are sorted by `start_offset`, then
by the deterministic order of rules in the registry.

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `category` | string | Stable category ID such as `forced_arbitration`. |
| `label` | string | Human-readable category label. |
| `rule_id` | string | Stable ID of the rule that fired. |
| `raw_text` | string | Exact clause slice, trimmed of surrounding whitespace. |
| `modality` | `obligation` \| `permission` \| `prohibition` \| `waiver` | Deontic edge carried by the clause. |
| `severity` | number | Rule weight in `[1.0, 5.0]`. See the document score below. |
| `start_offset` | integer | Inclusive byte offset of `raw_text` in the exact input string. |
| `end_offset` | integer | Exclusive byte offset of `raw_text` in the exact input string. |
| `opt_out_available` | boolean | An associated source states an opt-out action and a window. See the association rules below. |
| `opt_out_target` | string? | Syntactically valid email address extracted from the source, when present. |
| `inversion` | see below | Effect of exception markers on this clause. |
| `reason` | string | One sentence explaining which matched data made the rule fire. |

Optional `evidence` includes original matched text and UTF-8 byte ranges.
`opt_out_source`, when present, carries the complete source clause for the
associated opt-out with the same range format. Existing stored reports can
omit both fields. The popup accepts those reports and Refresh report replaces
them with the latest scan.

### Offsets

Offsets are **UTF-8 byte offsets**, always on character boundaries. They index the
string passed to the engine. When the engine truncates oversize input, findings
only cover the prefix and their offsets remain valid for the original string.

The hard cap is **512 KiB** (524,288 bytes). Input beyond
the cap is not analysed: the engine cuts on a character boundary, sets
`truncated`, and returns findings for the prefix only. A caller should surface
that state rather than retrying with the same text.

`raw_text == input[start_offset..end_offset]` is an invariant, asserted by tests.

### Inversion values

- `none` — no marker, or the rule did not opt into inversion sensitivity.
- `canceled` — an even number of markers; polarity stands and the rule may fire.
- `inverted` — an odd number of markers flipped a positive predicate. The rule
  is suppressed and therefore not normally present on the wire; the shape exists
  for diagnostic tests.
- `compliance_then_carve_out` — a negated/compliant base followed by a hostile
  carve-out. This is a distinct hostile shape and always fires.

Markers inside quoted text are ignored.

### Opt-out semantics

`opt_out_available` means the clause contains both an opt-out action (`opt out`,
`reject this arbitration`, `written notice`, …) and a window (`within 30 days`,
`no later than sixty (60) days`, `at any time`, …). A bare email address with no
stated window never qualifies and `opt_out_target` is absent.

`opt_out_target` is the first valid address in the clause, lowercased and rebuilt
from its parts. Common obfuscation (`[at]`, `(at)`, ` at `, `[dot]`, `(dot)`,
` dot `) is accepted. Malformed addresses and prose such as `email us at
example.com` do not produce a target. The action and the window must appear in
the same sentence; that sentence is the *opt-out clause*.

Dispute opt-out association applies to forced-arbitration findings. Other
categories report `opt_out_available: false` until the engine has a way to
associate an opt-out with that category. An arbitration finding's opt-out is
resolved in this order:

1. If the finding's own clause is an opt-out clause, it is used.
2. Otherwise, opt-out clauses within 3 sentences of the finding **and** in the
   same block (no blank line between them) are candidates, excluding any that
   name a foreign subject (`marketing`, `cookie`, `personal data`, …).
3. If any candidate names dispute resolution (`arbitration`, `this provision`,
   …), only those candidates count.
4. If the remaining candidates name more than one distinct address, the
   association is ambiguous: `opt_out_available` is `false`.

An immediately following arbitration opt-out heading can supply the clause
across a block break if no eligible in-block source competes. The reason names
the heading when this happens.

A neighbouring association appends `; opt-out stated in a neighbouring clause of
the same block` to `reason`, so the claim is always explainable from the report.
The score semantics are versioned separately from the opt-out fields.

The engine detects the address; generating mail is out of scope for the engine.

## `DocumentReport`

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `schema_version` | string | `"1.1"` for the category-based score. |
| `findings` | `ClauseFinding[]` | Sorted, as above. |
| `poison_index` | number | Document-level `P_I` in `[0, 100]`, rounded to two decimals. |
| `truncated` | boolean | The engine or extraction layer limited the input. The report covers only the portion scanned. |

`P_I = 100 × (1 − product(1 − w_k/10))`, where `w_k` is the maximum severity
in each detected category. Categories combine with diminishing returns.
Repeated clauses, discretion wording, and opt-out flags do not add or
subtract points. The report retains every scored finding and any linked opt-out wording.

The popup asks for a fresh scan when a stored report uses an older schema
version. Version 1.0 scores used a different scale and are historical.

## Canonical response envelope

`analyze_json` never throws for user text. It returns one of:

```json
{"status":"ok","report":{"schema_version":"1.1","findings":[],"poison_index":0.0,"truncated":false}}
```

```json
{"status":"error","error":{"code":"invalid_input","message":"..."}}
```

`internal_serialization` represents an internal failure. `invalid_input` is
reserved for input validation. The worker checks `status` and forwards a
typed `EngineError`.

## Worker messages

The message shapes are defined in [types.ts](../extension/src/types.ts).
`ANALYZE_TEXT` carries the text and optional flags for extraction truncation,
explicit model review, local PDF mode, and opening the popup after the initial
legal-page scan. `PLAYBACK_FIXTURE` reads a packaged engine response for UI work.

The worker returns `ANALYSIS_RESULT` with a report and any applicable scan
record, comparison, and review candidates. Failures return `ANALYSIS_ERROR`
with an `EngineError`. The worker propagates extraction truncation to
`report.truncated`.

### Storage and tab ownership

The worker writes the latest applicable web scan to
`chrome.storage.local["last_scan"]`. The record includes the URL, tab ID,
scan timestamp, report, and optional comparison and review candidates. It
may contain the source excerpts in the report. The worker checks that the
originating tab remains active before replacing the record, and the popup
only displays a record for its active tab.

The PDF scanner sends extracted text with `local_pdf: true` and keeps its
report in memory for export. It supplies the filename as `source_name` when
building the export. A PDF scan bypasses web scan storage and comparison.

### Page actions

The popup sends `REFRESH_PAGE_REPORT`, `REVIEW_PAGE_REPORT`, or
`JUMP_TO_CLAUSE` to the active tab's content script. Refresh and review
return a scan record or an error message. Jump to Clause carries the page
URL, clause text, start offset, and evidence excerpts. A successful jump
reports whether it highlighted the matching evidence or the entire clause.

The worker requests `AUTO_PAGE_REPORT` on tab activation. Before opening
the toolbar popup after an initial scan, it asks the originating document
whether it is still visible and eligible.

## Optional review

`analyzeReviewJson` and `analyzeReviewJsonForSite` return a pair containing the standard response envelope
and up to 25 model suggestions. Each suggestion has a category and a
`source` excerpt with original UTF-8 byte offsets. A category already
reported by a rule for the same sentence is omitted from suggestions. The
popup stores these separately as `review_candidates` after an explicit
review request. The score and PDF findings come from the rule response.

## Local scan comparison

The service worker keeps up to 24 complete page baselines. Each uses a
SHA-256 digest of the page identity, the extracted text, and the rule and
clause text for each finding. Only digests and the timestamp are retained in
the comparison store. The last scan can include the prior baseline timestamp,
whether extracted text changed, and added/removed finding counts. Partial
reports and scans with more than 250 findings skip comparison. This comparison
reports changes in scanned wording rather than a legal conclusion.

Mandatory arbitration, class restrictions, and jury waivers can produce
separate findings for the same sentence. Their shared category contributes
one signal to the document score. The website scan can supply its hostname
as context for identifying a named amendment actor. The source text and
UTF-8 offsets remain unchanged.

## Determinism

Identical text and provider context produce byte-identical canonical output
across native and Wasm builds. There are no timestamps, hash-map iteration orders, or
locale-dependent operations in the report. `scanned_at` lives only in
`ScanRecord`.
