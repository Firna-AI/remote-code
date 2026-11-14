//! Longest-match replacement and incomplete credential suffixes.

pub(super) const MARKER: &str = "[redacted]";

pub(super) fn filter(
    text: &str,
    final_text: bool,
    values: &[String],
    continuations: &[String],
) -> (String, String) {
    let mut secrets: Vec<&str> = values
        .iter()
        .map(String::as_str)
        .filter(|s| !s.is_empty())
        .collect();
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
    let mut initial = secrets.clone();
    initial.extend(continuations.iter().map(String::as_str));
    initial.sort_by_key(|s| std::cmp::Reverse(s.len()));
    let mut output = String::new();
    let mut index = 0;
    while index < text.len() {
        let candidates = if index == 0 { &initial } else { &secrets };
        let rest = &text[index..];
        if !final_text
            && candidates
                .iter()
                .any(|s| s.len() > rest.len() && s.starts_with(rest))
        {
            return (output, rest.to_owned());
        }
        let secret = candidates.iter().find(|s| rest.starts_with(**s));
        if rest.starts_with(MARKER) && secret.is_none_or(|s| s.len() <= MARKER.len()) {
            output.push_str(MARKER);
            index += MARKER.len();
        } else if let Some(secret) = secret {
            output.push_str(MARKER);
            index += secret.len();
        } else if let Some(character) = rest.chars().next() {
            output.push(character);
            index += character.len_utf8();
        }
    }
    (output, String::new())
}
