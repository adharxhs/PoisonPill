# Rule Format

Rules are ordered Rust data in [rules.rs](../engine/src/rules.rs). Phrase lists
live in [lexicon.rs](../engine/src/lexicon.rs) and actor/action patterns in
[relations.rs](../engine/src/relations.rs). Add rules through the registry
and reuse its category-agnostic evaluator.

## Shipped categories

| Category | Weight | Scored wording |
| :--- | ---: | :--- |
| `forced_arbitration` | 5.0 | Mandatory arbitration, class restrictions, jury waiver, or court-access waiver. |
| `intellectual_property` | 4.5 | Perpetual commercial licence over user content. |
| `unilateral_modification` | 4.0 | Provider can change contractual terms without notice. |
| `termination_asymmetry` | 4.0 | Provider can terminate immediately while the customer owes notice. |
| `liability_caps` | 3.5 | Provider liability capped at fees the customer paid. |
| `indemnification` | 3.5 | User indemnity with legal or defence costs. |
| `surveillance` | 3.0 | Sharing personal information for advertising. |

Liability and termination weights are provisional. The
[wire contract](CONTRACT.md#documentreport) defines how finding weights
combine into the Poison Index.

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
- `AnyPhrase` returns the listed phrase with the **earliest** source match. That phrase becomes
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
  matching rule per clause. The document score uses the strongest finding in each category.
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

## Add or broaden a rule

1. Start with a real clause and a narrow claim about what should fire. Use the
   current `surveillance.advertising_disclosure` rule for an example of a
   relation binding the provider, data, and advertising qualifier.
2. Add specific phrases or a relation pattern and register the `RuleSpec` in
   `BUILTIN_RULES`. Account for scope, voluntary wording, and compliance
   exceptions with guards where appropriate. Verify that the evidence explains
   the flag and points to the original text.
3. Add fixtures under [cases](../fixtures/README.md), including two plausible
   hard negatives per positive. Run `make goldens` and review rule IDs, source
   ranges, and score changes.
4. Run `make verify`. The runtime-registration test in
   [rule_format.rs](../engine/tests/rule_format.rs) verifies that the registry
   can evaluate a new category without matcher changes.
