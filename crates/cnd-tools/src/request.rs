//! Fixed machine routes for the typed tool calls.

use serde::Serialize;
use serde_json::Value;

use crate::call::Call;
use crate::error::{ErrorResultExt, Result};

/// HTTP path and optional JSON body.
pub(crate) struct Request {
    pub(crate) path: String,
    pub(crate) body: Option<String>,
}

fn read(path: String) -> Request {
    Request { path, body: None }
}
fn write(path: String, body: &impl Serialize) -> Result<Request> {
    Ok(Request {
        path,
        body: Some(serde_json::to_string(body).internal()?),
    })
}

pub(crate) fn request(call: &Call) -> Result<Request> {
    Ok(match call {
        Call::RunMacCommand(input) => write("/v1/tools/mac-command".into(), input)?,
        Call::CreateWorkspace(input) => write("/v1/tools/workspaces".into(), input)?,
        Call::ListWorkspaces(input) => read(query("/v1/tools/workspaces".into(), input)?),
        Call::GetWorkspace(workspace) => read(workspace_path(workspace)),
        Call::RenameWorkspace(workspace, input) => {
            write(format!("{}/rename", workspace_path(workspace)), input)?
        }
        Call::MoveWorkspace(workspace, input) => {
            write(format!("{}/move", workspace_path(workspace)), input)?
        }
        Call::ArchiveWorkspace(workspace) => {
            write(format!("{}/archive", workspace_path(workspace)), &())?
        }
        Call::ListRepositories => read("/v1/tools/repositories".into()),
        Call::ListSections => read("/v1/tools/sections".into()),
        Call::ListModels => read("/v1/tools/models".into()),
        Call::ListSessions(workspace, input) => read(query(
            format!("{}/sessions", workspace_path(workspace)),
            input,
        )?),
        Call::ReadSession(workspace, session, input) => read(query(
            format!("{}/transcript", session_path(workspace, session)),
            input,
        )?),
        Call::CreateSession(workspace, input) => {
            write(format!("{}/sessions", workspace_path(workspace)), input)?
        }
        Call::SendMessage(workspace, session, input) => write(
            format!("{}/messages", session_path(workspace, session)),
            input,
        )?,
        Call::GetSession(workspace, session) => read(session_path(workspace, session)),
        Call::RenameSession(workspace, session, input) => write(
            format!("{}/rename", session_path(workspace, session)),
            input,
        )?,
        Call::CloseSession(workspace, session, input) => {
            write(format!("{}/close", session_path(workspace, session)), input)?
        }
        Call::StopSession(workspace, session) => {
            write(format!("{}/stop", session_path(workspace, session)), &())?
        }
        Call::GetMessage(workspace, session, message) => read(format!(
            "{}/messages/{}",
            session_path(workspace, session),
            component(message)
        )),
        Call::CreateSection(input) => write("/v1/tools/sections".into(), input)?,
        Call::DeleteSection(section) => write(
            format!("/v1/tools/sections/{}/delete", component(section)),
            &(),
        )?,
        Call::ListPreviews(workspace) => read(format!("{}/previews", workspace_path(workspace))),
        Call::OpenPreview(workspace, input) => {
            write(format!("{}/previews", workspace_path(workspace)), input)?
        }
        Call::ClosePreview(workspace, preview) => write(
            format!(
                "{}/previews/{}/close",
                workspace_path(workspace),
                component(preview)
            ),
            &(),
        )?,
    })
}

fn workspace_path(id: &str) -> String {
    format!("/v1/tools/workspaces/{}", component(id))
}
fn session_path(workspace: &str, session: &str) -> String {
    format!(
        "{}/sessions/{}",
        workspace_path(workspace),
        component(session)
    )
}

pub(crate) fn component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn query(path: String, input: &impl Serialize) -> Result<String> {
    let value = serde_json::to_value(input).internal()?;
    let Some(fields) = value.as_object() else {
        return Ok(path);
    };
    let mut query = reqwest::Url::parse("http://localhost").internal()?;
    {
        let mut pairs = query.query_pairs_mut();
        for (key, value) in fields {
            if !value.is_null() {
                pairs.append_pair(
                    key,
                    &match value {
                        Value::String(value) => value.clone(),
                        _ => value.to_string(),
                    },
                );
            }
        }
    }
    Ok(match query.query() {
        Some(suffix) if !suffix.is_empty() => format!("{path}?{suffix}"),
        _ => path,
    })
}
