# Rule Format

The engine's matcher is category-agnostic. A category is a **data file**, not a
branch in the matcher. This document is the extension contract: if adding a
category requires editing `rules.rs` control flow, the design has failed.

## Files

| File | Role |
| :--- | :--- |
| `engine/src/lexicon.rs` | Phrase lists: waiver verbs, actors, assets, compliance guards, discretion markers. |
| `engine/src/rules.rs` | `RuleSpec` / `Predicate` types, the evaluator, and authored rule data. |
| `fixtures/cases/` | The input `.txt` for every case, grouped `positive/`, `hard_negative/`, `negative/`. |
| `fixtures/golden/` | One canonical envelope per case, written only by `make goldens`. |
| `engine/tests/rule_format.rs` | Proves a synthetic category can be registered at runtime as data. |

The registry includes arbitration and waivers, no-notice modification, perpetual
commercial IP grants, user indemnity with legal costs, advertising disclosures,
provider liability capped at fees paid, and asymmetric termination notice.
The first three new categories use the product taxonomy weights. Liability caps
use 3.5 and termination asymmetry uses 4.0 as provisional review weights, since
the product taxonomy did not assign either a weight. These rules look for
concrete language within one clause.

## `RuleSpec`

```rust
pub struct RuleSpec {
    pub rule_id: &'static str,          // concrete rule, stable on the wire
    pub category_id: &'static str,      // stable category id, stable on the wire
    pub label: &'static str,            // human label
    pub modality: Modality,             // Obligation | Permission | Prohibition | Waiver
    pub weight: f32,                    // w_k in [1.0, 5.0]
    pub required: &'static [Predicate], // all must match
    pub optional: &'static [Predicate], // any match adds evidence, never gates
    pub prohibited: &'static [Predicate], // any match suppresses the rule
    pub proximity_window: usize,        // max words between required matches; 0 disables
    pub inversion_sensitive: bool,      // opt into exception-marker calculus
}
```

### Predicate semantics

```rust
pub enum Predicate {
    AnyPhrase(&'static [&'static str]),
    AnyTokenPhrase(&'static [&'static str]),
    Relation(Pattern),
    Either(&'static [Predicate]),
    AllPhrases(&'static [&'static str]),
    Near { left: &'static [&'static str], right: &'static [&'static str] },
}
```

- Matching is ASCII-case-insensitive. Existing phrase predicates use substrings.
  `AnyTokenPhrase` requires whole words, accepts whitespace and selected punctuation
  between them, and retains byte spans into the original clause. The tokenizer
  joins specific soft wraps.
- `Relation` binds an explicit actor, deontic force, action, object, and nearby
  qualifier. It keeps separate byte spans for the matched action and qualifier.
  The amendment, advertising disclosure, and immediate provider termination
  rules use it. Amendment rules can recognize a clause-initial named provider
  or an actor matching the scanned website’s hostname label. Unsupported
  grammatical forms fall through.
- `AnyPhrase` returns the **earliest** listed phrase. That phrase becomes
  explainability evidence.
- `AllPhrases` requires every phrase and reports all of them.
- `Either` takes the first matching predicate and exposes its evidence.
- `Near` needs one phrase from each side within the rule's `proximity_window`.
- `prohibited` is evaluated before `optional`.
- `optional` exists for supporting evidence (for example `plaintiff` or
  `class member`). It never changes whether the rule fires.

### Why evidence matters

Every finding carries `reason`, generated only from `RuleMatch.evidence`, e.g.:

> matched "waive", "class member" in the clause

If a rule cannot produce that sentence from data it matched, the rule is too
coincidental to ship.

### Determinism

- Rules are evaluated in registry order.
- Arbitration, class restrictions, and jury waivers can be reported together
  for the same sentence. Explicit class bars take precedence when a later
  waiver concerns another right. Generic court matches and duplicate class
  findings are suppressed where they overlap. Other categories keep the first
  matching rule per clause. The score counts each category once per range.
- Findings are emitted in sentence order, and the tokenizer is linear.
- No hash maps participate in output ordering.

### Inversion

`inversion_sensitive: false` is the default for explicit arbitration language.
When true, exception markers (`except`, `unless`, `provided that`,
`notwithstanding`, `save for`, `at our sole discretion`) are counted outside
quoted text:

- even count → `canceled`, the rule may fire;
- odd count with a positive base → `inverted`, the rule is suppressed;
- negated/compliant base followed by a hostile carve-out →
  `compliance_then_carve_out`, always fires.

Set it only when a category's predicate can legitimately be inverted by a
subordinate clause.

## Worked example: adding Surveillance & Data Cascades

This is the complete change set. No evaluator code is touched.

### 1. Add lexicon data

In `engine/src/lexicon.rs`:

```rust
pub const DISCLOSURE_VERBS: &[&str] = &["sell", "share", "disclose", "transfer"];
pub const DATA_ASSETS: &[&str] = &["personal information", "personal data", "usage data"];
pub const THIRD_PARTIES: &[&str] = &["third part", "affiliate", "partner", "advertiser"];
```

Lexicons are data. Prefer several precise phrases over one broad substring; a
broad phrase creates unexplainable findings.

### 2. Add one `RuleSpec`

In `engine/src/rules.rs`:

```rust
pub const SURVEILLANCE_RULES: &[RuleSpec] = &[RuleSpec {
    rule_id: "surveillance.third_party_disclosure",
    category_id: "surveillance",
    label: "Surveillance & Data Cascades",
    modality: Modality::Permission,
    weight: 3.0,
    required: &[
        Predicate::AnyPhrase(lexicon::DISCLOSURE_VERBS),
        Predicate::AnyPhrase(lexicon::DATA_ASSETS),
        Predicate::AnyPhrase(lexicon::THIRD_PARTIES),
    ],
    optional: &[],
    prohibited: &[Predicate::AnyPhrase(&[
        "we do not sell",
        "we will never sell",
        "do not share",
    ])],
    proximity_window: 35,
    inversion_sensitive: false,
}];
```

Then register the data:

```rust
pub const BUILTIN_RULES: &[RuleSpec] = &[
    // ...existing arbitration rules...
];
```

Because Rust does not concatenate slices in a `const`, either append the rules
to the literal array or add a registration line in `RuleRegistry::builtin`:

```rust
pub fn builtin() -> Self {
    let mut rules = BUILTIN_RULES.to_vec();
    rules.extend_from_slice(SURVEILLANCE_RULES);
    Self::new(rules)
}
```

Appending to the array is preferred; it keeps one ordered list.

### 3. Add fixtures

Add an input under `fixtures/cases/` — a `.txt` in `positive/` or in
`hard_negative/` — then run `make goldens` to write the matching
`fixtures/golden/` envelope. At least two hard negatives per positive: the
`hard_negatives_outnumber_positives_two_to_one` test enforces the ratio. Run
`make verify`. Goldens are never auto-updated by tests: a diff is a decision to
review.

### 4. Prove the seam

`engine/tests/rule_format.rs` registers a synthetic category at runtime. It must
stay green after your category is added. Do not delete it.

## What not to do

- Do not add category-specific branches to `RuleRegistry::matches`.
- Do not add regex for one phrasing; add a lexicon phrase.
- Do not set `inversion_sensitive` to make a false negative disappear.
- Do not put product UI strings, emails, or mailto logic in rule data.
- Do not add a second category while building the mechanism layer.
