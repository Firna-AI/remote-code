//! CLI option decoding, including values that start with a dash.

use serde_json::{Map, Value};

use crate::call::Name;
use crate::error::{Error, InputError, Result};

pub(crate) struct Arguments {
    pub(crate) name: Name,
    pub(crate) fields: Map<String, Value>,
    pub(crate) message_path: Option<String>,
}

pub(crate) fn help(args: &[String]) -> bool {
    if args.is_empty() {
        return true;
    }
    if args.first().is_none_or(|value| value != "sessions") {
        return args.iter().any(|value| value == "--help");
    }
    let mut i = 2;
    while i < args.len() {
        if args[i] == "--help" {
            return true;
        }
        i += if args[i] == "--stop-running-turn" || args[i].contains('=') {
            1
        } else {
            2
        };
    }
    false
}

fn name(group: &str, verb: &str) -> Result<Name> {
    Ok(match (group, verb) {
        ("workspaces", "list") => Name::ListWorkspaces,
        ("workspaces", "get") => Name::GetWorkspace,
        ("workspaces", "create") => Name::CreateWorkspace,
        ("workspaces", "rename") => Name::RenameWorkspace,
        ("workspaces", "move") => Name::MoveWorkspace,
        ("workspaces", "archive") => Name::ArchiveWorkspace,
        ("repositories", "list") => Name::ListRepositories,
        ("sections", "list") => Name::ListSections,
        ("sections", "create") => Name::CreateSection,
        ("sections", "delete") => Name::DeleteSection,
        ("models", "list") => Name::ListModels,
        ("sessions", "list") => Name::ListSessions,
        ("sessions", "get") => Name::GetSession,
        ("sessions", "read") => Name::ReadSession,
        ("sessions", "create") => Name::CreateSession,
        ("sessions", "send") => Name::SendMessage,
        ("sessions", "rename") => Name::RenameSession,
        ("sessions", "close") => Name::CloseSession,
        ("sessions", "stop") => Name::StopSession,
        ("messages", "get") => Name::GetMessage,
        ("previews", "list") => Name::ListPreviews,
        ("previews", "open") => Name::OpenPreview,
        ("previews", "close") => Name::ClosePreview,
        ("mac", "run") => Name::RunMacCommand,
        ("workspaces", _) => return Err(Error::Input(InputError::WorkspaceCommand)),
        ("sessions", _) => return Err(Error::Input(InputError::SessionCommand)),
        ("mac", _) => return Err(Error::Input(InputError::MacCommand)),
        _ => return Err(Error::Input(InputError::Unknown)),
    })
}

fn options(name: Name) -> Vec<&'static str> {
    let options = match name {
        Name::CreateWorkspace => {
            "repository message message-file agent model effort fast section name first-session-title request-id"
        }
        Name::ListWorkspaces => "owner state repository query updated-since archived limit offset",
        Name::GetWorkspace | Name::ArchiveWorkspace | Name::ListPreviews => "workspace",
        Name::RenameWorkspace => "workspace name",
        Name::MoveWorkspace => "workspace section",
        Name::ListSessions => "workspace limit offset",
        Name::ReadSession => "workspace session detail start-line start-offset",
        Name::CreateSession => {
            "workspace message message-file title agent model effort fast request-id"
        }
        Name::SendMessage => {
            "workspace session message message-file agent model effort fast request-id"
        }
        Name::GetSession | Name::StopSession => "workspace session",
        Name::RenameSession => "workspace session title",
        Name::CloseSession => "workspace session stop-running-turn",
        Name::GetMessage => "workspace session message-id",
        Name::CreateSection => "name",
        Name::DeleteSection => "section",
        Name::OpenPreview => "workspace port",
        Name::ClosePreview => "workspace preview",
        Name::RunMacCommand => {
            "command folder reason timeout-seconds longer-timeout-reason request-id"
        }
        Name::ListRepositories | Name::ListSections | Name::ListModels => "",
    };
    options.split_whitespace().collect()
}

fn field(key: &str) -> String {
    match key {
        "workspace" | "session" | "repository" | "section" | "preview" | "owner" => {
            format!("{key}Id")
        }
        _ => {
            let mut parts = key.split('-');
            let mut result = parts.next().unwrap_or_default().to_string();
            for part in parts {
                let mut chars = part.chars();
                if let Some(first) = chars.next() {
                    result.extend(first.to_uppercase());
                    result.extend(chars);
                }
            }
            result
        }
    }
}

