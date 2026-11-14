//! Deontic extraction and the wasm-bindgen entry point.
//!
//! Detection is entirely driven by `rules::RuleRegistry`; this module only
//! walks sentences, turns rule matches into wire findings, and attaches
//! opt-out/scoring evidence.

use wasm_bindgen::prelude::*;

use crate::exceptions::classify;
use crate::model::{
    AnalyzeResponse, ClauseFinding, DocumentReport, InversionShape, SCHEMA_VERSION,
};
use crate::rules::{RuleMatch, RuleRegistry};
use crate::tokenizer::sentences;

#[wasm_bindgen]
pub struct LegalEngine {
    registry: RuleRegistry,
}

#[wasm_bindgen]
impl LegalEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            registry: RuleRegistry::builtin(),
        }
    }

    /// Analyse a contract and return a `DocumentReport` as a JS object.
    #[wasm_bindgen(js_name = analyzeDocument)]
    pub fn analyze_document(&self, raw_text: &str) -> JsValue {
        let report = analyze_with(&self.registry, raw_text);
        serde_wasm_bindgen::to_value(&report).unwrap_or(JsValue::NULL)
    }

    /// Canonical JSON form used by parity tests and the worker.
    #[wasm_bindgen(js_name = analyzeJson)]
    pub fn analyze_json(&self, raw_text: &str) -> String {
        let outcome = AnalyzeResponse::ok(analyze_with(&self.registry, raw_text));
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

impl LegalEngine {
    /// Native-only seam for the runtime rule-format guarantee test.
    pub fn with_registry(registry: RuleRegistry) -> Self {
        Self { registry }
    }

    pub fn registry(&self) -> &RuleRegistry {
        &self.registry
    }
}

/// Analyse with the shipped registry.
pub fn analyze(raw_text: &str) -> Vec<ClauseFinding> {
    analyze_with(&RuleRegistry::builtin(), raw_text).findings
}

/// Analyse with an arbitrary registry. This is the function the guarantee test
/// uses to prove that a synthetic category can be registered as data.
pub fn analyze_with(registry: &RuleRegistry, raw_text: &str) -> DocumentReport {
    let mut findings = Vec::new();

    for sentence in sentences(raw_text) {
        let clause = sentence.text;
        let normalized = clause.to_lowercase();
        let mut emitted_categories: Vec<&'static str> = Vec::new();

        for rule_match in registry.matches(clause) {
            let inversion = classify(clause, rule_match.inversion_sensitive, &rule_match.spans);
            if inversion == InversionShape::Inverted {
                continue;
            }

            // One finding per category per clause, selected by registry order.
            if emitted_categories.contains(&rule_match.category_id) {
                continue;
            }
            emitted_categories.push(rule_match.category_id);

            let opt_out_available = has_opt_out_window(&normalized);
            findings.push(ClauseFinding {
                category: rule_match.category_id.to_string(),
                label: rule_match.label.to_string(),
                rule_id: rule_match.rule_id.to_string(),
                raw_text: clause.to_string(),
                modality: rule_match.modality,
                severity: rule_match.weight,
                start_offset: sentence.start,
                end_offset: sentence.end,
                opt_out_available,
                opt_out_target: if opt_out_available {
                    extract_opt_out_address(clause)
                } else {
                    None
                },
                inversion,
                reason: reason_for(&rule_match, inversion),
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

/// One sentence, built only from matched rule data.
fn reason_for(rule_match: &RuleMatch, inversion: InversionShape) -> String {
    let quoted = rule_match
        .evidence
        .iter()
        .map(|evidence| format!("\"{evidence}\""))
        .collect::<Vec<_>>()
        .join(", ");
    match inversion {
        InversionShape::ComplianceThenCarveOut => format!(
            "matched {quoted} in the clause; a hostile carve-out overrides the compliant base"
        ),
        InversionShape::Canceled => {
            format!("matched {quoted} in the clause; two carve-outs cancel each other")
        }
        _ => format!("matched {quoted} in the clause"),
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
    use crate::rules::{Predicate, RuleRegistry, RuleSpec};

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
    fn reason_uses_matched_data() {
        let doc = "You waive any right to a class action.";
        let finding = analyze(doc).into_iter().next().expect("finding");
        assert!(finding.reason.contains("\"waive\""));
        assert!(finding.reason.contains("\"class action\""));
    }

    #[test]
    fn poisoned_category_is_deduped_per_clause() {
        let doc = "You waive your right to a jury trial and to bring a class action in court.";
        let findings = analyze(doc);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].category, "forced_arbitration");
    }

    #[test]
    fn poison_index_is_bounded() {
        let finding = ClauseFinding {
            category: "forced_arbitration".into(),
            label: "Forced Arbitration & Class Waiver".into(),
            rule_id: "forced_arbitration.class_action_waiver".into(),
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
    fn runtime_registry_can_add_a_category() {
        const SYNTHETIC: RuleSpec = RuleSpec {
            rule_id: "canary.chirp",
            category_id: "canary",
            label: "Canary Category",
            modality: Modality::Obligation,
            weight: 2.0,
            required: &[
                Predicate::AnyPhrase(&["canary clause"]),
                Predicate::AnyPhrase(&["must chirp"]),
            ],
            optional: &[],
            prohibited: &[],
            proximity_window: 20,
            inversion_sensitive: false,
        };

        let mut registry = RuleRegistry::builtin();
        registry.add(SYNTHETIC);
        let report = analyze_with(&registry, "The canary clause must chirp twice.");
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].category, "canary");
        assert_eq!(report.findings[0].rule_id, "canary.chirp");
    }
}
