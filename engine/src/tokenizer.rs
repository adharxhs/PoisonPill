//! Linear-time sentence boundary disambiguation (SBD).
//!
//! Contracts are hostile to naive `split('.')`: abbreviations, enumerations and
//! decimal numbers produce fragments that destroy clause context. This splitter
//! scans once, no allocation per sentence, and returns borrowed slices.

/// Tokens that end in a period without ending a sentence.
const ABBREVIATIONS: &[&str] = &[
    "e.g", "i.e", "etc", "inc", "ltd", "llc", "co", "corp", "no", "vs", "mr", "ms", "dr", "u.s",
    "st", "art", "sec", "para",
];

/// Split `text` into trimmed, non-empty sentence slices.
pub fn sentences(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        match bytes[i] {
            b'\n' => {
                push(&mut out, &text[start..i]);
                start = i + 1;
            }
            b'.' | b'!' | b'?' => {
                if bytes[i] == b'.' && is_abbreviation(&text[start..=i]) {
                    i += 1;
                    continue;
                }

                // Skip closing punctuation, then require a capital, a digit or EOF.
                let mut j = i + 1;
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'"' | b'\'' | b')') {
                    j += 1;
                }

                if j >= bytes.len() || bytes[j].is_ascii_uppercase() || bytes[j].is_ascii_digit() {
                    push(&mut out, &text[start..=i]);
                    start = j;
                    i = j;
                    continue;
                }
            }
            _ => {}
        }
        i += 1;
    }

    push(&mut out, &text[start..]);
    out
}

fn push<'a>(out: &mut Vec<&'a str>, candidate: &'a str) {
    let trimmed = candidate.trim();
    if !trimmed.is_empty() {
        out.push(trimmed);
    }
}

/// A period is an abbreviation dot when the trailing word is a known short form
/// or is a single initial (`J.`).
fn is_abbreviation(slice_ending_in_dot: &str) -> bool {
    let word = slice_ending_in_dot
        .trim_end_matches('.')
        .rsplit(|c: char| c.is_whitespace() || c == '(' || c == '"')
        .next()
        .unwrap_or("")
        .to_lowercase();

    if word.chars().count() == 1 {
        return word.chars().all(|c| c.is_ascii_alphabetic());
    }
    ABBREVIATIONS.contains(&word.as_str())
}

#[cfg(test)]
mod tests {
    use super::sentences;

    #[test]
    fn splits_on_terminators() {
        let got = sentences("We may change these terms. You agree to arbitrate! Done?");
        assert_eq!(got.len(), 3);
    }

    #[test]
    fn keeps_abbreviations_inside_sentence() {
        let got = sentences("We share data with affiliates, e.g. Acme Inc. and others.");
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn splits_on_newlines_without_terminators() {
        let got = sentences("first clause\nsecond clause");
        assert_eq!(got, vec!["first clause", "second clause"]);
    }
}
