//! Deontic extraction and the wasm-bindgen entry point.
//!
//! The current matcher is still the scaffold heuristic; step 4 replaces it with
//! the declarative rule registry. The wire types already live in `model.rs`.

use wasm_bindgen::prelude::*;

use crate::model::{
    AnalyzeResponse, ClauseFinding, DocumentReport, InversionShape, SCHEMA_VERSION,
};
use crate::taxonomy::{self, Category};
use crate::tokenizer::sentences;

#[wasm_bindgen]
pub struct LegalEngine;

#[wasm_bindgen]
impl LegalEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self
    }

    /// Analyse a contract and return a `DocumentReport` as a JS object.
    #[wasm_bindgen(js_name = analyzeDocument)]
    pub fn analyze_document(&self, raw_text: &str) -> JsValue {
        let report = analyze_report(raw_text);
        serde_wasm_bindgen::to_value(&report).unwrap_or(JsValue::NULL)
    }

    /// Canonical JSON form used by parity tests and the worker.
    #[wasm_bindgen(js_name = analyzeJson)]
    pub fn analyze_json(&self, raw_text: &str) -> String {
        let outcome = AnalyzeResponse::ok(analyze_report(raw_text));
        serde_json::to_string(&outcome).unwrap_or_else(|error| {
            serde_json::json!({
                "status": "error",
                "error": { "code": "internal_serialization", "message": error.to_string() }
            })
            .to_string()
        })
    }
}

impl Default for LegalEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Classify every sentence against the taxonomy.
pub fn analyze(raw_text: &str) -> Vec<ClauseFinding> {
    analyze_report(raw_text).findings
}

pub fn analyze_report(raw_text: &str) -> DocumentReport {
    let mut findings = Vec::new();
    let mut cursor = 0usize;

    for sentence in sentences(raw_text) {
        let start = raw_text[cursor..]
            .find(sentence)
            .map(|offset| cursor + offset)
            .unwrap_or(cursor);
        let end = start + sentence.len();
        cursor = end;

        let normalized = sentence.to_lowercase();
        for category in Category::ALL {
            if !taxonomy::matches(category, &normalized) {
                continue;
            }

            let opt_out_available = has_opt_out_window(&normalized);
            findings.push(ClauseFinding {
                category: category.id().to_string(),
                label: category.label().to_string(),
                rule_id: format!("{}.scaffold", category.id()),
                raw_text: sentence.to_string(),
                modality: category.modality(),
                severity: category.weight(),
                start_offset: start,
                end_offset: end,
                opt_out_available,
                opt_out_target: if opt_out_available {
                    extract_opt_out_address(sentence)
                } else {
                    None
                },
                inversion: InversionShape::None,
                reason: format!("matched the scaffold footprint for {}", category.label()),
            });
        }
    }

    DocumentReport {
        schema_version: SCHEMA_VERSION.to_string(),
        poison_index: poison_index(&findings),
        findings,
        truncated: false,
    }
}

/// `P_I = min(100, sum(w * mu * tau))`.
///
/// `mu` doubles when discretion is strictly unilateral; `tau` decays to `0.1`
/// when the clause ships an opt-out, because the right is not fully stripped.
pub fn poison_index(findings: &[ClauseFinding]) -> f32 {
    let total: f32 = findings
        .iter()
        .map(|f| {
            let unilateral = f.raw_text.to_lowercase().contains("sole discretion");
            let mu = if unilateral { 2.0 } else { 1.0 };
            let tau = if f.opt_out_available { 0.1 } else { 1.0 };
            f.severity * mu * tau
        })
        .sum();

    total.clamp(0.0, 100.0)
}

fn has_opt_out_window(normalized: &str) -> bool {
    normalized.contains("opt-out")
        || normalized.contains("opt out")
        || normalized.contains("30 days")
        || normalized.contains("thirty (30)")
}

/// Pull the first email-shaped token out of an opt-out sentence.
fn extract_opt_out_address(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| {
                !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_'
            })
        })
        .map(|word| word.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '>']))
        .find(|word| {
            word.contains('@')
                && word
                    .split('@')
                    .nth(1)
                    .is_some_and(|domain| domain.contains('.'))
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Modality;

    #[test]
    fn finds_arbitration_clause_and_opt_out() {
        let doc = "You waive any right to a jury trial or class action, \
                   unless you opt-out within 30 days by emailing arb@example.com.";
        let findings = analyze(doc);
        assert!(findings.iter().any(|f| f.opt_out_available));
        assert!(findings
            .iter()
            .any(|f| f.opt_out_target.as_deref() == Some("arb@example.com")));
    }

    #[test]
    fn finding_offsets_slice_the_input() {
        let doc = "Intro. You waive any right to a class action.";
        let findings = analyze(doc);
        let finding = findings.first().expect("expected a finding");
        assert_eq!(
            &doc[finding.start_offset..finding.end_offset],
            finding.raw_text
        );
    }

    #[test]
    fn poison_index_is_bounded() {
        let finding = ClauseFinding {
            category: "forced_arbitration".into(),
            label: "Forced Arbitration & Class Waiver".into(),
            rule_id: "forced_arbitration.scaffold".into(),
            raw_text: "waive class action at our sole discretion".into(),
            modality: Modality::Waiver,
            severity: 5.0,
            start_offset: 0,
            end_offset: 0,
            opt_out_available: false,
            opt_out_target: None,
            inversion: InversionShape::None,
            reason: "test".into(),
        };
        let many = vec![finding; 40];
        assert_eq!(poison_index(&many), 100.0);
    }

    #[test]
    fn inversion_count_ignores_plain_text() {
        assert_eq!(
            crate::exceptions::inversion_depth("we may share your data"),
            0
        );
    }
}
