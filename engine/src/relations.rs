//! Bounded recognition of explicit actor–modal–action–object–condition frames.
//! Every frame preserves source byte spans. Unknown constructions stay unknown.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Provider,
    Customer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Force {
    Permission,
    Obligation,
    Prohibition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    ModifyTerms,
    TerminateAccess,
    DiscloseData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Condition {
    WithoutNotice,
    Immediate,
    AdvertisingRecipient,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pattern {
    pub actor: Actor,
    pub force: Force,
    pub action: Action,
    pub condition: Condition,
}

pub(crate) struct Match {
    pub action_span: (usize, usize),
    pub condition_span: (usize, usize),
    pub action_phrase: &'static str,
    pub condition_phrase: &'static str,
}

#[derive(Clone, Copy)]
struct Word<'a> {
    text: &'a str,
    start: usize,
    end: usize,
}

fn word_chars(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn words(text: &str) -> impl Iterator<Item = Word<'_>> {
    text.split_inclusive(|c| !word_chars(c))
        .scan(0, |start, part| {
            let word = part.trim_end_matches(|c| !word_chars(c));
            let span = Word {
                text: word,
                start: *start,
                end: *start + word.len(),
            };
            *start += part.len();
            Some(span)
        })
        .filter(|word| !word.text.is_empty())
}

fn starts(words: &[Word<'_>], phrase: &str) -> Option<usize> {
    let mut length = 0;
    for (index, expected) in phrase.split_ascii_whitespace().enumerate() {
        if !words.get(index)?.text.eq_ignore_ascii_case(expected) {
            return None;
        }
        length += 1;
    }
    Some(length)
}

fn first_phrase(
    words: &[Word<'_>],
    phrases: &'static [&'static str],
) -> Option<(&'static str, usize)> {
    phrases
        .iter()
        .find_map(|&phrase| starts(words, phrase).map(|length| (phrase, length)))
}

fn actor(words: &[Word<'_>]) -> Option<(Actor, usize)> {
    first_phrase(words, &["we", "the company", "the provider", "our company"])
        .map(|(_, length)| (Actor::Provider, length))
        .or_else(|| {
            first_phrase(words, &["you", "the customer", "the user"])
                .map(|(_, length)| (Actor::Customer, length))
        })
}

/// A clause-initial named entity can be the actor of an explicit amendment.
fn site_actor(word: &str, site: &str) -> bool {
    word.len() >= 4
        && site
            .split('.')
            .any(|label| word.eq_ignore_ascii_case(label))
}

fn named_provider(words: &[Word<'_>], site: &str) -> Option<usize> {
    const NON_PROVIDER: &[&str] = &[
        "anyone",
        "both",
        "customer",
        "customers",
        "employees",
        "everyone",
        "members",
        "neither",
        "no",
        "nobody",
        "party",
        "parties",
        "someone",
        "support",
        "they",
        "third",
        "user",
        "users",
        "you",
        "your",
    ];
    for (index, word) in words.iter().take(4).enumerate() {
        if index > 0 && force(&words[index..]).is_some() {
            return Some(index);
        }
        if (!word.text.chars().any(char::is_uppercase)
            && !(index == 0 && site_actor(word.text, site)))
            || NON_PROVIDER
                .iter()
                .any(|name| word.text.eq_ignore_ascii_case(name))
        {
            return None;
        }
    }
    None
}

fn force(words: &[Word<'_>]) -> Option<(Force, usize)> {
    for (force, phrases) in [
        (
            Force::Prohibition,
            &["may not", "must not", "shall not", "cannot"][..],
        ),
        (
            Force::Permission,
            &[
                "reserve the right to",
                "reserves the right to",
                "may",
                "can",
            ][..],
        ),
        (Force::Obligation, &["must", "shall"][..]),
    ] {
        if let Some((_, length)) = first_phrase(words, phrases) {
            return Some((force, length));
        }
    }
    None
}

fn action(words: &[Word<'_>], action: Action) -> Option<(&'static str, usize)> {
    let (verbs, objects): (&[&str], &[&str]) = match action {
        Action::ModifyTerms => (
            &["amend", "change", "modify", "revise", "update", "alter"],
            &[
                "these terms and conditions",
                "these terms",
                "this agreement",
                "the terms",
                "our terms",
                "this contract",
                "these t cs",
                "these t c s",
            ],
        ),
        Action::TerminateAccess => (
            &["terminate", "suspend", "close"],
            &["your account", "your access", "this agreement"],
        ),
        Action::DiscloseData => (
            &["disclose", "sell", "share", "transfer"],
            &[
                "your personal information",
                "your personal data",
                "your usage data",
            ],
        ),
    };
    let (verb, verb_len) = first_phrase(words, verbs)?;
    let mut object = verb_len;
    if action == Action::ModifyTerms && starts(&words[object..], "or").is_some() {
        if let Some((_, second)) = first_phrase(&words[object + 1..], verbs) {
            object += 1 + second;
        }
    }
    let (_, object_len) = first_phrase(&words[object..], objects)?;
    Some((verb, object + object_len))
}

fn condition(words: &[Word<'_>], condition: Condition) -> Option<(&'static str, usize)> {
    match condition {
        Condition::WithoutNotice => first_phrase(
            words,
            &[
                "without giving you advance notice",
                "without giving you prior notice",
                "without first notifying you",
                "without notice to you",
                "without prior notice",
                "without advance notice",
                "without notifying you",
                "without notice",
            ],
        ),
        Condition::Immediate => first_phrase(words, &["immediately", "with immediate effect"]),
        Condition::AdvertisingRecipient => first_phrase(
            words,
            &[
                "with advertising partners",
                "to advertising partners",
                "with advertisers",
                "to advertisers",
                "for their own marketing purposes",
            ],
        ),
    }
}

fn at_frame(words: &[Word<'_>], pattern: Pattern, at_start: bool, site: &str) -> Option<Match> {
    let (actor, actor_len) = actor(words).or_else(|| {
        (at_start && pattern.actor == Actor::Provider && pattern.action == Action::ModifyTerms)
            .then(|| named_provider(words, site).map(|length| (Actor::Provider, length)))
            .flatten()
    })?;
    let (force, modal_len) = force(&words[actor_len..])?;
    if actor != pattern.actor || force != pattern.force {
        return None;
    }
    let mut action_start = actor_len + modal_len;
    if let Some((_, length)) = first_phrase(
        &words[action_start..],
        &[
            "at any time",
            "at our sole discretion",
            "from time to time",
            "at any moment",
        ],
    ) {
        action_start += length;
    }
    let leading_condition = if pattern.condition == Condition::Immediate {
        condition(&words[action_start..], pattern.condition).map(|(phrase, length)| {
            let result = (phrase, action_start, length);
            action_start += length;
            result
        })
    } else {
        None
    };
    let (action_phrase, action_length) = action(&words[action_start..], pattern.action)?;
    let end = action_start + action_length;
    let (condition_phrase, condition_start, condition_length) = match leading_condition {
        Some(found) => found,
        None => {
            let modifier = first_phrase(
                &words[end..],
                &[
                    "at any time",
                    "at our sole discretion",
                    "from time to time",
                    "at any moment",
                ],
            );
            let start = end + modifier.map_or(0, |(_, length)| length);
            let (phrase, length) = condition(&words[start..], pattern.condition)?;
            (phrase, start, length)
        }
    };
    Some(Match {
        action_span: (words[0].start, words[end - 1].end),
        condition_span: (
            words[condition_start].start,
            words[condition_start + condition_length - 1].end,
        ),
        action_phrase,
        condition_phrase,
    })
}

pub(crate) fn find(text: &str, pattern: Pattern, site: &str) -> Option<Match> {
    // Explicit punctuation boundaries prevent modal arguments from leaking
    // into another clause or across quoted examples.
    let mut offset = 0;
    let mut quoted = false;
    for section in text.split_inclusive([';', ':', '"', '“', '”', '!', '?']) {
        let start = offset;
        offset += section.len();
        let was_quoted = quoted;
        match section.chars().next_back() {
            Some('"') => quoted = !quoted,
            Some('“') => quoted = true,
            Some('”') => quoted = false,
            _ => {}
        }
        if was_quoted {
            continue;
        }
        let segment = section.trim_end_matches([';', ':', '"', '“', '”', '!', '?']);
        // Bounded lookahead for each actor rather than tokenizing the complete
        // input or reconsidering ambiguous verb chains.
        for (index, word) in words(segment).enumerate() {
            let named_start = index == 0
                && pattern.action == Action::ModifyTerms
                && (word.text.chars().any(char::is_uppercase) || site_actor(word.text, site));
            if !named_start
                && !["we", "the", "our", "you"]
                    .iter()
                    .any(|actor| word.text.eq_ignore_ascii_case(actor))
            {
                continue;
            }
            let window: Vec<_> = words(&segment[word.start..]).take(24).collect();
            if let Some(mut parsed) = at_frame(&window, pattern, named_start, site) {
                let base = start + word.start;
                parsed.action_span.0 += base;
                parsed.action_span.1 += base;
                parsed.condition_span.0 += base;
                parsed.condition_span.1 += base;
                return Some(parsed);
            }
        }
    }
    None
}
