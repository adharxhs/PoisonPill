//! Native command-line entry point.
//!
//! Prints the canonical `analyze_json` envelope for a file (or stdin). This is
//! the same string the Wasm build must produce, so it doubles as the golden
//! generator and a quick way to inspect a clause without loading the extension.
//!
//! ```sh
//! cargo run --bin analyze -- fixtures/cases/positive/class-action-waiver.txt
//! cargo run --bin analyze -- --pretty contract.txt
//! cat contract.txt | cargo run --bin analyze -- -
//! ```

use std::fs;
use std::io::{self, Read};
use std::process::ExitCode;

use poisonpill_engine::LegalEngine;

const USAGE: &str = "\
usage: analyze [--pretty] [FILE|-]

  FILE   text file to analyse; `-` or no argument reads stdin
  --pretty  indent the canonical JSON (same data, for humans)
";

fn main() -> ExitCode {
    let mut pretty = false;
    let mut input: Option<String> = None;

    for argument in std::env::args().skip(1) {
        match argument.as_str() {
            "--pretty" => pretty = true,
            "-h" | "--help" => {
                print!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            "-" => input = Some("-".to_string()),
            other if other.starts_with('-') => {
                eprintln!("unknown flag: {other}");
                eprint!("{USAGE}");
                return ExitCode::from(2);
            }
            other => input = Some(other.to_string()),
        }
    }

    let text = match read_input(input.as_deref()) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("analyze: {error}");
            return ExitCode::from(2);
        }
    };

    let canonical = LegalEngine::new().analyze_json(&text);
    if !pretty {
        println!("{canonical}");
        return ExitCode::SUCCESS;
    }

    match serde_json::from_str::<serde_json::Value>(&canonical) {
        Ok(value) => match serde_json::to_string_pretty(&value) {
            Ok(formatted) => {
                println!("{formatted}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("analyze: could not format output: {error}");
                ExitCode::from(1)
            }
        },
        Err(error) => {
            eprintln!("analyze: engine returned invalid JSON: {error}");
            ExitCode::from(1)
        }
    }
}

fn read_input(path: Option<&str>) -> io::Result<String> {
    match path {
        Some("-") | None => {
            let mut buffer = String::new();
            io::stdin().read_to_string(&mut buffer)?;
            Ok(buffer)
        }
        Some(path) => fs::read_to_string(path),
    }
}
