//! Document score based on the strongest scored finding in each category.
//!
//! For each represented category, normalize its strongest weight to [0, 0.5].
//! The compound score is `100 * (1 - product(1 - category_signal))`, a
//! bounded index with diminishing returns across categories.

use std::collections::BTreeMap;

use crate::model::ClauseFinding;

/// Score for one finding in isolation. The document combines category signals,
/// so isolated scores cannot be added together.
pub fn finding_contribution(finding: &ClauseFinding) -> f64 {
    if !finding.severity.is_finite() {
        return 0.0;
    }
    f64::from(finding.severity).clamp(0.0, 5.0) * 10.0
}

/// Document-level Poison Index in [0, 100], rounded to two decimals.
pub fn poison_index(findings: &[ClauseFinding]) -> f32 {
    let mut strongest = BTreeMap::new();
    for finding in findings {
        let points = finding_contribution(finding);
        strongest
            .entry(finding.category.as_str())
            .and_modify(|current: &mut f64| *current = current.max(points))
            .or_insert(points);
    }

    // Category order is deterministic for both arithmetic and serialization.
    let remainder = strongest
        .values()
        .fold(1.0, |remaining, points| remaining * (1.0 - points / 100.0));
    (((1.0 - remainder) * 10_000.0).round() / 100.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{InversionShape, Modality};

    fn finding(severity: f32, raw_text: &str, opt_out_available: bool) -> ClauseFinding {
        ClauseFinding {
            category: "forced_arbitration".into(),
            label: "Forced Arbitration & Class Waiver".into(),
            rule_id: "forced_arbitration.class_action_waiver".into(),
            raw_text: raw_text.into(),
            modality: Modality::Waiver,
            severity,
            start_offset: 0,
            end_offset: raw_text.len(),
            opt_out_available,
            opt_out_target: None,
            inversion: InversionShape::None,
            reason: "test".into(),
            evidence: vec![],
            opt_out_source: None,
        }
    }

    #[test]
    fn distinct_categories_accumulate_with_diminishing_returns() {
        let arbitration = finding(5.0, "Disputes must go to arbitration.", false);
        let mut amendment = finding(4.0, "We may change these terms.", false);
        amendment.category = "unilateral_modification".into();
        let mut disclosure = finding(3.0, "We share data with advertisers.", false);
        disclosure.category = "surveillance".into();

        assert_eq!(poison_index(std::slice::from_ref(&arbitration)), 50.0);
        assert_eq!(poison_index(&[arbitration, amendment, disclosure]), 79.0);
    }

    #[test]
    fn strongest_clause_sets_category_score_regardless_of_repetition() {
        let strongest = finding(5.0, "Disputes must go to arbitration.", false);
        let mut findings = vec![strongest];
        for index in 1..=20 {
            let mut related = finding(4.0, "Other wording about arbitration.", false);
            related.start_offset = index * 100;
            related.end_offset = related.start_offset + related.raw_text.len();
            findings.push(related);
        }
        assert_eq!(poison_index(&findings), 50.0);
        findings.reverse();
        assert_eq!(poison_index(&findings), 50.0);
    }

    #[test]
    fn wording_alone_cannot_establish_an_opt_out_is_still_available() {
        let clause = finding(5.0, "Disputes must go to arbitration.", false);
        let mut with_opt_out = clause.clone();
        with_opt_out.opt_out_available = true;
        assert_eq!(poison_index(&[clause]), poison_index(&[with_opt_out]));
    }

    #[test]
    fn discretion_words_in_the_text_do_not_multiply_a_category_weight() {
        let plain = finding(4.0, "We may amend these terms without prior notice.", false);
        let with_discretion = finding(4.0, "We may change these terms at any time.", false);
        assert_eq!(poison_index(&[plain]), 40.0);
        assert_eq!(poison_index(&[with_discretion]), 40.0);
    }

    #[test]
    fn distinct_categories_are_order_independent_and_bounded() {
        let mut findings = Vec::new();
        for index in 0..100 {
            let mut clause = finding(5.0, "Ordinary example.", false);
            clause.category = format!("category_{index}");
            findings.push(clause);
        }
        assert_eq!(poison_index(&findings), 100.0);
        findings.reverse();
        assert_eq!(poison_index(&findings), 100.0);
    }

    #[test]
    fn empty_document_scores_positive_zero() {
        let score = poison_index(&[]);
        assert_eq!(score, 0.0);
        assert!(score.is_sign_positive());
    }
}
