//! Threat taxonomy: categories, severities, and syntactic footprints.
//!
//! Weights here are the authoritative `w_k` in the Poison Index formula. Keep
//! them in sync with the spec table (section 3).

use crate::model::Modality;

/// The five predatory classes the engine prioritises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    ForcedArbitration,
    IpExpropriation,
    UnilateralModification,
    ReverseIndemnification,
    Surveillance,
}

impl Category {
    pub const ALL: [Category; 5] = [
        Category::ForcedArbitration,
        Category::IpExpropriation,
        Category::UnilateralModification,
        Category::ReverseIndemnification,
        Category::Surveillance,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Category::ForcedArbitration => "Forced Arbitration & Class Waiver",
            Category::IpExpropriation => "Perpetual IP Expropriation",
            Category::UnilateralModification => "Unilateral Modification",
            Category::ReverseIndemnification => "Reverse Indemnification",
            Category::Surveillance => "Surveillance & Data Cascades",
        }
    }

    /// Stable machine id used on the wire.
    pub fn id(self) -> &'static str {
        match self {
            Category::ForcedArbitration => "forced_arbitration",
            Category::IpExpropriation => "ip_expropriation",
            Category::UnilateralModification => "unilateral_modification",
            Category::ReverseIndemnification => "reverse_indemnification",
            Category::Surveillance => "surveillance",
        }
    }

    /// Base weight `w_k`, in `[1.0, 5.0]`.
    pub fn weight(self) -> f32 {
        match self {
            Category::ForcedArbitration => 5.0,
            Category::IpExpropriation => 4.5,
            Category::UnilateralModification => 4.0,
            Category::ReverseIndemnification => 3.5,
            Category::Surveillance => 3.0,
        }
    }

    pub fn modality(self) -> Modality {
        match self {
            Category::ForcedArbitration => Modality::Waiver,
            Category::IpExpropriation => Modality::Waiver,
            Category::UnilateralModification => Modality::Permission,
            Category::ReverseIndemnification => Modality::Obligation,
            Category::Surveillance => Modality::Permission,
        }
    }
}

/// Does a lowercased sentence sit inside this category's syntactic footprint?
///
/// Each arm requires the modal verb *and* its object; a lone "waive" is not a
/// class waiver, and a lone "license" is not expropriation.
pub fn matches(category: Category, normalized: &str) -> bool {
    let has = |needle: &str| normalized.contains(needle);

    match category {
        Category::ForcedArbitration => {
            (has("waive") || has("waives") || has("waiver"))
                && (has("class action") || has("jury") || has("arbitrat"))
        }
        Category::IpExpropriation => {
            has("license")
                && (has("perpetual") || has("irrevocable") || has("royalty-free"))
                && (has("sublicensable") || has("commercialize") || has("worldwide"))
        }
        Category::UnilateralModification => {
            (has("reserve the right") || has("may modify") || has("may change"))
                && (has("sole discretion") || has("at any time") || has("without notice"))
        }
        Category::ReverseIndemnification => {
            has("indemnify") || (has("hold harmless") && (has("defend") || has("claims")))
        }
        Category::Surveillance => {
            (has("disclose") || has("share") || has("sell"))
                && (has("data") || has("information"))
                && (has("third part") || has("affiliate") || has("partner") || has("aggregate"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_class_waiver() {
        let s = "you waive any right to bring claims as a class action member";
        assert!(matches(Category::ForcedArbitration, s));
    }

    #[test]
    fn ignores_plain_waiver() {
        let s = "we waive our right to enforce this section";
        assert!(!matches(Category::ForcedArbitration, s));
    }

    #[test]
    fn weights_stay_in_range() {
        for c in Category::ALL {
            assert!((1.0..=5.0).contains(&c.weight()));
        }
    }
}
