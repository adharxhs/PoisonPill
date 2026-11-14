//! Exception-marker inversion calculus.
//!
//! The spec models a clause as a base predicate multiplied by one factor per
//! subordinate boundary marker:
//!
//! ```text
//! NetPolarity(C) = Polarity(C_base) * prod(phi(marker_i) * Polarity(C_sub_i))
//! phi(marker) = -1 for exception operators
//! ```
//!
//! For rule evaluation we only need a shape, not a float polarity:
//!
//! - even marker count → `canceled`, the rule may fire;
//! - odd count with a positive base → `inverted`, the rule is suppressed;
//! - negated/compliant base plus a hostile predicate after the marker →
//!   `compliance_then_carve_out`, a distinct hostile shape that fires.
//!
//! Markers inside double-quoted text are ignored.

use crate::lexicon;
use crate::model::InversionShape;

/// Markers that invert the polarity of the clause they attach to.
pub const EXCEPTION_MARKERS: &[&str] = &[
    "except",
    "unless",
    "provided that",
    "notwithstanding",
    "save for",
    "at our sole discretion",
];

/// One marker occurrence, in byte offsets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkerOccurrence {
    pub marker: &'static str,
    pub start: usize,
    pub end: usize,
}

/// Diagnostic result for one clause.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InversionAnalysis {
    pub markers: Vec<MarkerOccurrence>,
    pub base_negated: bool,
    pub hostile_after_marker: bool,
}

impl InversionAnalysis {
    pub fn depth(&self) -> usize {
        self.markers.len()
    }

    pub fn first_marker(&self) -> Option<MarkerOccurrence> {
        self.markers.first().copied()
    }
}

/// Returns `true` when the marker belongs to the inversion set.
pub fn is_exception_marker(marker: &str) -> bool {
    let marker = marker.trim().to_ascii_lowercase();
    EXCEPTION_MARKERS.contains(&marker.as_str())
}

/// `phi(marker)`: `-1.0` for an inversion, `1.0` otherwise.
pub fn inversion_factor(marker: &str) -> f32 {
    if is_exception_marker(marker) {
        -1.0
    } else {
        1.0
    }
}

/// Fold a base polarity and its subordinate `(polarity, marker)` pairs.
pub fn net_polarity(base: f32, subordinates: &[(f32, &str)]) -> f32 {
    subordinates.iter().fold(base, |acc, (polarity, marker)| {
        acc * inversion_factor(marker) * polarity
    })
}

/// Count markers outside quoted text.
pub fn inversion_depth(text: &str) -> usize {
    marker_occurrences(text).len()
}

/// Find marker occurrences, ignoring markers inside `"…"` / `“…”` spans.
pub fn marker_occurrences(text: &str) -> Vec<MarkerOccurrence> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let mut in_quote = false;

    while i < text.len() {
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }

        let rest = &text[i..];
        let ch = rest.chars().next().unwrap_or('\0');

        match ch {
            '"' => {
                in_quote = !in_quote;
                i += 1;
                continue;
            }
            '“' => {
                in_quote = true;
                i += ch.len_utf8();
                continue;
            }
            '”' => {
                in_quote = false;
                i += ch.len_utf8();
                continue;
            }
            _ => {}
        }

        if !in_quote {
            if let Some(marker) = EXCEPTION_MARKERS
                .iter()
                .find(|marker| rest.starts_with(**marker) && is_word_bounded(text, i, marker))
            {
                out.push(MarkerOccurrence {
                    marker,
                    start: i,
                    end: i + marker.len(),
                });
                i += marker.len();
                continue;
            }
        }

        i += ch.len_utf8();
    }

    out
}

/// Diagnostics for one clause.
pub fn analyze(text: &str, required_spans: &[(usize, usize)]) -> InversionAnalysis {
    let markers = marker_occurrences(text);
    let first = markers.first().copied();

    let base_negated = first.is_some_and(|marker| contains_negation(&text[..marker.start]));
    let hostile_after_marker =
        first.is_some_and(|marker| required_spans.iter().any(|(start, _)| *start >= marker.end));

    InversionAnalysis {
        markers,
        base_negated,
        hostile_after_marker,
    }
}

