//! Wire contract v1.
//!
//! Every type in this module is serialised with `serde`. Field names are
//! snake_case because they are part of the JS contract; see `docs/CONTRACT.md`.
//! Nothing here may depend on browser APIs.

use serde::{Deserialize, Serialize};

/// Bumped whenever a change to this module would break an existing worker.
pub const SCHEMA_VERSION: &str = "1.0";

/// Deontic modality carried by a clause edge. Wire values are lowercase.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Modality {
    Obligation,
    Permission,
    Prohibition,
    Waiver,
}

/// How exception markers affected the clause's predicate.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum InversionShape {
    /// No marker was present, or the rule does not opt into inversion.
    #[default]
    None,
    /// An odd number of markers flipped the predicate; the rule did not fire.
    /// Present for diagnostics on suppression paths only in tests today.
    Inverted,
    /// An even number of markers cancelled out; the original polarity stands.
    Canceled,
    /// A compliant/negated base followed by a hostile carve-out. Always fires.
    ComplianceThenCarveOut,
}

/// One flagged clause. Offsets are byte offsets into the exact input string
/// passed to the engine, always on UTF-8 character boundaries.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ClauseFinding {
    /// Stable machine id, e.g. `forced_arbitration`.
    pub category: String,
    /// Human-readable category label.
    pub label: String,
    /// Id of the concrete rule from the registry that produced this finding.
    pub rule_id: String,
    /// Exact source slice for the clause, without leading/trailing whitespace.
    pub raw_text: String,
    pub modality: Modality,
    /// Base category weight `w_k`, not yet multiplied by `mu`/`tau`.
    pub severity: f32,
    /// Inclusive byte offset of `raw_text` in the analysed input.
    pub start_offset: usize,
    /// Exclusive byte offset of `raw_text` in the analysed input.
    pub end_offset: usize,
    pub opt_out_available: bool,
    pub opt_out_target: Option<String>,
    pub inversion: InversionShape,
    /// One sentence explaining why the rule fired, built from matched data.
    pub reason: String,
}

/// Full analysis result. Findings are ordered by `start_offset`, then by the
/// deterministic rule order in the registry.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DocumentReport {
    pub schema_version: String,
    pub findings: Vec<ClauseFinding>,
    /// Document-level `P_I`, clamped to `[0, 100]` and rounded to two decimals.
    pub poison_index: f32,
    /// True when the input exceeded the hard cap and only a prefix was analysed.
    pub truncated: bool,
}

/// Typed engine failure. The worker never has to parse an exception string.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// The engine could not serialise an owned report. Should be unreachable.
    InternalSerialization,
    /// Reserved for a future input validation boundary.
    InvalidInput,
}

/// Canonical wasm return value. `status` discriminates without exceptions.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AnalyzeResponse {
    Ok { report: DocumentReport },
    Error { error: EngineError },
}

impl AnalyzeResponse {
    pub fn ok(report: DocumentReport) -> Self {
        Self::Ok { report }
    }

    pub fn error(code: ErrorCode, message: impl Into<String>) -> Self {
        Self::Error {
            error: EngineError {
                code,
                message: message.into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modality_values_are_lowercase() {
        assert_eq!(
            serde_json::to_string(&Modality::Waiver).unwrap(),
            "\"waiver\""
        );
    }

    #[test]
    fn response_is_tagged_not_flattened() {
        let value =
            serde_json::to_value(AnalyzeResponse::error(ErrorCode::InvalidInput, "too large"))
                .unwrap();
        assert_eq!(value["status"], "error");
        assert_eq!(value["error"]["code"], "invalid_input");
    }
}
