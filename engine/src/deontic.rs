//! Deontic extraction and the wasm-bindgen entry point.
//!
//! Detection is entirely driven by `rules::RuleRegistry`; this module only
//! walks sentences, turns rule matches into wire findings, and attaches
//! opt-out/scoring evidence.

use wasm_bindgen::prelude::*;

use crate::exceptions::classify;
use crate::model::{
    AnalyzeResponse, ClauseFinding, DocumentReport, InversionShape, SourceExcerpt, SCHEMA_VERSION,
};
use crate::optout::{
    associate_with_source, inspect as inspect_opt_out, Association, ClauseOptOut,
    ASSOCIATION_WINDOW,
};
use crate::rules::{Predicate, RuleMatch, RuleRegistry, ARBITRATION_CATEGORY};
use crate::scoring::poison_index;
use crate::tokenizer::{sentences, Sentence};

/// Hard limit on analysed input. Anything larger is truncated on a UTF-8
/// boundary and reported via `DocumentReport::truncated`. This bounds worst-case
/// work for pathological pages while leaving any realistic contract untouched.
/// 512 KiB is roughly 80,000 words.
pub const MAX_INPUT_BYTES: usize = 512 * 1024;

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

    /// One normal analysis plus optional suggestions, with no score changes.
    #[wasm_bindgen(js_name = analyzeReviewJson)]
    pub fn analyze_review_json(&self, raw_text: &str) -> String {
        self.analyze_review_json_for_site(raw_text, "")
    }

    #[wasm_bindgen(js_name = analyzeReviewJsonForSite)]
    pub fn analyze_review_json_for_site(&self, raw_text: &str, site: &str) -> String {
        let report = analyze_with_site(&self.registry, raw_text, site);
        let candidates = crate::review::candidates(raw_text, &report.findings);
        serde_json::to_string(&(AnalyzeResponse::ok(report), candidates))
            .unwrap_or_else(|_| "[]".to_owned())
    }

    /// Canonical JSON form used by parity tests and the worker.
    #[wasm_bindgen(js_name = analyzeJson)]
    pub fn analyze_json(&self, raw_text: &str) -> String {
        self.analyze_json_for_site(raw_text, "")
    }

    #[wasm_bindgen(js_name = analyzeJsonForSite)]
    pub fn analyze_json_for_site(&self, raw_text: &str, site: &str) -> String {
        let outcome = AnalyzeResponse::ok(analyze_with_site(&self.registry, raw_text, site));
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
    analyze_with_site(registry, raw_text, "")
}

