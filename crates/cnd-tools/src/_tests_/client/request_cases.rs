//! Literal HTTP contracts for every workspace tool operation.

use serde_json::{Value, json};

use crate::call::{Call, Name};
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::input;

pub(super) struct Case {
    pub(super) call: Call,
    pub(super) path: &'static [&'static str],
    pub(super) query: Value,
    pub(super) body: Option<Value>,
}

fn read(name: Name, fields: Value, path: &'static [&'static str], query: Value) -> Result<Case> {
    Ok(Case {
        call: input::parse(
            name,
            fields.as_object().ok_or(Error::Input(InputError::Object))?,
            "retry",
        )
        .internal()?,
        path,
        query,
        body: None,
    })
}

fn write(name: Name, fields: Value, path: &'static [&'static str], body: Value) -> Result<Case> {
    Ok(Case {
        call: input::parse(
            name,
            fields.as_object().ok_or(Error::Input(InputError::Object))?,
            "retry",
        )
        .internal()?,
        path,
        query: json!({}),
        body: Some(body),
    })
}

pub(super) fn cases() -> Result<Vec<Case>> {
    Ok(vec![
        write(
            Name::RunMacCommand,
            json!({"command":"pwd","folder":"/tmp","reason":"Check folder"}),
            &["mac-command"],
            json!({"requestId":"retry","command":"pwd","folder":"/tmp","reason":"Check folder","timeoutSeconds":60}),
        )?,
        write(
            Name::CreateWorkspace,
            json!({"repositoryId":"repository","firstMessage":" Work\n ","name":"Project",
            "firstSessionTitle":"First title","model":{"agent":"claude","model":"chosen-model"},"effort":"max","fast":true,"sectionId":"section"}),
            &["workspaces"],
            json!({"repositoryId":"repository","firstMessage":" Work\n ","name":"Project","firstSessionTitle":"First title",
                "model":{"agent":"claude","model":"chosen-model"},"effort":"max","fast":true,"sectionId":"section","requestId":"retry"}),
        )?,
        read(
            Name::ListWorkspaces,
            json!({"ownerId":"member","state":"ready","repositoryId":"repository","query":"Par",
            "updatedSince":-1,"archived":false,"limit":1,"offset":0}),
            &["workspaces"],
            json!({"ownerId":"member","state":"ready","repositoryId":"repository","query":"Par","updatedSince":"-1","archived":"false","limit":"1","offset":"0"}),
        )?,
        read(
            Name::GetWorkspace,
            json!({}),
            &["workspaces", "current"],
            json!({}),
        )?,
        write(
            Name::RenameWorkspace,
            json!({"workspaceId":"team / one","name":"New name"}),
            &["workspaces", "team%20%2F%20one", "rename"],
            json!({"name":"New name"}),
        )?,
        write(
            Name::MoveWorkspace,
            json!({"workspaceId":"team / one","sectionId":"section"}),
            &["workspaces", "team%20%2F%20one", "move"],
            json!({"sectionId":"section"}),
        )?,
        write(
            Name::ArchiveWorkspace,
            json!({"workspaceId":"team / one"}),
            &["workspaces", "team%20%2F%20one", "archive"],
            json!({}),
        )?,
        read(
            Name::ListRepositories,
            json!({}),
            &["repositories"],
            json!({}),
        )?,
        read(Name::ListSections, json!({}), &["sections"], json!({}))?,
        read(Name::ListModels, json!({}), &["models"], json!({}))?,
        read(
            Name::ListSessions,
            json!({"workspaceId":"team / one","limit":1,"offset":2}),
            &["workspaces", "team%20%2F%20one", "sessions"],
            json!({"limit":"1","offset":"2"}),
        )?,
        read(
            Name::ReadSession,
            json!({"workspaceId":"team / one","sessionId":"session / one","detail":"full","startLine":2,"startOffset":0}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "transcript",
            ],
            json!({"detail":"full","startLine":"2","startOffset":"0"}),
        )?,
        write(
            Name::CreateSession,
            json!({"title":"New session","firstMessage":"  Work  ","model":{"agent":"codex","model":"model"},"effort":"high","fast":false}),
            &["workspaces", "current", "sessions"],
            json!({"title":"New session","firstMessage":"  Work  ","model":{"agent":"codex","model":"model"},"effort":"high","fast":false,"requestId":"retry"}),
        )?,
        write(
            Name::SendMessage,
            json!({"workspaceId":"team / one","sessionId":"session / one","text":" Work\r\n ","requestId":"stable-send"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "messages",
            ],
            json!({"text":" Work\r\n ","requestId":"stable-send"}),
        )?,
        read(
            Name::GetSession,
            json!({"workspaceId":"team / one","sessionId":"session / one"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
            ],
            json!({}),
        )?,
        write(
            Name::RenameSession,
            json!({"workspaceId":"team / one","sessionId":"session / one","title":"New title"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "rename",
            ],
            json!({"title":"New title"}),
        )?,
        write(
            Name::CloseSession,
            json!({"workspaceId":"team / one","sessionId":"session / one","stopRunningTurn":true}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "close",
            ],
            json!({"stopRunningTurn":true}),
        )?,
        write(
            Name::StopSession,
            json!({"workspaceId":"team / one","sessionId":"session / one"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "stop",
            ],
            json!({}),
        )?,
        read(
            Name::GetMessage,
            json!({"workspaceId":"team / one","sessionId":"session / one","messageId":"message / one"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "sessions",
                "session%20%2F%20one",
                "messages",
                "message%20%2F%20one",
            ],
            json!({}),
        )?,
        write(
            Name::CreateSection,
            json!({"name":"Reviews"}),
            &["sections"],
            json!({"name":"Reviews"}),
        )?,
        write(
            Name::DeleteSection,
            json!({"sectionId":"section / one"}),
            &["sections", "section%20%2F%20one", "delete"],
            json!({}),
        )?,
        read(
            Name::ListPreviews,
            json!({"workspaceId":"team / one"}),
            &["workspaces", "team%20%2F%20one", "previews"],
            json!({}),
        )?,
        write(
            Name::OpenPreview,
            json!({"workspaceId":"team / one","port":4321}),
            &["workspaces", "team%20%2F%20one", "previews"],
            json!({"port":4321}),
        )?,
        write(
            Name::ClosePreview,
            json!({"workspaceId":"team / one","previewId":"preview / one"}),
            &[
                "workspaces",
                "team%20%2F%20one",
                "previews",
                "preview%20%2F%20one",
                "close",
            ],
            json!({}),
        )?,
    ])
}
