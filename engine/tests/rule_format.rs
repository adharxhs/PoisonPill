//! The rule-format guarantee.
//!
//! This test deliberately defines a category that does not exist anywhere in
//! `src/`. It registers the category as data at runtime and asserts that it
//! fires. If adding a category ever required matcher control-flow changes, this
//! test would stop compiling or stop firing.

use poisonpill_engine::{analyze_with, Modality, Predicate, RuleRegistry, RuleSpec};

const SYNTHETIC_CATEGORY: RuleSpec = RuleSpec {
    rule_id: "synthetic_canary.must_chirp",
    category_id: "synthetic_canary",
    label: "Synthetic Canary",
    modality: Modality::Obligation,
    weight: 3.25,
    required: &[
        Predicate::AnyPhrase(&["synthetic clause"]),
        Predicate::AnyPhrase(&["must chirp"]),
    ],
    optional: &[Predicate::AnyPhrase(&["twice per day"])],
    prohibited: &[Predicate::AnyPhrase(&["must not chirp"])],
    proximity_window: 20,
    inversion_sensitive: false,
};

#[test]
fn a_category_registered_as_data_fires_without_matcher_changes() {
    let mut registry = RuleRegistry::builtin();
    registry.add(SYNTHETIC_CATEGORY);

    let report = analyze_with(
        &registry,
        "The synthetic clause must chirp twice per day. This sentence is unrelated.",
    );

    assert_eq!(report.findings.len(), 1, "synthetic rule must fire once");
    let finding = &report.findings[0];
    assert_eq!(finding.category, "synthetic_canary");
    assert_eq!(finding.label, "Synthetic Canary");
    assert_eq!(finding.rule_id, "synthetic_canary.must_chirp");
    assert_eq!(finding.severity, 3.25);
    assert_eq!(finding.modality, Modality::Obligation);
    assert!(finding.reason.contains("\"synthetic clause\""));
    assert!(finding.reason.contains("\"must chirp\""));
    assert!(finding.reason.contains("\"twice per day\""));
}

#[test]
fn the_synthetic_category_is_not_hard_coded_in_the_shipped_registry() {
    let shipped = RuleRegistry::builtin();
    let report = analyze_with(&shipped, "The synthetic clause must chirp twice per day.");
    assert!(
        report.findings.is_empty(),
        "synthetic category leaked into the shipped data"
    );
}

#[test]
fn prohibited_data_blocks_the_synthetic_category() {
    let mut registry = RuleRegistry::builtin();
    registry.add(SYNTHETIC_CATEGORY);
    let report = analyze_with(
        &registry,
        "The synthetic clause must chirp on paper, but it must not chirp in practice.",
    );
    assert!(report.findings.is_empty());
}
