//! Deontic extraction: actors, modalities, and the wasm-bindgen entry point.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::taxonomy::{self, Category};
use crate::tokenizer::sentences;

/// Deontic modality carried by a clause edge.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Modality {
    Obligation,
    Permission,
    Prohibition,
    Waiver,
}

/// One flagged clause. Field names are the JS contract: keep snake_case.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClauseFinding {
    pub category: String,
    pub raw_text: String,
    pub modality: Modality,
    pub severity: f32,
    pub opt_out_available: bool,
    pub opt_out_target: Option<String>,
}

/// Full analysis result consumed by the popup.
#[derive(Serialize, Deserialize, Debug)]
pub struct DocumentReport {
    pub findings: Vec<ClauseFinding>,
    /// Normalised `P_I` in `[0, 100]`.
    pub poison_index: f32,
}

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
        let findings = analyze(raw_text);
        let report = DocumentReport {
            poison_index: poison_index(&findings),
            findings,
        };
        serde_wasm_bindgen::to_value(&report).unwrap_or(JsValue::NULL)
    }
}

impl Default for LegalEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Classify every sentence against the taxonomy.
pub fn analyze(raw_text: &str) -> Vec<ClauseFinding> {
    let mut findings = Vec::new();

    for sentence in sentences(raw_text) {
        let normalized = sentence.to_lowercase();
        for category in Category::ALL {
            if !taxonomy::matches(category, &normalized) {
                continue;
            }
            let opt_out_available = has_opt_out_window(&normalized);
            findings.push(ClauseFinding {
                category: category.label().to_string(),
                raw_text: sentence.to_string(),
                modality: category.modality(),
                severity: category.weight(),
                opt_out_available,
                opt_out_target: if opt_out_available {
                    extract_opt_out_address(sentence)
                } else {
                    None
                },
            });
        }
    }

    findings
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
            word.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_')
        })
        .find(|word| {
            word.contains('@')
                && word.split('@').nth(1).is_some_and(|domain| domain.contains('.'))
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_arbitration_clause_and_opt_out() {
        let doc = "You waive any right to a jury trial or class action, \
                   unless you opt-out within 30 days by emailing arb@example.com.";
        let findings = analyze(doc);
        assert!(findings.iter().any(|f| f.opt_out_available));
        assert!(findings.iter().any(|f| f.opt_out_target.as_deref() == Some("arb@example.com")));
    }

    #[test]
    fn poison_index_is_bounded() {
        let finding = ClauseFinding {
            category: "Forced Arbitration & Class Waiver".into(),
            raw_text: "waive class action at our sole discretion".into(),
            modality: Modality::Waiver,
            severity: 5.0,
            opt_out_available: false,
            opt_out_target: None,
        };
        let many = vec![finding; 40];
        assert_eq!(poison_index(&many), 100.0);
    }

    #[test]
    fn inversion_count_ignores_plain_text() {
        assert_eq!(crate::exceptions::inversion_depth("we may share your data"), 0);
    }
}
