# Measurements

Recorded at the Wasm milestone (`v0.1.0-base`). Numbers are informative, not
assertions. The only enforced limits are the 2 MiB size gate
(`scripts/check-size.sh`) and the 200 ms native budget
(`engine/tests/budgets.rs`), both run by `make verify`.

## Environment

| Item | Value |
| :--- | :--- |
| CPU | AMD Ryzen 7 7435HS |
| OS | Linux 7.3.3-200.fc44.x86_64 (x86_64) |
| Rust | rustc 1.97.1 (2026-07-14) |
| wasm-pack | 0.15.1 |
| Node | v22.23.1 |
| Profile | release, `opt-level = "z"`, LTO, `panic = "abort"`, `strip` |
| `wasm-opt` | disabled (bundled version rejects the current bulk-memory module) |

## Artifact size

| Artifact | Bytes | Budget |
| :--- | ---: | :--- |
| `extension/public/engine.wasm` | 113,175 (110.5 KiB) | 2,097,152 (2 MiB) |
| `extension/public/engine.js` (glue) | 11,354 (11.1 KiB) | — |
| sha256 (`engine.wasm`) | `eec67c7d81d8fb346dd609606f4c3a95b2bbf92ee7155cb8c60926d148c53e33` | — |

The artifact is ~5% of the size budget, so several categories can be authored
before size becomes a concern.

## Latency: 10,070 words

Fixture: the benign maintenance sentence from `engine/tests/budgets.rs`, repeated
530 times. This document produces no findings, so the number measures scanning
and sentence assembly, not report size. `analyzeJson` also serialises the empty
report.

| Path | Min | Median | Mean | Max | Notes |
| :--- | ---: | ---: | ---: | ---: | :--- |
| Native release (`analyze`) | — | 41.99 ms | — | — | One timed run after warm-up, including `Vec<ClauseFinding>` assembly. |
| Wasm (`analyzeJson`) | 9.84 ms | 9.98 ms | 10.06 ms | 10.78 ms | 20 timed runs after two warm-ups, Node 22. |

The hard budget is 200 ms, so the native path has ~4.8× headroom and the shipped
Wasm path ~20×. The native number being slower than Wasm is expected: the native
test builds debug-friendly `String`/`Vec` evidence through the same generic
code, while the Wasm release build has smaller data to serialise (empty report)
and different allocator behaviour. Neither number is used for cross-runtime
comparison; parity is asserted on bytes, not timing.

## Corpus

| Check | Result |
| :--- | :--- |
| Regression cases | 32 (8 positive, 16 hard negative, 8 ordinary negative) |
| Native/Wasm parity | 32/32 byte-identical canonical JSON |
| Findings offset invariant | Holds for every golden (`raw_text == input[start..end]`) |
| Determinism | Repeated `analyze_json` is byte-identical for every case |
| Truncation through Wasm | Oversize input marked `truncated`, offsets stay valid, no panic on a split character |

## Held-out run

Fourteen held-out documents, written before this milestone, analysed once through
the committed Wasm artifact. Full reports and input digests are in
`fixtures/heldout/REPORT.md`.

| Metric | Result |
| :--- | ---: |
| Documents | 14 |
| Documents with at least one finding | 10 |
| Total findings | 15 |
| `forced_arbitration.mandatory_arbitration` | 7 |
| `forced_arbitration.class_action_waiver` | 5 |
| `forced_arbitration.jury_trial_waiver` | 3 |
| `forced_arbitration.court_access_waiver` | 0 |

Notable misses, recorded without tuning the corpus afterwards:

- `06-marketplace-terms.txt` uses "shall be settled by arbitration", which is not
  in `MANDATORY_ARBITRATION`; the clause is predatory but does not fire.
- Four documents (`01`, `04`, `09`, `14`) state an opt-out window in a sentence
  separate from the arbitration finding. Detection is clause-scoped, so all 15
  held-out findings report `opt_out_available: false` even where the document
  offers an opt-out. This is a cross-clause association gap, not a failure to
  find the address.
- `02-saas-dpa.txt`, `08-insurance-policy.txt` and `10-housing-agreement.txt`
  correctly produce no findings.

These are recall gaps in the authored lexicon, not mechanism failures. They are
listed in `docs/KNOWN_LIMITS.md` and `docs/BACKLOG.md` rather than fixed by
rewriting the held-out set.
