# AGENTS.md

PoisonPill is a local-first Chrome Manifest V3 extension that flags predatory contract clauses using a Rust→WebAssembly deontic parser. It must never make a network request.

`PoisonPill Project Documentation (1).md` is the product spec: taxonomy, formulas, directory layout, and illustrative code. Read it before changing behaviour. Its snippets are partial examples, not the shipped implementation — this file describes the actual repo.

## Layout

| Path | Role |
| :--- | :--- |
| `engine/` | Rust crate compiled to `wasm-bindgen`. The only place detection logic lives. |
| `engine/src/lib.rs` | Module wiring and re-exports; the wasm binding module is scoped separately. |
| `engine/src/model.rs` | Wire contract v1: `ClauseFinding`, `DocumentReport`, typed errors. |
| `engine/src/tokenizer.rs` | Linear sentence splitter with offsets and abbreviation guards. |
| `engine/src/deontic.rs` | Actor/modality extraction and the engine entry point. |
| `engine/src/exceptions.rs` | Boundary-marker inversion calculus (`NetPolarity`). |
| `engine/src/lexicon.rs` | Phrase data (actors, verbs, assets, guards) the content engineer extends. |
| `engine/src/rules.rs` | Declarative `RuleSpec` data and the category-agnostic evaluator. |
| `extension/src/` | TypeScript: `content.ts`, `worker.ts`, `popup.ts`, `optout.ts`. |
| `extension/public/` | Static assets copied verbatim; `engine.wasm` is generated. |
| `manifest.json` | MV3 manifest, kept at the repo root. |
| `Makefile` | Build and assembly entry points. |

## Build

```sh
make engine      # cargo + wasm-pack -> extension/public/engine.wasm
make extension   # type-check/compile TS and assemble ./dist
make clean
```

`dist/` is the unpacked extension (manifest, icons, compiled JS, public assets flattened to its root). Load it with `chrome://extensions` → *Load unpacked*. Never commit `dist/`, `engine/target/`, `engine/pkg/`, or `engine.wasm`.

Prerequisites not currently installed on this machine: `wasm-pack` (`cargo install wasm-pack`) and the `wasm32-unknown-unknown` target. TypeScript build tooling is not yet configured — `make extension` is a stub until `package.json`/`tsconfig.json` land.

## Invariants

- **Zero network egress.** No `fetch`, `XMLHttpRequest`, WebSocket, telemetry, CDN fonts, or remote stylesheets in extension code. `manifest.json` grants `storage` only — `host_permissions` stays empty and `content_scripts.matches` covers `<all_urls>` without granting fetch rights.
- **Detection lives in Rust.** Content scripts extract text and render badges; they do not classify clauses. Adding a heuristic in TypeScript is a design regression.
- **The Wasm contract is snake_case JSON.** The Rust source of truth is `engine/src/model.rs`; `extension/src/types.ts` mirrors it exactly. `ClauseFinding` carries `category`, `label`, `rule_id`, `raw_text`, `modality`, `severity`, `start_offset`, `end_offset`, `opt_out_available`, `opt_out_target`, `inversion`, `reason`. Offsets are byte offsets into the input string. See `docs/CONTRACT.md`.
- **Analysis runs off the main thread.** All parsing goes through `worker.js`; the content script only posts text and consumes findings.
- **`wasm-unsafe-eval` stays in the CSP.** Removing it breaks Wasm instantiation; widen nothing else.
- **No DOM writes before findings exist.** Badges, highlights, and shields are idempotent and removable.

## Conventions

- Rust: edition 2021, `#![deny(unsafe_code)]` unless a comment justifies it, no panics on user text (`unwrap` only on serialisation of owned structs).
- Severity weights come from `RuleSpec.weight` in `rules.rs` and follow the spec table (arbitration `5.0` … surveillance `3.0`). Scores are normalised into `P_I ∈ [0, 100]` at the document level, never per clause. Only Forced Arbitration is authored; the other four categories are empty slots. See `docs/RULES.md`.
- Opt-out addresses are extracted only from text that also states an opt-out window; a bare email is not an opt-out target.
- Keep `engine` free of Chrome APIs so it stays testable with plain `cargo test`.
- TypeScript: strict mode, no `any` at the worker boundary, explicit `MessageEvent` types.

## Gotchas

- `manifest.json` references the Flattened `dist/` root, so asset paths (`icons/…`, `popup.html`) are relative to `dist`, not `extension/`.
- Wasm artifacts are build output. `extension/public/engine.wasm` is gitignored; `extension/public/.gitkeep` keeps the folder tracked.
- Chrome loads `worker.js` as a classic worker via `chrome.runtime.getURL`; it must not be emitted as an ES module.
- The spec's `$P_I$` weighting uses per-category `w_k`; the taxonomy table is authoritative when numbers disagree.
- Tree-diff/audit findings use SHA-256 fingerprints in `chrome.storage.local`; storage is small (~10 MB), so store digests and offsets, not full contract text.