pub(crate) fn parse(args: &[String]) -> Result<Arguments> {
    let invalid = if args.first().is_some_and(|group| group == "sessions") {
        InputError::SessionOptions
    } else {
        InputError::Command
    };
    if args.len() < 2 {
        return Err(Error::Input(invalid));
    }
    let parsed_name = name(&args[0], &args[1]);
    let name = parsed_name
        .as_ref()
        .copied()
        .unwrap_or(match args[0].as_str() {
            "workspaces" => Name::GetWorkspace,
            "sessions" | "messages" => Name::GetSession,
            "previews" => Name::ListPreviews,
            "mac" => Name::RunMacCommand,
            _ => Name::ListModels,
        });
    let allowed = options(name);
    let mut fields = Map::new();
    let mut i = 2;
    while i < args.len() {
        let Some(option) = args[i].strip_prefix("--") else {
            return Err(Error::Input(invalid));
        };
        let (key, inline) = match option.split_once('=') {
            Some((key, value)) => (key, Some(value)),
            None => (option, None),
        };
        if !allowed.contains(&key) {
            return Err(Error::Input(invalid));
        }
        if key == "stop-running-turn" {
            if inline.is_some() {
                return Err(Error::Input(invalid));
            }
            fields.insert(field(key), Value::Bool(true));
            i += 1;
            continue;
        }
        let value = if let Some(value) = inline {
            value
        } else {
            i += 1;
            args.get(i).ok_or(Error::Input(invalid))?
        };
        fields.insert(field(key), Value::String(value.into()));
        i += 1;
    }
    let name = parsed_name?;
    let message_path = fields
        .remove("messageFile")
        .and_then(|value| value.as_str().map(String::from));
    if message_path.is_some() && fields.contains_key("message") {
        return Err(Error::Input(InputError::MessageConflict));
    }
    if message_path
        .as_ref()
        .is_some_and(|path| path.trim().is_empty())
    {
        return Err(Error::Input(InputError::Required));
    }
    if let Some(value) = fields.remove("message") {
        fields.insert(
            if name == Name::SendMessage {
                "text"
            } else {
                "firstMessage"
            }
            .into(),
            value,
        );
    }
    if fields.contains_key("agent") || fields.contains_key("model") {
        let mut model = Map::new();
        if let Some(value) = fields.remove("agent") {
            model.insert("agent".into(), value);
        }
        if let Some(value) = fields.remove("model") {
            model.insert("model".into(), value);
        }
        fields.insert("model".into(), Value::Object(model));
    }
    for key in [
        "limit",
        "offset",
        "updatedSince",
        "startLine",
        "startOffset",
        "port",
        "timeoutSeconds",
    ] {
        if let Some(Value::String(value)) = fields.get(key) {
            let number = number(value);
            fields.insert(key.into(), number);
        }
    }
    if let Some(Value::String(value)) = fields.get("fast") {
        let value = match value.as_str() {
            "true" => true,
            "false" => false,
            _ => return Err(Error::Input(InputError::Fast)),
        };
        fields.insert("fast".into(), Value::Bool(value));
    }
    if let Some(Value::String(value)) = fields.get("archived") {
        let value = match value.as_str() {
            "true" => true,
            "false" => false,
            _ => return Err(Error::Input(InputError::Archived)),
        };
        fields.insert("archived".into(), Value::Bool(value));
    }
    if name == Name::CloseSession && !fields.contains_key("stopRunningTurn") {
        fields.insert("stopRunningTurn".into(), Value::Bool(false));
    }
    Ok(Arguments {
        name,
        fields,
        message_path,
    })
}

fn number(value: &str) -> Value {
    let value = value.trim();
    if value.is_empty() {
        return Value::from(0);
    }
    for (prefixes, radix) in [(["0x", "0X"], 16), (["0b", "0B"], 2), (["0o", "0O"], 8)] {
        if let Some(digits) = prefixes
            .iter()
            .find_map(|prefix| value.strip_prefix(prefix))
        {
            return u64::from_str_radix(digits, radix)
                .map(Value::from)
                .unwrap_or(Value::Null);
        }
    }
    if let Ok(integer) = value.parse::<i64>() {
        return Value::from(integer);
    }
    if let Ok(number) = value.parse::<f64>() {
        if number.is_finite() && number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0 {
            return Value::from(number as i64);
        }
        return Value::from(number);
    }
    Value::Null
}
