//! Validation of known reply fields and bounded UTF-8 Mac output.

use serde_json::Value;

use crate::reply::Reply;

pub(crate) fn normalize_paths(value: &mut Value) {
    normalize_choices(value);
    if let Some(attachments) = value
        .get_mut("message")
        .and_then(|message| message.get_mut("attachments"))
        .and_then(Value::as_array_mut)
    {
        for attachment in attachments {
            if let Some(fields) = attachment.as_object_mut()
                && !fields.get("path").is_some_and(Value::is_string)
            {
                fields.insert("path".into(), Value::Null);
            }
        }
    }
}

fn normalize_choices(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            if fields.contains_key("agent")
                && fields.contains_key("model")
                && (fields.contains_key("effort") || fields.contains_key("efforts"))
            {
                let fast = fields.get("fast") == Some(&Value::Bool(true));
                fields.insert("fast".into(), Value::Bool(fast));
            }
            for value in fields.values_mut() {
                normalize_choices(value);
            }
        }
        Value::Array(values) => {
            for value in values {
                normalize_choices(value);
            }
        }
        _ => {}
    }
}

pub(crate) fn valid(value: &Value, source: &Value, key: &str) -> bool {
    match value {
        Value::String(text)
            if matches!(
                key,
                "id" | "link"
                    | "sessionLink"
                    | "sessionId"
                    | "orgId"
                    | "workspaceId"
                    | "repositoryId"
                    | "sectionId"
                    | "branch"
                    | "baseBranch"
                    | "model"
                    | "label"
                    | "fullName"
                    | "defaultBranch"
                    | "requestKey"
                    | "mediaType"
            ) =>
        {
            !text.trim().is_empty()
        }
        Value::Number(number)
            if matches!(
                key,
                "number"
                    | "eventNumber"
                    | "sizeBytes"
                    | "startLine"
                    | "endLine"
                    | "totalLines"
                    | "startOffset"
                    | "endOffset"
                    | "line"
                    | "offset"
                    | "port"
            ) =>
        {
            number
                .as_u64()
                .is_some_and(|number| number <= 9_007_199_254_740_991)
        }
        Value::Array(values) => values
            .iter()
            .zip(source.as_array().into_iter().flatten())
            .all(|(value, source)| valid(value, source, "")),
        Value::Object(fields) => fields.iter().all(|(key, value)| {
            source
                .get(key)
                .is_some_and(|source| valid(value, source, key))
        }),
        _ => true,
    }
}

pub(crate) fn cap_output(reply: &mut Reply) {
    if let Reply::RunMacCommand(response) = reply
        && let Some(result) = response.request.result.as_mut()
    {
        let stdout_size = result.stdout.len();
        let stderr_size = result.stderr.len();
        truncate(&mut result.stdout, 65536);
        truncate(&mut result.stderr, 65536usize.saturating_sub(stdout_size));
        result.truncated |= stdout_size + stderr_size > 65536;
    }
}

fn truncate(text: &mut String, maximum: usize) {
    let mut end = maximum.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
}
