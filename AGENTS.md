# AGENTS.md

PoisonPill is a local Chrome Manifest V3 extension. Read the
[product specification](docs/PRODUCT.md) before changing behavior.

- **Detection** — read [Rule Format](docs/RULES.md) and [Fixtures](fixtures/README.md)
  before editing Rust rules, tokenization, exceptions, or the review model.
- **Contract** — read [Wire Contract](docs/CONTRACT.md) before changing report
  fields, offsets, opt-out association, messages, or storage. Keep
  `engine/src/model.rs` and `extension/src/types.ts` in sync.
- **Coverage and measurement** — read [Known Limits](docs/KNOWN_LIMITS.md) and
  [Measurements](docs/MEASUREMENTS.md) before changing a detection claim or benchmark.

## Invariants

- Keep clause detection and scoring in Rust. TypeScript handles input selection,
  extraction, transport, storage, and presentation. The worker parses the JSON
  string from Wasm before unwrapping the typed envelope.
- Keep runtime egress at zero. Load PDF.js, fonts, CMaps, Wasm, and playback data
  from packaged extension assets. Keep `storage` as the sole API permission,
  `host_permissions` empty, and the manifest CSP intact, including
  `wasm-unsafe-eval` and `connect-src 'self'`.
- Run analysis in the background service worker. A content script sends text
  via `chrome.runtime.sendMessage`. It cannot construct a Worker from an
  extension URL. The page stays free of injected UI or markup. Jump to Clause
  uses scrolling and the CSS Custom Highlight API.
- Preserve UTF-8 byte offsets into the exact input. The engine cuts oversize
  input at a character boundary at or below 512 KiB. Keep LF normalization
  from `.gitattributes` so offsets and goldens remain portable.
- Keep the comparison store limited to digests and timestamps. Keep review
  candidates separate from scored findings and PDF findings.
- Use Rust 2021, keep the engine free of Chrome APIs, and preserve
  `#![deny(unsafe_code)]`. Handle user text without panicking. Use strict
  TypeScript and validate messages at the boundary.

## Build and verify

Follow the [build instructions](README.md#build-and-load). `dist/` is the
flattened extension root. Keep `dist/`, `engine/target/`, and `engine/pkg/`
out of commits.

1. After a Rust or model change, run `make engine` and include the rebuilt
   `extension/public/engine.js` and `engine.wasm` in the change.
2. For intentional fixture or report changes, run `make goldens` and review
   the diff. Tests read goldens. Preserve the original held-out report and
   use a new frozen set for an independent evaluation.
3. Run `make verify` to check formatting, lint, tests, release budgets,
   native/Wasm parity, and TypeScript. For extension changes, build with
   `make extension` and exercise the affected flow in the unpacked extension.

The background worker is a classic script and loads `engine.js` with top-level
`importScripts`. Content and popup bundles are IIFEs. The PDF scanner is a
module and loads the packaged PDF.js worker.

On Windows without Visual Studio Build Tools, use the Rust GNU toolchain
(`stable-x86_64-pc-windows-gnu`) with the Wasm target. Prebuilt `wasm-pack` and
`wasm-bindgen` binaries avoid the extra MinGW tooling needed to build the CLI.
