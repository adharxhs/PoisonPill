# PoisonPill: Local Legal Shield

A zero-telemetry Chrome extension (Manifest V3) that deterministically exposes
predatory contract clauses. A Rust→WebAssembly deontic parser runs inside a
dedicated Web Worker and never touches the network.

- Spec: [`PoisonPill Project Documentation (1).md`](PoisonPill%20Project%20Documentation%20(1).md)
- Working notes for agents: [`AGENTS.md`](AGENTS.md)
- Wire contract: [`docs/CONTRACT.md`](docs/CONTRACT.md)
- Rule format: [`docs/RULES.md`](docs/RULES.md)
- Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Known limits: [`docs/KNOWN_LIMITS.md`](docs/KNOWN_LIMITS.md)
- Backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md)
- Measurements: [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md)

## Build

```sh
npm install       # once: TypeScript, @types/chrome, esbuild
make engine       # Rust core -> committed extension/public/engine.{js,wasm}
make extension    # bundle TS + assemble ./dist
make verify       # fmt, clippy, tests, size/latency budgets, Wasm parity, typecheck
```

Load `dist/` from `chrome://extensions` → *Load unpacked*.

The Wasm artifacts are committed, so the extension can be built and loaded with
Node alone; Rust is needed only to change detection logic.

## What this base does

- Splits contract text into offset-aware sentences and evaluates declarative
  rules. One category is authored: Forced Arbitration & Class Waiver.
- Detects opt-out actions, windows, and addresses. A bare email is not an opt-out.
- Returns a canonical JSON report with a document-level poison index and is
  byte-identical between native and Wasm builds.
- Analyses at most 512 KiB per document and reports truncation.

## What it deliberately does not do

Highlighting, badges, jump-to-clause, theming, opt-out mail generation, scan
history, and SHA-256 tree-diff memory. The popup is a plain reference view of the
last report. See [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Tests and fixtures

```sh
make test         # unit, integration, corpus/golden invariants
make goldens      # regenerate goldens deliberately; tests never write them
make parity       # shipped Wasm vs native goldens, byte for byte
```

The corpus lives in `fixtures/`; hard negatives are held at 2× positives. The
held-out corpus was run once against the shipped artifact and recorded in
[`fixtures/heldout/REPORT.md`](fixtures/heldout/REPORT.md).
