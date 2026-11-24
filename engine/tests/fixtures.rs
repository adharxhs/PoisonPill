//! Fixture harness.
//!
//! The corpus and goldens are data on disk; this test only walks them, compares
//! the canonical native output, and asserts corpus invariants. It never writes
//! a golden. Regeneration is `make goldens`, which is a reviewable commit.

use std::fs;
use std::path::{Path, PathBuf};

use poisonpill_engine::{AnalyzeResponse, DocumentReport, LegalEngine};

const CLASSES: [&str; 3] = ["positive", "hard_negative", "negative"];

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
}

fn cases(class: &str) -> Vec<(String, String)> {
    let directory = fixtures_root().join("cases").join(class);
    let mut cases = Vec::new();

    for entry in fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
    {
        let path = entry.expect("directory entry").path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("txt") {
            continue;
        }
        let name = path
            .file_stem()
            .expect("fixture file has a stem")
            .to_string_lossy()
            .into_owned();
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        cases.push((name, text));
    }

    cases.sort_by(|left, right| left.0.cmp(&right.0));
    cases
}

fn report_for(text: &str) -> DocumentReport {
    let canonical = LegalEngine::new().analyze_json(text);
    match serde_json::from_str::<AnalyzeResponse>(&canonical).expect("canonical envelope parses") {
        AnalyzeResponse::Ok { report } => report,
        AnalyzeResponse::Error { error } => panic!("engine returned an error: {error:?}"),
    }
}

#[test]
fn goldens_match_canonical_native_output() {
    let engine = LegalEngine::new();

    for class in CLASSES {
        for (name, text) in cases(class) {
            let actual = engine.analyze_json(&text);
            let golden_path = fixtures_root()
                .join("golden")
                .join(class)
                .join(format!("{name}.json"));
            let expected = fs::read_to_string(&golden_path).unwrap_or_else(|error| {
                panic!(
                    "missing golden {}: {error}\nrun `make goldens` and review the diff",
                    golden_path.display()
                )
            });
            assert_eq!(
                actual,
                expected.trim_end(),
                "golden drift for {class}/{name}; review the change before regenerating"
            );
        }
    }
}

#[test]
fn findings_slice_their_input_and_match_expectations() {
    for class in CLASSES {
        for (name, text) in cases(class) {
            let label = format!("{class}/{name}");
            let report = report_for(&text);
            assert!(!report.truncated, "{label}: fixture exceeded the input cap");

            assert!(
                report
                    .findings
                    .windows(2)
                    .all(|pair| pair[0].start_offset <= pair[1].start_offset),
                "{label}: findings are not ordered by offset"
            );

            for finding in &report.findings {
                assert!(
                    finding.start_offset < finding.end_offset,
                    "{label}: empty finding span"
                );
                assert!(
                    text.is_char_boundary(finding.start_offset)
                        && text.is_char_boundary(finding.end_offset),
                    "{label}: offsets are not UTF-8 boundaries"
                );
                assert_eq!(
                    &text[finding.start_offset..finding.end_offset],
                    finding.raw_text,
                    "{label}: raw_text does not slice the input"
                );

                assert!(!finding.evidence.is_empty(), "{label}: missing evidence");
                for excerpt in finding.evidence.iter().chain(&finding.opt_out_source) {
                    assert_eq!(
                        text.get(excerpt.start_offset..excerpt.end_offset),
                        Some(excerpt.text.as_str()),
                        "{label}: evidence does not slice the input"
                    );
                }
                assert_eq!(
                    finding.opt_out_available,
                    finding.opt_out_source.is_some(),
                    "{label}: opt-out source and availability disagree"
                );
            }

            match class {
                "positive" => assert!(
                    !report.findings.is_empty(),
                    "{label}: a positive fixture produced no finding"
                ),
                _ => assert!(
                    report.findings.is_empty(),
                    "{label}: a negative fixture produced {} finding(s)",
                    report.findings.len()
                ),
            }
        }
    }
}

#[test]
fn playback_fixture_matches_its_golden() {
    let playback_path = fixtures_root().join("../extension/public/playback.json");
    let playback: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&playback_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", playback_path.display())),
    )
    .expect("playback fixture is valid JSON");

    let golden_path = fixtures_root().join("golden/positive/07-opt-out-window.json");
    let golden: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&golden_path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", golden_path.display())),
    )
    .expect("golden is valid JSON");

    assert_eq!(
        playback, golden,
        "playback fixture drifted; run `make goldens`"
    );

    let response: AnalyzeResponse = serde_json::from_value(playback).expect("playback envelope");
    assert!(matches!(response, AnalyzeResponse::Ok { .. }));
}

#[test]
fn repeated_analysis_is_byte_identical() {
    let engine = LegalEngine::new();
    for class in CLASSES {
        for (name, text) in cases(class) {
            let first = engine.analyze_json(&text);
            let second = engine.analyze_json(&text);
            assert_eq!(first, second, "{class}/{name} is not deterministic");
        }
    }
}

#[test]
fn hard_negatives_outnumber_positives_two_to_one() {
    let positives = cases("positive").len();
    let hard_negatives = cases("hard_negative").len();
    assert!(positives > 0, "the corpus needs positive fixtures");
    assert!(
        hard_negatives >= positives * 2,
        "expected at least {} hard negatives, found {hard_negatives}",
        positives * 2
    );
}
