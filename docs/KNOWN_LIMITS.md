# Known Limits

Honest boundaries of `v0.1.0-base`. These are properties of the shipped design,
not bugs discovered late. Where the held-out run shows a consequence, it is
quoted from [`fixtures/heldout/REPORT.md`](../fixtures/heldout/REPORT.md).
Backlog items that would change these limits are in
[`BACKLOG.md`](BACKLOG.md).

## Detection

### The lexicon decides recall

Matching uses ASCII-case-insensitive phrase lists in `engine/src/lexicon.rs`.
Mandatory arbitration and no-notice modification use whole-word phrases
with flexible whitespace and hyphenation. Other predicates can match
substrings. If a predatory clause is phrased with words that are not
in those lists, it does not fire. The scored rules use a limited grammar and lexicons. The optional review model
uses n-grams and can suggest unfamiliar wording.

Visible consequence at `v0.1.0-base`: `06-marketplace-terms.txt` said a dispute
"shall be settled by arbitration" and produced no finding. The phrase has since
been added with voluntary-arbitration guards (decision 17), but the general
point stands: any phrasing outside the lists is invisible.

When using substring predicates, a phrase must be specific enough to
explain itself. Broad phrases such as `court` are only safe when paired with a
waiver verb and a proximity window, and even then they can drift.

### Only English, only ASCII case folding

No Unicode case folding, no accented or translated terms. In
`13-unicode-translation.txt` the French sentence "Vous waivez tout droit à un
procès avec jury" contributes nothing; the document is found only because its
English sentence contains "shall be resolved by binding arbitration".

### Patterns are shallow

"Predatory" is approximated by shape: a waiver verb near a protected interest, a
mandatory-arbitration phrase near a dispute word, or a class-action term near a
bar. The engine does not understand who benefits, whether the term is
enforceable, or whether local law voids it. Hard negatives reduce obvious
false positives (provider waivers, compliance boilerplate, descriptive mentions,
quoted text, "does not waive") but cannot cover every paraphrase.

### Overlapping rules

Distinct class and jury waivers can both be reported in one sentence. Scoring
counts their shared category once for that sentence. Other overlapping matches
in the same category still resolve in registry order.

### `court_access_waiver` and `class_action_bar` recall is dev-set only

On the labelled dev set (`fixtures/labelled/`) both rules now hit every
realistic phrasing (10/10 each) with no near miss firing; before the lexicon
work they hit 3/10 each. Those are development numbers: the lexicon was extended
while looking at that set. The frozen held-out corpus still records zero hits for
both, partly because the clauses there that mention court are either descriptive
or already claimed by an earlier rule in the same category (one finding per
category per clause). Treat their real-world recall as plausible, not measured.

### Benchmark scope

A provider-separated ToS-100 benchmark measures agreement with four overlapping
labels. An exact-rule check on a small selected panel covers 35 real clauses.
General precision and recall for the full taxonomy remain unmeasured. The corpus is pre-tokenized, several benchmark labels have broader
scope than the rules, and the review model can suggest false positives.
[Measurements](MEASUREMENTS.md#provider-separated-tos-100-review-experiment)
records the counts and split procedure.

### Category coverage

The engine detects forced arbitration and related waivers, plus explicit
provider permission to amend terms without notice. The modification rule
requires both signals in one clause. Silence about notice, cross-clause
conditions beyond adjacent same-block clauses, and unfamiliar wording can escape detection. The additional
categories each start with one explicit pattern. Split-sentence termination
rights, indirect commercial IP grants, liability caps phrased as fixed amounts,
and transfers without a named advertising purpose can escape detection.

## Opt-out

### Bounded opt-out association

An opt-out clause needs an action and a window in one sentence. Arbitration
findings can borrow an opt-out within three sentences of the same block, subject
to competing address and scope checks. An immediately following, explicitly
named arbitration opt-out heading can bridge one block boundary. Other headings,
longer distances, and split action and deadline wording can still escape detection.

### Action plus window, or nothing

A bare address, an address without a window, or a window without an action never
qualifies. The engine does not infer a window from context, a linked policy, or a
jurisdiction's default. It also does not verify deliverability or ownership of an
address.

### Opt-out drafting

The engine reports the supported opt-out action, source clause, and address when
identified. The popup can prepare an editable draft and copy it locally. Verify
the recipient, deadline and required delivery method against the agreement
before using it.

## Input and runtime

### Input caps

The engine truncates at 524,288 bytes on a character boundary. The content script
also caps extracted text at 120,000 UTF-16 code units without splitting a
surrogate pair. The popup and PDF show when either limit truncates the scan.

### Page and PDF coverage

The content script reads visible page text and rendered same-origin HTML
frames or objects. Cross-origin frames, shadow DOM, and Chrome’s built-in PDF
viewer are outside that path. **Scan a PDF** accepts a local PDF up to 20 MB and
reads selectable text across at most 200 pages. Image-only scans and locked
files need a text layer or an unlocked local copy to scan.

Automatic scans require a likely legal URL, title, or main heading.
Navigation and text changes trigger a debounced rescan while the document is
visible. Cosmetic updates that leave the extracted text unchanged are skipped.
A footer link or consent checkbox alone does not qualify. **Refresh report**
can scan ordinary pages on demand.

### Clause context is bounded

The tokenizer joins specific soft line wraps, including split binding
arbitration and no-notice language. Blank lines and list boundaries remain
distinct. The termination rule can connect immediate provider termination
to a clearly stated customer notice requirement in the next same-block
sentence. Explicit, adjacent restrictions on “this right” can suppress a
termination or amendment finding. Distant, implicit, or nested exceptions
can still escape detection.

### Latency numbers are not a browser guarantee

The 10k-word measurements in [`MEASUREMENTS.md`](MEASUREMENTS.md) come from Node
on one machine. The native release path and the Wasm path are not compared for
speed, only for byte parity. A low-end device will be slower, and the 200 ms gate
is a native test, not a Wasm profile in Chrome.

## Determinism and delivery

- The report is deterministic, but the *scan record* is not: `scanned_at` is a
  wall-clock timestamp owned by the UI. Two scans of the same page differ in that
  field and in `url`.
- `poison_index` uses the strongest finding in each category and rounds once.
  It is a summary of flagged wording. It does not estimate legal enforceability
  or whether an opt-out is still available.
- The committed Wasm bytes are the shipped engine. If they are rebuilt without
  regenerating goldens, `make parity` fails rather than silently shipping a
  different engine.
- `wasm-opt` is disabled, so the artifact is larger than it could be. This is a
  size limit, not a correctness one.

## Product surface

The popup shows the last report, supports manual refresh, exports a local PDF,
and can draft an arbitration opt-out. Complete scans can compare against a
previous local SHA-256 fingerprint for the same page. Comparison reports exact
visible-text changes and counts changed findings. Navigation or other unrelated
page text can change the fingerprint. Jump to clause briefly highlights the matching wording within a unique exact
quote. Repeated or changed text may require a fresh scan or a manual search.
Historical document text and persistent page annotations remain open.
