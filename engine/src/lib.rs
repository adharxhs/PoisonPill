//! PoisonPill engine: deontic dependency-graph parsing compiled to WebAssembly.
//!
//! The crate is deliberately free of browser APIs so `cargo test` runs natively.

#![deny(unsafe_code)]

// wasm-bindgen expansions emit `unsafe`; scope the exemption to the binding module.
#[allow(unsafe_code)]
pub mod deontic;
pub mod exceptions;
pub mod lexicon;
pub mod model;
pub mod optout;
pub mod relations;
pub mod review;
pub mod rules;
pub mod scoring;
pub mod tokenizer;

pub use deontic::{analyze, analyze_with, LegalEngine, MAX_INPUT_BYTES};
pub use model::{
    AnalyzeResponse, ClauseFinding, DocumentReport, EngineError, ErrorCode, InversionShape,
    Modality, SCHEMA_VERSION,
};
pub use optout::OptOut;
pub use rules::{Predicate, RuleRegistry, RuleSpec};
pub use scoring::{finding_contribution, poison_index};

/// Crate version, mirrored from `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
