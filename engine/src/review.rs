//! Experimental, opt-in n-gram review. Predictions carry original source
//! ranges and never enter the rule registry or document score.

use serde::Serialize;

use crate::deontic::MAX_INPUT_BYTES;
use crate::model::{ClauseFinding, SourceExcerpt};
use crate::tokenizer::sentences;

const BUCKETS: usize = 4096;
const FEATURE_INPUT_BYTES: usize = 1024;
const MAX_CANDIDATES: usize = 25;
const LABELS: [&str; 4] = [
    "forced_arbitration",
    "unilateral_modification",
    "liability_caps",
    "termination_asymmetry",
];
const ROW: usize = 4 + BUCKETS * 2;
const MODEL: &[u8; ROW * LABELS.len()] = include_bytes!("review-model.bin");

#[derive(Debug, Serialize)]
pub struct ReviewCandidate {
    pub category: &'static str,
    pub source: SourceExcerpt,
}

fn feature_hash(bytes: impl IntoIterator<Item = u8>) -> usize {
    let mut hash = 2_166_136_261_u32;
    for byte in bytes {
        hash = (hash ^ u32::from(byte)).wrapping_mul(16_777_619);
    }
    hash as usize % BUCKETS
}

fn features(text: &str) -> Vec<usize> {
    let mut data = Vec::new();
    let mut separated = false;
    for byte in text.bytes() {
        if !byte.is_ascii_alphanumeric() {
            separated = !data.is_empty();
            continue;
        }
        if separated {
            data.push(b' ');
            separated = false;
        }
        data.push(byte.to_ascii_lowercase());
        if data.len() >= FEATURE_INPUT_BYTES {
            data.truncate(FEATURE_INPUT_BYTES);
            break;
        }
    }

    let mut buckets = Vec::new();
    buckets.extend(
        data.windows(4)
            .map(|gram| feature_hash(gram.iter().copied())),
    );
    let mut previous: Option<&[u8]> = None;
    for word in data
        .split(|byte| *byte == b' ')
        .filter(|word| !word.is_empty())
    {
        buckets.push(feature_hash(
            (*b"@").into_iter().chain(word.iter().copied()),
        ));
        if let Some(left) = previous {
            buckets.push(feature_hash(
                (*b"@")
                    .into_iter()
                    .chain(left.iter().copied())
                    .chain(*b" ")
                    .chain(word.iter().copied()),
            ));
        }
        previous = Some(word);
    }
    buckets.sort_unstable();
    buckets.dedup();
    buckets
}

fn predict(text: &str) -> impl Iterator<Item = &'static str> {
    let buckets = features(text);
    LABELS
        .into_iter()
        .zip(MODEL.chunks_exact(ROW))
        .filter_map(move |(label, row)| {
            let threshold = i32::from_le_bytes([row[0], row[1], row[2], row[3]]);
            let score: i32 = buckets
                .iter()
                .map(|&index| {
                    let position = 4 + 2 * index;
                    i32::from(i16::from_le_bytes([row[position], row[position + 1]]))
                })
                .sum();
            (!buckets.is_empty() && score >= threshold).then_some(label)
        })
}

pub fn candidates(text: &str, findings: &[ClauseFinding]) -> Vec<ReviewCandidate> {
    let mut end = text.len().min(MAX_INPUT_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut candidates = Vec::new();
    let mut confirmed = findings.iter().peekable();
    for sentence in sentences(&text[..end]) {
        while confirmed
            .peek()
            .is_some_and(|finding| finding.start_offset < sentence.start)
        {
            confirmed.next();
        }
        let mut confirmed_categories = Vec::new();
        while confirmed
            .peek()
            .is_some_and(|finding| finding.start_offset == sentence.start)
        {
            if let Some(finding) = confirmed.next() {
                confirmed_categories.push(finding.category.as_str());
            }
        }
        for category in predict(sentence.text) {
            if confirmed_categories.contains(&category) {
                continue;
            }
            candidates.push(ReviewCandidate {
                category,
                source: SourceExcerpt {
                    start_offset: sentence.start,
                    end_offset: sentence.end,
                    text: sentence.text.to_string(),
                },
            });
            if candidates.len() == MAX_CANDIDATES {
                return candidates;
            }
        }
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconfirmed_candidates_preserve_original_offsets_and_score() {
        let text = "Café: We reserve the right to make changes to these terms at any time by posting them here.";
        let engine = crate::LegalEngine::new();
        let baseline: serde_json::Value = serde_json::from_str(&engine.analyze_json(text)).unwrap();
        let (reviewed, proposed): (serde_json::Value, Vec<serde_json::Value>) =
            serde_json::from_str(&engine.analyze_review_json(text)).unwrap();
        assert_eq!(baseline, reviewed);
        assert!(proposed
            .iter()
            .any(|candidate| candidate["category"] == "unilateral_modification"));
        for candidate in proposed {
            let source = &candidate["source"];
            let start = source["start_offset"].as_u64().unwrap() as usize;
            let end = source["end_offset"].as_u64().unwrap() as usize;
            assert_eq!(&text[start..end], source["text"].as_str().unwrap());
        }
    }

    #[test]
    fn feature_contract() {
        assert_eq!(
            features("Example—TERMS here."),
            features(" example terms  HERE ")
        );
        assert!(features("?!").is_empty());
    }
}
