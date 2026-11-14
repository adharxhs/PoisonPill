//! Linear-time sentence boundary disambiguation (SBD).
//!
//! Contracts are hostile to naive `split('.')`: abbreviations, enumerations,
//! decimals, citations, headings, tables and multibyte punctuation all destroy
//! clause context. This splitter scans once, allocates one `Sentence` record per
//! result (no per-sentence string), and returns borrowed slices with offsets.

/// Tokens that end in a period without ending a sentence.
const ABBREVIATIONS: &[&str] = &[
    "e.g", "i.e", "etc", "inc", "ltd", "llc", "co", "corp", "no", "vs", "v", "mr", "mrs", "ms",
    "dr", "prof", "sr", "jr", "st", "art", "sec", "para", "p", "pp", "cf", "al", "approx", "dept",
    "est", "min", "max", "fig", "cl", "ch", "vol", "ed", "rev", "hon", "gov", "sen", "rep", "jan",
    "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "u.s", "u.k",
    "e.u",
];

/// A sentence slice and the byte range it occupies in the original input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sentence<'a> {
    pub text: &'a str,
    pub start: usize,
    pub end: usize,
}

/// Split `text` into trimmed, non-empty sentences with byte offsets.
///
/// The scan is linear. Lookback is bounded by the current word; lookahead skips
/// a bounded run of closing punctuation and spaces.
pub fn sentences(text: &str) -> Vec<Sentence<'_>> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }

        let byte = bytes[i];

        if byte == b'\n' || byte == b'\r' {
            push(&mut out, text, start, i);
            i += if byte == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
            start = i;
            continue;
        }

        if let Some(width) = unicode_terminator_width(&text[i..]) {
            push(&mut out, text, start, i + width);
            i += width;
            start = i;
            continue;
        }

        if matches!(byte, b'.' | b'!' | b'?') {
            if byte == b'.' && !is_boundary_dot(text, i) {
                i += 1;
                continue;
            }

            // Include closing quotes/brackets in the sentence, then skip the
            // spaces that follow before deciding whether this is a boundary.
            let mut end = i + 1;
            loop {
                let width = closing_width(&text[end..]);
                if width == 0 {
                    break;
                }
                end += width;
            }
            let mut j = end;
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
                j += 1;
            }

            let followed_by_boundary = j >= bytes.len()
                || matches!(bytes[j], b'\n' | b'\r')
                || is_sentence_start(&text[j..]);

            if followed_by_boundary {
                push(&mut out, text, start, end);
                i = j;
                start = j;
                continue;
            }
        }

        i += 1;
    }

    push(&mut out, text, start, bytes.len());
    out
}

fn push<'a>(out: &mut Vec<Sentence<'a>>, text: &'a str, start: usize, end: usize) {
    if start >= end || end > text.len() {
        return;
    }

    let candidate = &text[start..end];
    let leading = candidate.len() - candidate.trim_start().len();
    let trimmed_end = candidate.trim_end().len();
    if trimmed_end <= leading {
        return;
    }

    let mut s = start + leading;
    let e = start + trimmed_end;

    // Drop an enumeration prefix ("1.", "2)", "(a)", "•") from the clause so
    // offsets and raw_text point at the legal text, not the list furniture.
    s += leading_marker_width(&text[s..e]);
    while s < e {
        match text[s..].chars().next() {
            Some(c) if c.is_whitespace() => s += c.len_utf8(),
            _ => break,
        }
    }
    if s >= e {
        return;
    }

    let sentence = &text[s..e];

    // Pure separators and list markers ("1.", "(a)", "•") carry no clause.
    if sentence.chars().all(|c| !c.is_alphanumeric()) || is_list_marker(sentence) {
        return;
    }

    out.push(Sentence {
        text: sentence,
        start: s,
        end: e,
    });
}

fn is_list_marker(sentence: &str) -> bool {
    let stripped = sentence
        .trim()
        .trim_end_matches(['.', ')', '>'])
        .trim_start_matches(['(', '[', '-', '*', '•']);
    !stripped.is_empty()
        && (stripped.chars().all(|c| c.is_ascii_digit())
            || (stripped.chars().count() == 1 && stripped.chars().all(|c| c.is_ascii_alphabetic())))
}

/// Width of an enumeration prefix that is followed by whitespace: `1.`, `2)`,
/// `(a)`, `a)`, `•`, `-`. Returns 0 when the sentence starts with real text.
fn leading_marker_width(sentence: &str) -> usize {
    let bytes = sentence.as_bytes();
    let mut i = 0usize;

    if bytes.first() == Some(&b'(') {
        i = 1;
        let body_start = i;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric()) {
            i += 1;
        }
        let body_len = i - body_start;
        if body_len == 0 || body_len > 3 || bytes.get(i).copied() != Some(b')') {
            return 0;
        }
        i += 1;
    } else if bytes.first().is_some_and(|b| b.is_ascii_digit()) {
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if !matches!(bytes.get(i).copied(), Some(b'.') | Some(b')')) {
            return 0;
        }
        i += 1;
    } else if bytes.first().is_some_and(|b| b.is_ascii_alphabetic())
        && matches!(bytes.get(1).copied(), Some(b'.') | Some(b')'))
    {
        i = 2;
    } else if matches!(bytes.first().copied(), Some(b'-') | Some(b'*')) {
        i = 1;
    } else if sentence.starts_with('•') {
        i = '•'.len_utf8();
    } else {
        return 0;
    }

    if bytes.get(i).is_some_and(|b| b.is_ascii_whitespace()) {
        i
    } else {
        0
    }
}

