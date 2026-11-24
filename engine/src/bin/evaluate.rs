//! Stream a JSON string per line and return rule and optional-review categories.
use std::io::{self, BufRead, Write};

use poisonpill_engine::{analyze, review};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let text: String = serde_json::from_str(&line?)?;
        let findings = analyze(&text);
        let candidates = review::candidates(&text, &findings);
        let response = serde_json::json!({
            "rules": findings.iter().map(|finding| &finding.category).collect::<Vec<_>>(),
            "candidates": candidates.iter().map(|candidate| candidate.category).collect::<Vec<_>>(),
        });
        writeln!(output, "{response}")?;
    }
    output.flush()?;
    Ok(())
}