/// Analyse with an optional site or provider label as actor evidence.
pub fn analyze_with_site(registry: &RuleRegistry, raw_text: &str, site: &str) -> DocumentReport {
    let (input, truncated) = truncate_input(raw_text, MAX_INPUT_BYTES);
    let mut findings = Vec::new();

    let clauses = sentences(input);
    let blocks = block_ids(input, &clauses);
    // Opt-out facts are only needed once a clause produces a finding; compute
    // them lazily, at most once per clause, so a document with no findings
    // pays nothing.
    let mut opt_out_facts = None;

    for (index, sentence) in clauses.iter().enumerate() {
        let mut emitted_rules: Vec<(&str, &str)> = Vec::new();
        let next = clauses
            .get(index + 1)
            .filter(|_| blocks[index] == blocks[index + 1]);
        let mut matches: Vec<_> = registry
            .matches_for_site(sentence.text, site)
            .into_iter()
            .map(|matched| (matched, sentence.end))
            .collect();
        if !matches
            .iter()
            .any(|(matched, _)| matched.rule_id == TERMINATION_RULE)
        {
            if let Some((matched, end)) =
                next.and_then(|next| paired_termination(registry, input, sentence, next))
            {
                matches.push((matched, end));
            }
        }

        select_arbitration_matches(sentence.text, &mut matches);
        for (rule_match, end) in matches {
            if next.is_some_and(|next| explicit_restriction(registry, &rule_match, next.text)) {
                continue;
            }
            let clause = &input[sentence.start..end];
            let inversion = classify(clause, rule_match.inversion_sensitive, &rule_match.spans);
            if inversion == InversionShape::Inverted {
                continue;
            }

            // Independent dispute restrictions can share a source sentence.
            // Scoring still counts this category once for the range.
            if emitted_rules.iter().any(|&(category, rule)| {
                category == rule_match.category_id
                    && !distinct_arbitration_restrictions(rule, rule_match.rule_id)
            }) {
                continue;
            }
            emitted_rules.push((rule_match.category_id, rule_match.rule_id));

            // The existing association heuristics resolve dispute opt-outs.
            let (association, opt_out_index, opt_out_heading) =
                if rule_match.category_id == ARBITRATION_CATEGORY {
                    let facts = opt_out_facts.get_or_insert_with(|| {
                        clauses
                            .iter()
                            .map(|sentence| inspect_opt_out(sentence.text))
                            .collect::<Vec<_>>()
                    });
                    let (association, source) = associate_with_source(facts, &blocks, index);
                    if let Some(section) = explicit_opt_out_section(&clauses, &blocks, facts, index)
                        .filter(|_| source.is_none())
                    {
                        (
                            Association::Neighbour(facts[section].opt_out.clone()),
                            Some(section),
                            true,
                        )
                    } else {
                        (association, source, false)
                    }
                } else {
                    (Association::None, None, false)
                };
            let opt_out = association.opt_out();
            findings.push(ClauseFinding {
                category: rule_match.category_id.to_string(),
                label: rule_match.label.to_string(),
                rule_id: rule_match.rule_id.to_string(),
                raw_text: clause.to_string(),
                modality: rule_match.modality,
                severity: rule_match.weight,
                start_offset: sentence.start,
                end_offset: end,
                opt_out_available: opt_out.available,
                opt_out_target: opt_out.target,
                inversion,
                reason: reason_for(&rule_match, inversion, &association, opt_out_heading),
                evidence: rule_match
                    .spans
                    .iter()
                    .map(|&(start, end)| {
                        excerpt(input, sentence.start + start, sentence.start + end)
                    })
                    .collect(),
                opt_out_source: opt_out_index
                    .map(|source| excerpt(input, clauses[source].start, clauses[source].end)),
            });
        }
    }

    DocumentReport {
        schema_version: SCHEMA_VERSION.to_string(),
        poison_index: poison_index(&findings),
        findings,
        truncated,
    }
}

const TERMINATION_RULE: &str = "termination_asymmetry.immediate_provider_notice_for_user";

fn paired_termination(
    registry: &RuleRegistry,
    input: &str,
    current: &Sentence<'_>,
    next: &Sentence<'_>,
) -> Option<(RuleMatch, usize)> {
    let text = next.text;
    if text.len() > 280 {
        return None;
    }
    let first = text.split_ascii_whitespace().next()?;
    if !first.eq_ignore_ascii_case("to") && !first.eq_ignore_ascii_case("you") {
        return None;
    }
    let lower = text.to_ascii_lowercase();
    if ![
        "to terminate your account, you must ",
        "to terminate this agreement, you must ",
        "to cancel your account, you must ",
        "you may terminate only upon ",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
    {
        return None;
    }
    let rule = registry
        .rules()
        .iter()
        .find(|rule| rule.rule_id == TERMINATION_RULE)?;
    // The provider's immediate termination power must come from the first
    // sentence; the explicitly named customer obligation supplies the second.
    if !rule.required.iter().any(|predicate| {
        matches!(predicate, Predicate::Relation(_)) && predicate.matches(current.text, 0)
    }) {
        return None;
    }
    rule.evaluate(&input[current.start..next.end])
        .map(|matched| (matched, next.end))
}

fn explicit_restriction(registry: &RuleRegistry, matched: &RuleMatch, next: &str) -> bool {
    if !matches!(
        matched.rule_id,
        TERMINATION_RULE | "unilateral_modification.without_notice"
    ) || next.len() > 280
    {
        return false;
    }
    let lower = next.to_ascii_lowercase();
    if !["this right applies only ", "this right is available only "]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return false;
    }
    registry
        .rules()
        .iter()
        .find(|rule| rule.rule_id == matched.rule_id)
        .is_some_and(|rule| {
            rule.prohibited
                .iter()
                .any(|predicate| predicate.matches(next, rule.proximity_window))
        })
}