fn closing_width(rest: &str) -> usize {
    if rest.starts_with('”') || rest.starts_with('’') {
        3
    } else if rest
        .as_bytes()
        .first()
        .is_some_and(|byte| matches!(byte, b'"' | b'\'' | b')' | b']' | b'}'))
    {
        1
    } else {
        0
    }
}

fn is_sentence_start(rest: &str) -> bool {
    rest.as_bytes().first().is_some_and(|byte| {
        byte.is_ascii_uppercase()
            || byte.is_ascii_digit()
            || matches!(byte, b'(' | b'[' | b'"' | b'\'' | b'#' | b'-')
    }) || rest.starts_with('•')
}

/// UTF-8 sentence terminators commonly used by CJK and fullwidth text.
fn unicode_terminator_width(rest: &str) -> Option<usize> {
    const TERMINATORS: &[&str] = &["。", "！", "？", "．"];
    TERMINATORS
        .iter()
        .find(|term| rest.starts_with(**term))
        .map(|term| term.len())
}

/// A period is a boundary unless it is inside a token (decimals, domains,
/// emails), part of an ellipsis, or the tail of a known abbreviation/initial.
fn is_boundary_dot(text: &str, dot: usize) -> bool {
    let bytes = text.as_bytes();

    let prev = dot.checked_sub(1).and_then(|i| bytes.get(i)).copied();
    let next = bytes.get(dot + 1).copied();

    if prev == Some(b'.') || next == Some(b'.') {
        return false;
    }

    // `3.5`, `example.com`, `legal@example.com`: no whitespace around the dot.
    if prev.is_some_and(|b| b.is_ascii_alphanumeric())
        && next.is_some_and(|b| b.is_ascii_alphanumeric())
    {
        return false;
    }

    !is_abbreviation(text, dot)
}

fn is_abbreviation(text: &str, dot: usize) -> bool {
    let bytes = text.as_bytes();
    let mut start = dot;

    while start > 0 {
        let byte = bytes[start - 1];
        if byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'&' {
            start -= 1;
        } else {
            break;
        }
    }

    if start == dot {
        return false;
    }

    let word = text[start..dot].to_ascii_lowercase();
    if ABBREVIATIONS.contains(&word.as_str()) {
        return true;
    }

    // Initialisms such as U.S, E.U or J. are single letters joined by dots.
    word.contains('.') && word.split('.').all(|part| part.len() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(input: &str) -> Vec<&str> {
        sentences(input).into_iter().map(|s| s.text).collect()
    }

    #[test]
    fn splits_on_terminators() {
        let got = texts("We may change these terms. You agree to arbitrate! Done?");
        assert_eq!(got.len(), 3);
    }

    #[test]
    fn keeps_abbreviations_inside_sentence() {
        let got = texts("We share data with affiliates, e.g. Acme Inc. and others.");
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn keeps_initialisms_and_citations() {
        let got = texts("See Section 4.2 of the U.S. terms. You waive claims.");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], "See Section 4.2 of the U.S. terms.");
    }

    #[test]
    fn keeps_decimals_and_emails() {
        let got = texts("A 3.5% fee applies. Email legal@example.com. You waive claims.");
        assert_eq!(got.len(), 3);
        assert_eq!(got[1], "Email legal@example.com.");
    }

    #[test]
    fn splits_on_newlines_without_terminators() {
        let got = texts("first clause\nsecond clause");
        assert_eq!(got, vec!["first clause", "second clause"]);
    }

    #[test]
    fn handles_headings_and_table_rows() {
        let input = "ARTICLE 9\nArbitration\nClause\tPenalty\nArbitration\tWaiver";
        let got = texts(input);
        assert_eq!(
            got,
            vec![
                "ARTICLE 9",
                "Arbitration",
                "Clause\tPenalty",
                "Arbitration\tWaiver"
            ]
        );
    }

    #[test]
    fn skips_list_markers_but_keeps_items() {
        let input = "1. You waive class actions.\n2) You waive jury trials.";
        let got = texts(input);
        assert_eq!(
            got,
            vec!["You waive class actions.", "You waive jury trials."]
        );
    }

    #[test]
    fn handles_multibyte_terminators() {
        let input = "条款一。 You waive claims.";
        let got = texts(input);
        assert_eq!(got, vec!["条款一。", "You waive claims."]);
    }

    #[test]
    fn keeps_closing_quote_with_sentence() {
        let input = "The term is \"waiver.\" You agree to arbitrate.";
        let got = texts(input);
        assert_eq!(
            got,
            vec!["The term is \"waiver.\"", "You agree to arbitrate."]
        );
    }

    #[test]
    fn does_not_split_lowercase_continuation() {
        let got = texts("These terms apply. notwithstanding anything to the contrary.");
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn offsets_slice_the_input() {
        let input = "Intro clause. You waive any right to a class action.";
        for sentence in sentences(input) {
            assert_eq!(&input[sentence.start..sentence.end], sentence.text);
        }
    }

    #[test]
    fn offsets_are_char_boundaries() {
        let input = "条款。 You waive a jury trial.";
        for sentence in sentences(input) {
            assert!(input.is_char_boundary(sentence.start));
            assert!(input.is_char_boundary(sentence.end));
        }
    }

    #[test]
    fn empty_and_whitespace_input_yield_nothing() {
        assert!(sentences("").is_empty());
        assert!(sentences(" \n\t \n").is_empty());
    }
}
