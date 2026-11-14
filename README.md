# PoisonPill: Local Legal Shield

A zero-telemetry Chrome extension (Manifest V3) that deterministically exposes
predatory contract clauses. A Rust→WebAssembly deontic parser runs inside a
dedicated Web Worker and never touches the network.

- Spec: [`PoisonPill Project Documentation (1).md`](PoisonPill%20Project%20Documentation%20(1).md)
- Working notes for agents: [`AGENTS.md`](AGENTS.md)

```sh
make engine      # Rust core -> extension/public/engine.wasm
make extension   # compile TS + assemble ./dist
```

Load `dist/` from `chrome://extensions` → *Load unpacked*.