/// Only a directly following, explicitly arbitration-specific heading can
/// bridge a block boundary. Preserve existing ambiguity handling in the block.
fn explicit_opt_out_section(
    clauses: &[Sentence<'_>],
    blocks: &[usize],
    facts: &[ClauseOptOut],
    index: usize,
) -> Option<usize> {
    let heading = index + 1;
    let source = index + 2;
    let heading_text = clauses.get(heading)?.text.trim_end_matches(':');
    let source_fact = facts.get(source)?;
    if blocks[index] == blocks[heading]
        || ![
            "arbitration opt-out",
            "arbitration opt out",
            "opt out of arbitration",
        ]
        .iter()
        .any(|label| heading_text.eq_ignore_ascii_case(label))
        || !source_fact.opt_out.available
        || source_fact.foreign_subject
    {
        return None;
    }
    let low = index.saturating_sub(ASSOCIATION_WINDOW);
    let has_candidate = (low..index).any(|other| {
        blocks[other] == blocks[index]
            && facts[other].opt_out.available
            && !facts[other].foreign_subject
    });
    (!has_candidate).then_some(source)
}

const ARBITRATION: &str = "forced_arbitration.mandatory_arbitration";
const CLASS_BAR: &str = "forced_arbitration.class_action_bar";
const CLASS_WAIVER: &str = "forced_arbitration.class_action_waiver";
const COURT_WAIVER: &str = "forced_arbitration.court_access_waiver";
const JURY_WAIVER: &str = "forced_arbitration.jury_trial_waiver";

fn select_arbitration_matches(clause: &str, matches: &mut Vec<(RuleMatch, usize)>) {
    let detected = |id| matches.iter().any(|(matched, _)| matched.rule_id == id);
    let prefer_bar = detected(CLASS_BAR)
        && detected(CLASS_WAIVER)
        && Predicate::AnyPhrase(crate::lexicon::CLASS_ACTION_BARS)
            .evaluate(clause, 0)
            .zip(Predicate::AnyPhrase(crate::lexicon::CLASS_ACTIONS).evaluate(clause, 0))
            .zip(Predicate::AnyPhrase(crate::lexicon::WAIVER_VERBS).evaluate(clause, 0))
            .is_some_and(|((bar, class), waiver)| {
                bar.start <= class.start && class.end <= waiver.start
            });
    // "Court" may occur in the venue comparison or even in the name of the
    // class claim. Keep the generic court rule as a fallback for such overlaps.
    let specific = [ARBITRATION, CLASS_BAR, CLASS_WAIVER, JURY_WAIVER]
        .into_iter()
        .any(detected);
    matches.retain(|(matched, _)| {
        !(specific && matched.rule_id == COURT_WAIVER
            || prefer_bar && matched.rule_id == CLASS_WAIVER)
    });
}

fn distinct_arbitration_restrictions(left: &str, right: &str) -> bool {
    let kind = |rule| match rule {
        ARBITRATION => Some(0),
        CLASS_BAR | CLASS_WAIVER => Some(1),
        JURY_WAIVER => Some(2),
        _ => None,
    };
    matches!((kind(left), kind(right)), (Some(a), Some(b)) if a != b)
}

fn excerpt(input: &str, start_offset: usize, end_offset: usize) -> SourceExcerpt {
    SourceExcerpt {
        start_offset,
        end_offset,
        text: input[start_offset..end_offset].to_string(),
    }
}

/// Cut to at most `cap` bytes without splitting a UTF-8 character. The returned
/// prefix always satisfies `raw_text.is_char_boundary(prefix.len())`.
fn truncate_input(text: &str, cap: usize) -> (&str, bool) {
    if text.len() <= cap {
        return (text, false);
    }
    let mut end = cap;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

/// Block index for each clause. A block is a run of text not interrupted by a
/// blank line, so association never crosses a paragraph or section break.
fn block_ids(input: &str, clauses: &[Sentence<'_>]) -> Vec<usize> {
    let mut ids = Vec::with_capacity(clauses.len());
    let mut block = 0usize;
    let mut previous_end = 0usize;
    for clause in clauses {
        if previous_end > 0 && is_block_break(&input[previous_end..clause.start]) {
            block += 1;
        }
        ids.push(block);
        previous_end = clause.end;
    }
    ids
}

/// True when the gap between two clauses contains a blank line.
fn is_block_break(gap: &str) -> bool {
    let mut newlines = 0usize;
    for character in gap.chars() {
        match character {
            '\n' => {
                newlines += 1;
                if newlines >= 2 {
                    return true;
                }
            }
            ' ' | '\t' | '\r' => {}
            _ => newlines = 0,
        }
    }
    false
}

/// One sentence, built only from matched rule data.
fn reason_for(
    rule_match: &RuleMatch,
    inversion: InversionShape,
    association: &Association,
    opt_out_heading: bool,
) -> String {
    let base = base_reason(rule_match, inversion);
    if opt_out_heading {
        return format!("{base}; opt-out stated under the following arbitration opt-out heading");
    }
    match association {
        Association::Neighbour(_) => {
            format!("{base}; opt-out stated in a neighbouring clause of the same block")
        }
        _ => base,
    }
}

fn base_reason(rule_match: &RuleMatch, inversion: InversionShape) -> String {
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

/// `P_I` from the scoring module. Kept here as a re-export for callers that
/// already import from the engine entry point.
pub use crate::scoring::poison_index as score;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Modality;
    use crate::rules::{Predicate, RuleRegistry, RuleSpec};

    #[test]
    fn detects_arbitration_across_a_soft_wrap() {
        let text = "Disputes must be resolved by binding\r\narbitration.";
        let findings = analyze(text);
        let finding = &findings[0];
        assert_eq!(finding.category, "forced_arbitration");
        assert_eq!(finding.raw_text, text);
        assert_eq!(&text[finding.start_offset..finding.end_offset], text);
    }

    #[test]
    fn preserves_a_wrapped_notice_condition() {
        let text = "We may amend these terms\nwithout prior notice.";
        let findings = analyze(text);
        assert_eq!(findings[0].category, "unilateral_modification");
        assert_eq!(findings[0].raw_text, text);
    }

    #[test]
    fn pairs_immediate_termination_with_explicit_customer_notice() {
        let prefix = "We may terminate your account immediately.";
        let text = format!(
            "{prefix} To terminate your account, you must give us thirty days written notice."
        );
        let findings = analyze(&text);
        assert_eq!(findings[0].category, "termination_asymmetry");
        assert_eq!(findings[0].raw_text, text);
        let unrelated =
            format!("{prefix} To change your email, you must give us thirty days written notice.");
        assert!(analyze(&unrelated).is_empty());
        assert!(analyze(&text.replace(". To", ".\n\nTo")).is_empty());
    }

    #[test]
    fn an_immediate_explicit_exception_blocks_the_finding() {
        let text = "We may amend these terms without prior notice. This right applies only if you consent.";
        assert!(analyze(text).is_empty());
        assert_eq!(analyze(&text.replace(". This", ".\n\nThis")).len(), 1);
    }

    #[test]
    fn provider_permission_and_notice_belong_to_the_same_action() {
        for text in [
            "The provider may revise this agreement without giving you advance notice.",
            "At any time, we may amend this agreement without first notifying you.",
        ] {
            let findings = analyze(text);
            assert_eq!(findings.len(), 1, "{text}");
            assert_eq!(findings[0].category, "unilateral_modification");
        }

        for text in [
            "We may amend these terms after giving you notice, and we may remove optional features without notice.",
            "You may revise this agreement without giving us notice.",
            "We may not revise this agreement without giving you advance notice.",
            "If you expressly consent, we may amend these terms without prior notice.",
            "A sample clause says “we may amend these terms without prior notice”.",
        ] {
            assert!(analyze(text).is_empty(), "{text}");
        }
    }

    #[test]
    fn explicit_arbitration_heading_bridges_blocks() {
        let text = "Disputes shall be resolved by binding arbitration.\n\nArbitration opt-out:\nYou may opt out within 30 days by emailing arb@example.com.";
        let findings = analyze(text);
        let finding = &findings[0];
        assert!(finding.reason.contains("arbitration opt-out heading"));
        assert_eq!(finding.opt_out_target.as_deref(), Some("arb@example.com"));
        assert!(finding
            .opt_out_source
            .as_ref()
            .unwrap()
            .text
            .starts_with("You may opt out"));

        let unrelated = text.replace("Arbitration opt-out:", "Email preferences:");
        assert!(!analyze(&unrelated)[0].opt_out_available);
    }

    #[test]
    fn unilateral_modification_has_its_own_evidence_and_no_arbitration_opt_out() {
        let text = "Café terms. We may amend these\u{a0}terms without prior notice. \
                    You may opt out of arbitration within 30 days by emailing arb@example.com.";
        let report = analyze_with(&RuleRegistry::builtin(), text);
        assert_eq!(report.findings.len(), 1);
        let finding = &report.findings[0];
        assert_eq!(finding.rule_id, "unilateral_modification.without_notice");
        assert_eq!(finding.modality, crate::model::Modality::Permission);
        assert_eq!(finding.severity, 4.0);
        assert!(finding.reason.contains("without prior notice"));
        assert_eq!(
            &text[finding.start_offset..finding.end_offset],
            finding.raw_text
        );
        assert!(!finding.opt_out_available);
        assert_eq!(finding.opt_out_target, None);
        assert_eq!(report.poison_index, 4.0);
    }

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
    fn bare_address_without_a_window_is_not_an_opt_out() {
        let doc = "You waive any right to a class action; questions go to legal@example.com.";
        let findings = analyze(doc);
        assert!(!findings.is_empty());
        assert!(findings
            .iter()
            .all(|finding| !finding.opt_out_available && finding.opt_out_target.is_none()));
    }

    #[test]
    fn neighbouring_opt_out_is_associated_and_explained() {
        let doc = "Any dispute shall be resolved by binding arbitration. \
                   You may opt out within 45 days by emailing optout@example.com.";
        let finding = analyze(doc).into_iter().next().expect("finding");
        assert!(finding.opt_out_available);
        assert_eq!(
            finding.opt_out_target.as_deref(),
            Some("optout@example.com")
        );
        assert!(finding
            .reason
            .ends_with("neighbouring clause of the same block"));
    }

    #[test]
    fn blank_line_stops_association() {
        let doc = "Any dispute shall be resolved by binding arbitration.\n\n\
                   You may opt out within 45 days by emailing optout@example.com.";
        let finding = analyze(doc).into_iter().next().expect("finding");
        assert!(!finding.opt_out_available);
        assert_eq!(finding.opt_out_target, None);
    }

    #[test]
    fn single_newline_keeps_the_block() {
        let doc = "Any dispute shall be resolved by binding arbitration.\n\
                   You may opt out within 45 days by emailing optout@example.com.";
        let finding = analyze(doc).into_iter().next().expect("finding");
        assert!(finding.opt_out_available);
    }

    #[test]
    fn unrelated_neighbouring_opt_out_is_ignored() {
        let doc = "Any dispute shall be resolved by binding arbitration. \
                   You may opt out of marketing emails at any time by emailing privacy@example.com.";
        let finding = analyze(doc).into_iter().next().expect("finding");
        assert!(!finding.opt_out_available);
        assert_eq!(finding.opt_out_target, None);
        assert!(!finding.reason.contains("neighbouring"));
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
    fn recognizes_distinct_arbitration_restrictions_without_scoring_twice() {
        let text = "All disputes will be settled by binding, individual arbitration, and you waive your right to a jury trial and to join a class action.";
        let report = analyze_with(&RuleRegistry::builtin(), text);
        let ids: Vec<_> = report
            .findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect();
        assert_eq!(
            ids,
            [
                "forced_arbitration.class_action_waiver",
                "forced_arbitration.jury_trial_waiver",
                "forced_arbitration.mandatory_arbitration",
            ]
        );
        assert_eq!(report.poison_index, 5.0);
    }

    #[test]
    fn handles_named_amendment_actors_and_indirect_fee_caps() {
        for (text, category) in [
            ("Acme Services may amend or update these T&Cs at any moment, without prior notice.", "unilateral_modification"),
            ("We may revise these terms from time to time without notice.", "unilateral_modification"),
            ("In no event shall Acme be liable for any amount in the aggregate in excess of the fees you have actually paid.", "liability_caps"),
        ] {
            assert!(analyze(text).iter().any(|finding| finding.category == category), "{text}");
        }
        for text in [
            "Customers may amend these terms without notice.",
            "Support Agents may amend these terms without notice.",
            "In no event shall you be liable for an amount in the aggregate in excess of the fees you have actually paid.",
            "This dispute section titled binding arbitration is referred to as the arbitration agreement.",
        ] {
            assert!(analyze(text).is_empty(), "{text}");
        }
    }

    #[test]
    fn matching_site_label_identifies_lowercase_provider() {
        let text = "acme may modify these terms at any time without prior notice.";
        let registry = RuleRegistry::builtin();
        assert!(analyze(text).is_empty());
        assert!(analyze_with_site(&registry, text, "other.example")
            .findings
            .is_empty());
        let report = analyze_with_site(&registry, text, "www.acme.example");
        assert_eq!(report.findings[0].category, "unilateral_modification");
        assert_eq!(
            report.findings[0].evidence[0].text,
            "acme may modify these terms"
        );
    }

    #[test]
    fn distinct_waivers_share_one_score_contribution() {
        let doc = "You waive your right to a jury trial and to bring a class action in court.";
        let report = analyze_with(&RuleRegistry::builtin(), doc);
        let rule_ids: Vec<_> = report
            .findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect();
        assert_eq!(
            rule_ids,
            [
                "forced_arbitration.class_action_waiver",
                "forced_arbitration.jury_trial_waiver",
            ]
        );
        assert_eq!(report.poison_index, 5.0);
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
            evidence: vec![],
            opt_out_source: None,
        };
        let many: Vec<_> = (0..40)
            .map(|index| {
                let mut clause = finding.clone();
                clause.start_offset = index * clause.raw_text.len();
                clause.end_offset = clause.start_offset + clause.raw_text.len();
                clause
            })
            .collect();
        assert_eq!(poison_index(&many), 100.0);
    }

    #[test]
    fn oversize_document_is_truncated_and_keeps_offset_invariants() {
        let clause = "You waive any right to a class action. ";
        let text = clause.repeat(MAX_INPUT_BYTES / clause.len() + 10);
        let report = analyze_with(&RuleRegistry::builtin(), &text);

        assert!(report.truncated);
        assert!(!report.findings.is_empty());
        for finding in &report.findings {
            assert!(finding.end_offset <= MAX_INPUT_BYTES);
            assert_eq!(
                &text[finding.start_offset..finding.end_offset],
                finding.raw_text
            );
        }
    }

    #[test]
    fn input_at_the_cap_is_not_truncated() {
        let text = "a".repeat(MAX_INPUT_BYTES);
        let (prefix, truncated) = truncate_input(&text, MAX_INPUT_BYTES);
        assert!(!truncated);
        assert_eq!(prefix.len(), MAX_INPUT_BYTES);
    }

    #[test]
    fn truncation_never_splits_a_character() {
        let mut text = "a".repeat(MAX_INPUT_BYTES - 1);
        text.push('é');
        assert!(text.len() > MAX_INPUT_BYTES);

        let (prefix, truncated) = truncate_input(&text, MAX_INPUT_BYTES);
        assert!(truncated);
        assert_eq!(prefix.len(), MAX_INPUT_BYTES - 1);
        assert!(text.is_char_boundary(prefix.len()));
        assert!(prefix.chars().all(|character| character == 'a'));
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
