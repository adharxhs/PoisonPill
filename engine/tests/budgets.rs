//! Budget tests. These are intentionally `#[ignore]` so a normal debug
//! `cargo test` stays fast; `make verify` runs them against a release build.

use std::time::Instant;

use poisonpill_engine::deontic::analyze;

const TEN_K_WORD_SENTENCE: &str =
    "The provider may send service announcements about scheduled maintenance and \
     availability from time to time to the account owner. ";

#[test]
#[ignore = "budget check: run with --release via make verify"]
fn ten_thousand_words_under_200ms() {
    // 19 words per repetition; 530 repetitions is just over 10,000 words.
    let text = TEN_K_WORD_SENTENCE.repeat(530);
    let words = text.split_whitespace().count();
    assert!(words >= 10_000, "fixture is only {words} words");

    // Warm up once so allocator/page-fault noise does not dominate the sprint.
    let _ = analyze(&text);

    let started = Instant::now();
    let findings = analyze(&text);
    let elapsed = started.elapsed();
    println!("budget: {words} words analysed in {elapsed:?} (native release)");

    assert!(
        findings.is_empty(),
        "benign maintenance text must not produce findings"
    );
    assert!(
        elapsed.as_millis() < 200,
        "10k-word analysis took {elapsed:?}, budget is 200ms"
    );
}
