//! Stream a JSON string per line and return rule and optional-review categories.
use std::io::{self, BufRead, Write};

use poisonpill_engine::{deontic::analyze_with_site, review, RuleRegistry};

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum Input {
    Plain(String),
    WithProvider { text: String, provider: String },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut output = io::BufWriter::new(io::stdout().lock());
    let registry = RuleRegistry::builtin();
    for line in io::stdin().lock().lines() {
        let (text, provider) = match serde_json::from_str::<Input>(&line?)? {
            Input::Plain(text) => (text, String::new()),
            Input::WithProvider { text, provider } => (text, provider),
        };
        let findings = analyze_with_site(&registry, &text, &provider).findings;
        let candidates = review::candidates(&text, &findings);
        let response = serde_json::json!({
            "rule_ids": findings.iter().map(|finding| &finding.rule_id).collect::<Vec<_>>(),
            "rules": findings.iter().map(|finding| &finding.category).collect::<Vec<_>>(),
            "candidates": candidates.iter().map(|candidate| candidate.category).collect::<Vec<_>>(),
        });
        writeln!(output, "{response}")?;
    }
    output.flush()?;
    Ok(())
}
