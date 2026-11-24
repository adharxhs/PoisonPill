# PoisonPill: Local Legal Shield

PoisonPill is a local Chrome Manifest V3 extension that flags potentially
harmful wording in terms of service, privacy policies, and other agreements.
Its Rust engine runs as WebAssembly in the extension's background service
worker. Page scans, PDF scans, and report exports run on the device.

## Build and load

Use Node 22 or later. The repository includes the built Rust engine.

```sh
npm ci
make extension
```

Open `chrome://extensions` (or `brave://extensions`), enable **Developer mode**,
and choose **Load unpacked**. Select the generated `dist/` directory. After
rebuilding, reload the extension and refresh any open pages you want to scan.

To build or verify the Rust engine, install Rust, the
`wasm32-unknown-unknown` target, and `wasm-pack`. Then run `make verify`.
Run `make typecheck` for a TypeScript-only check.

## Scan an agreement

- Open or switch to a likely legal page. The extension scans the visible text
  and rescans when it changes. On Chrome 127 or later, the toolbar popup can
  open after the first automatic scan of a newly loaded legal page.
- Use **Refresh report** to scan the active page on demand. Use **Jump to
  clause** to scroll to and highlight matched wording when the source can be
  located. Findings with a supported arbitration opt-out may offer a copyable
  draft.
- Use **Review more clauses** for optional offline model suggestions on a web
  page. The popup lists these separately from the scored findings.
- Use **Scan a PDF** to choose a local PDF with selectable text. Use the
  download button in either scan view to save a grouped report with
  plain-language explanations, practical next steps, and technical evidence.

See the [product specification](docs/PRODUCT.md) for the score, coverage, and
report behavior. See [known limits](docs/KNOWN_LIMITS.md) for what can escape a
scan and [measurements](docs/MEASUREMENTS.md) for the latest test results.

## Developer references

- [Contributor instructions](AGENTS.md) for build constraints and verification
- [Wire contract](docs/CONTRACT.md) for reports, worker messages, and storage
- [Rule authoring](docs/RULES.md) and [fixtures](fixtures/README.md) for detection changes
- [Design decisions](docs/DECISIONS.md) and [backlog](docs/BACKLOG.md) for trade-offs and open work