/// Classify a rule's inversion shape. Rules that do not opt in always report
/// `None`, even when the clause contains markers.
pub fn classify(
    text: &str,
    inversion_sensitive: bool,
    required_spans: &[(usize, usize)],
) -> InversionShape {
    if !inversion_sensitive {
        return InversionShape::None;
    }

    let analysis = analyze(text, required_spans);
    let depth = analysis.depth();

    if depth == 0 {
        return InversionShape::None;
    }
    if depth.is_multiple_of(2) {
        return InversionShape::Canceled;
    }
    if analysis.base_negated && analysis.hostile_after_marker {
        return InversionShape::ComplianceThenCarveOut;
    }
    InversionShape::Inverted
}

fn contains_negation(text: &str) -> bool {
    lexicon::COMPLIANCE_NEGATIONS
        .iter()
        .any(|phrase| find_bounded(text, phrase).is_some())
}

fn find_bounded(haystack: &str, needle: &str) -> Option<usize> {
    let mut from = 0usize;
    while let Some(relative) = crate::rules::find_phrase(&haystack[from..], needle) {
        let start = from + relative;
        if is_word_bounded(haystack, start, needle) {
            return Some(start);
        }
        from = start + needle.len().max(1);
        if from >= haystack.len() {
            break;
        }
    }
    None
}

fn is_word_bounded(text: &str, start: usize, needle: &str) -> bool {
    let end = start + needle.len();
    if end > text.len() {
        return false;
    }
    let before_ok = text[..start]
        .chars()
        .next_back()
        .is_none_or(|c| !c.is_alphanumeric());
    let after_ok = text[end..]
        .chars()
        .next()
        .is_none_or(|c| !c.is_alphanumeric());
    before_ok && after_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPANS: &[(usize, usize)] = &[];

    #[test]
    fn exception_flips_sign() {
        assert_eq!(net_polarity(1.0, &[(1.0, "except")]), -1.0);
    }

    #[test]
    fn double_inversion_cancels() {
        assert_eq!(
            net_polarity(1.0, &[(1.0, "unless"), (1.0, "notwithstanding")]),
            1.0
        );
    }

    #[test]
    fn plain_subordinate_does_not_flip() {
        assert_eq!(net_polarity(1.0, &[(1.0, "and")]), 1.0);
    }

    #[test]
    fn each_marker_is_counted_once() {
        for marker in EXCEPTION_MARKERS {
            let text = format!("You may exercise this right {marker} the law allows.");
            assert_eq!(inversion_depth(&text), 1, "marker {marker}");
            assert!(is_exception_marker(marker));
        }
    }

    #[test]
    fn double_inversion_counts_twice() {
        assert_eq!(
            inversion_depth("You may, unless prohibited, except where required."),
            2
        );
    }

    #[test]
    fn quoted_markers_are_ignored() {
        assert_eq!(
            inversion_depth("The defined term \"except\" does not grant any right."),
            0
        );
        assert_eq!(
            inversion_depth("The clause reads “unless” in quotation marks."),
            0
        );
    }

    #[test]
    fn marker_inside_word_is_not_a_marker() {
        assert_eq!(inversion_depth("An exception applies."), 0);
    }

    #[test]
    fn odd_positive_base_is_inverted() {
        assert_eq!(
            classify("You waive all rights unless prohibited.", true, SPANS),
            InversionShape::Inverted
        );
    }

    #[test]
    fn even_base_is_canceled() {
        assert_eq!(
            classify(
                "You waive all rights, except where required, unless the law says otherwise.",
                true,
                SPANS
            ),
            InversionShape::Canceled
        );
    }

    #[test]
    fn non_sensitive_rule_has_no_shape() {
        assert_eq!(
            classify("You waive all rights unless prohibited.", false, SPANS),
            InversionShape::None
        );
    }

    #[test]
    fn compliant_base_plus_hostile_carve_out_is_distinct() {
        let text = "We do not share your data except that we may share it with partners.";
        let share = text.find("share").expect("share");
        let after = text.rfind("share").expect("share");
        let spans = [(share, share + 5), (after, after + 5)];
        assert_eq!(
            classify(text, true, &spans),
            InversionShape::ComplianceThenCarveOut
        );
    }

    #[test]
    fn compliant_base_without_hostile_carve_out_is_suppressed() {
        let text = "We do not share your data except where required by law.";
        let share = text.find("share").expect("share");
        let spans = [(share, share + 5)];
        assert_eq!(classify(text, true, &spans), InversionShape::Inverted);
    }

    #[test]
    fn quoted_marker_does_not_change_shape() {
        let text = "You waive all rights. The word \"unless\" is defined below.";
        assert_eq!(classify(text, true, SPANS), InversionShape::None);
    }
}
