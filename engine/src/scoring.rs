//! The Poison Index.
//!
//! `P_I = min(100, Σ w_k · μ(C_k) · τ(C_k))`, computed once at document level.
//! All arithmetic is f64 internally and rounded to two decimals before it is
//! cast to the f32 wire type, so native and Wasm builds format identically.

use std::collections::HashSet;

use crate::lexicon;
use crate::model::ClauseFinding;
use crate::rules::find_phrase;

/// `μ` when the clause grants strictly unilateral discretion.
pub const MU_UNILATERAL: f64 = 2.0;
/// `μ` for ordinary asymmetric clauses.
pub const MU_BASE: f64 = 1.0;
/// `τ` when an opt-out window is legally stated.
pub const TAU_OPT_OUT: f64 = 0.1;
/// `τ` when no opt-out is stated.
pub const TAU_NONE: f64 = 1.0;

/// `μ(C)`: 2.0 when any unilateral-discretion phrase occurs, else 1.0.
pub fn asymmetry_multiplier(finding: &ClauseFinding) -> f64 {
    if lexicon::UNILATERAL_DISCRETION
        .iter()
        .any(|phrase| find_phrase(&finding.raw_text, phrase).is_some())
    {
        MU_UNILATERAL
    } else {
        MU_BASE
    }
}

/// `τ(C)`: the right is not fully stripped when the user can opt out.
pub fn opt_out_decay(opt_out_available: bool) -> f64 {
    if opt_out_available {
        TAU_OPT_OUT
    } else {
        TAU_NONE
    }
}

/// One clause's contribution to the document score.
pub fn finding_contribution(finding: &ClauseFinding) -> f64 {
    finding.severity as f64
        * asymmetry_multiplier(finding)
        * opt_out_decay(finding.opt_out_available)
}

/// Document-level `P_I`, clamped to `[0, 100]` and rounded to two decimals.
pub fn poison_index(findings: &[ClauseFinding]) -> f32 {
    // Fold from an explicit `0.0` instead of `sum()`: the float `Sum` seed is
    // `-0.0`, which an empty report would serialise as `poison_index:-0.0`.
    // The report may explain two rights waived in a single sentence.
    // Score its category once, in the same order as the findings.
    let mut scored = HashSet::new();
    let total: f64 = findings
        .iter()
        .filter(|finding| {
            scored.insert((
                finding.start_offset,
                finding.end_offset,
                finding.category.as_str(),
            ))
        })
        .map(finding_contribution)
        .fold(0.0, |sum, contribution| sum + contribution);
    let clamped = total.clamp(0.0, 100.0);
    let rounded = (clamped * 100.0).round() / 100.0;
    rounded as f32
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
    fn contributions_are_exact() {
        let cases = [
            (5.0f32, false, "you waive class actions", 5.0f64),
            (5.0, true, "you waive class actions", 0.5),
            (
                5.0,
                false,
                "you waive class actions at our sole discretion",
                10.0,
            ),
            (
                5.0,
                true,
                "you waive class actions at our sole discretion",
                1.0,
            ),
            (3.25, false, "ordinary clause", 3.25),
            (3.25, true, "ordinary clause", 0.325),
            (4.0, false, "we may act unilaterally", 8.0),
        ];

        for (severity, opt_out, text, expected) in cases {
            let clause = finding(severity, text, opt_out);
            assert_eq!(
                finding_contribution(&clause),
                expected,
                "severity={severity} opt_out={opt_out} text={text}"
            );
        }
    }

    #[test]
    fn document_score_sums_and_rounds() {
        let clause = finding(3.25, "ordinary clause", true);
        assert_eq!(poison_index(&[clause]), 0.33);
    }

    #[test]
    fn document_score_is_clamped() {
        let clause = finding(5.0, "you waive class actions", false);
        let many: Vec<_> = (0..40)
            .map(|index| {
                let mut finding = clause.clone();
                finding.start_offset = index * finding.raw_text.len();
                finding.end_offset = finding.start_offset + finding.raw_text.len();
                finding
            })
            .collect();
        assert_eq!(poison_index(&many), 100.0);
    }

    #[test]
    fn empty_document_scores_zero() {
        let score = poison_index(&[]);
        assert_eq!(score, 0.0);
        assert!(
            score.is_sign_positive(),
            "an empty report must serialise as 0.0, not -0.0"
        );
    }

    #[test]
    fn unilateral_markers_are_case_insensitive() {
        let clause = finding(5.0, "You Waive Claims At Our Sole Discretion", false);
        assert_eq!(asymmetry_multiplier(&clause), MU_UNILATERAL);
    }
}
