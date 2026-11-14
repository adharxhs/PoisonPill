//! Subordinate polarity and exception-inversion calculus.
//!
//! Predatory drafting opens with a compliant declarative clause and nullifies it
//! with a boundary marker. Each subordinate clause contributes
//!
//! ```text
//! NetPolarity(C) = Polarity(C_base) * prod(phi(marker_i) * Polarity(C_sub_i))
//! ```
//!
//! where `phi(marker) = -1` for the exception operators below.

/// Markers that invert the polarity of the clause they attach to.
pub const EXCEPTION_MARKERS: &[&str] = &[
    "except",
    "unless",
    "provided that",
    "notwithstanding",
    "save for",
    "at our sole discretion",
];

/// Returns `true` when the marker belongs to the inversion set.
pub fn is_exception_marker(marker: &str) -> bool {
    let marker = marker.trim().to_lowercase();
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

/// Count how many inversion markers appear in `text`. Odd counts mean the
/// sentence's net polarity is inverted; even counts cancel out.
pub fn inversion_depth(text: &str) -> usize {
    let lower = text.to_lowercase();
    EXCEPTION_MARKERS
        .iter()
        .filter(|marker| lower.contains(**marker))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
