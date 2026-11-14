//! Lexicon data. This module is intentionally boring: lists of phrases that
//! rule data references. Add a new word or asset noun here; never add matching
//! control flow. All phrases are lowercase and matched ASCII-case-insensitively.

/// Verbs that transfer a right away from the actor.
pub const WAIVER_VERBS: &[&str] = &["waive", "waives", "waived", "waiving", "waiver of"];

/// Class/collective/representative action language.
pub const CLASS_ACTIONS: &[&str] = &[
    "class action",
    "class-action",
    "class proceeding",
    "class or collective action",
    "collective action",
    "representative action",
    "class member",
    "class arbitration",
];

/// Jury language that can be waived.
pub const JURY_TERMS: &[&str] = &[
    "jury trial",
    "trial by jury",
    "jury service",
    "right to a jury",
];

/// Judicial-forum language.
pub const COURT_TERMS: &[&str] = &[
    "right to sue",
    "right to file a claim",
    "right to bring a claim",
    "court",
    "judicial",
    "lawsuit",
    "legal proceeding",
];

/// Language that actually mandates arbitration, as opposed to describing it.
pub const MANDATORY_ARBITRATION: &[&str] = &[
    "binding arbitration",
    "mandatory arbitration",
    "shall be resolved by arbitration",
    "shall be resolved exclusively by arbitration",
    "shall be resolved by binding arbitration",
    "must be resolved by arbitration",
    "must be resolved through arbitration",
    "shall be arbitrated",
    "must be arbitrated",
    "agree to arbitrate",
    "agrees to arbitrate",
    "you agree that any dispute",
    "you agree that all disputes",
    "requires you to arbitrate",
    "required to arbitrate",
];

/// Something the arbitration clause can be about.
pub const DISPUTE_NEXUS: &[&str] = &["dispute", "claim", "controversy", "lawsuit"];

/// A restriction that bars collective proceedings.
pub const CLASS_ACTION_BARS: &[&str] = &[
    "not permitted",
    "prohibited",
    "may not",
    "cannot",
    "shall not",
    "must be brought individually",
    "brought only on an individual basis",
    "individual basis only",
];

/// A waiver by the provider is not a user-facing predatory clause.
pub const PROVIDER_WAIVERS: &[&str] = &[
    "we waive",
    "we hereby waive",
    "we irrevocably waive",
    "company waives",
    "provider waives",
    "we agree to waive",
    "we will never waive",
];

/// Compliant boilerplate that must suppress an apparent hostile footprint.
pub const COMPLIANCE_GUARDS: &[&str] = &[
    "does not waive",
    "do not waive",
    "not waive",
    "never waive",
    "no waiver",
    "nothing in this",
    "nothing in these",
    "nothing herein",
    "no provision of",
    "not be deemed a waiver",
    "does not apply",
    "does not prevent",
    "does not limit",
    "will not be construed",
    "shall not be construed",
    "is not intended to",
];

/// Extra evidence that does not gate a finding.
pub const ARBITRATION_AMPLIFIERS: &[&str] =
    &["plaintiff", "class member", "representative", "collective"];

/// Unilateral discretion markers. These raise `mu` in scoring.
pub const UNILATERAL_DISCRETION: &[&str] = &[
    "sole discretion",
    "at any time",
    "without notice",
    "at our option",
    "in our discretion",
    "unilaterally",
];

/// Negations that make a base clause compliant before a carve-out marker.
pub const COMPLIANCE_NEGATIONS: &[&str] = &[
    "not",
    "never",
    "no",
    "nothing",
    "does not",
    "do not",
    "will not",
    "shall not",
    "is not",
    "are not",
];

/// Actions that constitute exercising an opt-out.
pub const OPT_OUT_ACTIONS: &[&str] = &[
    "opt out",
    "opt-out",
    "optout",
    "reject this arbitration",
    "reject the arbitration",
    "reject arbitration",
    "exclude yourself",
    "written notice",
    "written objection",
    "notify us in writing",
    "send written notice",
    "provide written notice",
    "email us",
    "email written notice",
    "mail written notice",
];

/// Explicit windows. Numeric windows are additionally detected by shape.
pub const OPT_OUT_WINDOW_PHRASES: &[&str] = &[
    "at any time",
    "within a reasonable time",
    "before the effective date",
    "within thirty (30) days",
    "within sixty (60) days",
    "within ninety (90) days",
    "no later than thirty (30) days",
    "no later than sixty (60) days",
];

/// Word-number day windows. Digits are detected separately.
pub const OPT_OUT_DAY_WORDS: &[&str] = &[
    "ten days",
    "fifteen days",
    "twenty days",
    "thirty days",
    "forty-five days",
    "sixty days",
    "ninety days",
];
