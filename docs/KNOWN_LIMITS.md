# Known limits

## Detection

- The scored rules cover explicit English wording in seven categories. They use
  ASCII case folding and bounded phrase and relation patterns. Unfamiliar
  paraphrases, accented or translated terms, implicit conditions, and nested
  exceptions can escape detection.
- Typical misses include fixed-amount liability caps, indirect commercial IP
  grants, ambiguous or distant termination conditions, and data transfers that
  lack a named advertising purpose. The optional model covers four categories
  and can suggest clauses that a person would reject on review.
- The engine joins certain soft line wraps and recognizes specific adjacent
  same-block relations. Distant cross-references and opt-out action and deadline
  wording split across sentences remain outside that support.
- An opt-out address is extracted from the agreement. The scan cannot verify
  address ownership, deliverability, eligibility, or a user's remaining
  deadline. A score and PDF guidance cannot establish enforceability or
  case-specific legal feasibility.
- General precision and recall across full agreements remain unmeasured. See
  [Measurements](MEASUREMENTS.md) for the development set, provider-separated
  classifier benchmark, and exact-rule regression.

## Input and browser coverage

- Web and PDF extraction are capped at 120,000 UTF-16 code units. The engine
  independently caps its UTF-8 input at 512 KiB. Truncated reports cover only the
  extracted and analyzed portion of the source.
- Web scans read rendered text and visible same-origin HTML embeds, up to 12
  embedded documents and three levels of nesting. Cross-origin frames, shadow
  DOM, and the built-in browser PDF viewer are outside supported extraction.
- Local PDF import supports selectable text in files up to 20 MB. It reads at
  most 200 pages and applies a 20-second read timeout. Image-only or
  password-protected PDFs require a text layer or an unlocked copy.
- Automatic scans require a likely legal URL, title, or main heading. Footer
  links and consent controls alone are insufficient. Use **Refresh report** on
  supported pages that the automatic check misses. Toolbar auto-open depends on
  browser support and the originating document remaining active.
- Jump to Clause requires a unique exact quote. Repeated or changed wording can
  require manual search or a fresh scan. The highlight is temporary.

## Comparison and performance

- The digest comparison can change when unrelated visible text changes. It
  reports added and removed finding counts. The comparison store retains one
  baseline per supported page identity and excludes incomplete scans.
- The release latency gate measures native Rust on a 10,070-word fixture.
  Node Wasm timings and isolated browser smoke tests provide separate evidence.
  Low-end browser latency and peak worker memory remain unprofiled.
