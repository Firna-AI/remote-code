//! Filter display fields while preserving operational identities and file bytes.

use cnd_runner_interface::chat_events::AgentChatEvent;
use cnd_runner_interface::file_changes::ChangedFile;
use cnd_runner_interface::file_tree::{FileEntry, FileTreeChange, RunnerFileEvent};
use cnd_runner_interface::ports::RunnerPortsUpdated;
use cnd_runner_interface::runner::{RunnerEvent, RunnerStartUpdated, RunnerWorkspaceTitle};
use cnd_runner_interface::runner_files::{
    DiffReadOutcome, FileReadOutcome, RunnerDiffResult, RunnerFileResponse, RunnerFileResult,
};

fn label(path: &str, display: &mut Option<String>, text: &dyn Fn(&str) -> String) {
    let value = text(display.as_deref().filter(|s| !s.is_empty()).unwrap_or(path));
    if value != path || display.is_some() {
        *display = Some(value);
    }
}

fn entry(entry: &mut FileEntry, text: &dyn Fn(&str) -> String) {
    label(&entry.path, &mut entry.display_path, text);
    entry.name = text(&entry.name);
}

fn changed(file: &mut ChangedFile, text: &dyn Fn(&str) -> String) {
    label(&file.path, &mut file.display_path, text);
    if let Some(path) = &file.previous_path {
        label(path, &mut file.previous_display_path, text);
    }
}

pub(super) fn file(mut event: RunnerFileEvent, text: &dyn Fn(&str) -> String) -> RunnerFileEvent {
    match &mut event {
        RunnerFileEvent::FilesSnapshot { tree } => {
            for e in &mut tree.entries {
                entry(e, text);
            }
        }
        RunnerFileEvent::FilesChanged { delta } => {
            for change in &mut delta.changes {
                match change {
                    FileTreeChange::Upsert { entry: e } | FileTreeChange::Move { entry: e, .. } => {
                        entry(e, text)
                    }
                    _ => {}
                }
            }
        }
        RunnerFileEvent::ChangesUpdated { changes } => {
            let response = &mut changes.changes_response;
            label(
                &response.base_branch,
                &mut response.display_base_branch,
                text,
            );
            for file in &mut response.files {
                changed(&mut file.changed_file, text);
            }
        }
        _ => {}
    }
    event
}

pub(super) fn clean(mut event: RunnerEvent, text: &dyn Fn(&str) -> String) -> RunnerEvent {
    match &mut event {
        RunnerEvent::RunnerFileEvent(event) => *event = file(event.clone(), text),
        RunnerEvent::RunnerWorkspaceTitle(RunnerWorkspaceTitle::WorkspaceTitle { name }) => {
            *name = text(name)
        }
        RunnerEvent::RunnerStartUpdated(RunnerStartUpdated::StartUpdated { start }) => {
            for step in &mut start.steps {
                step.label = text(&step.label);
            }
        }
        RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated { ports }) => {
            for port in ports {
                port.name = port.name.as_deref().map(text);
                port.folder = port.folder.as_deref().map(text);
            }
        }
        RunnerEvent::AgentChatEvent(event) => match event {
            AgentChatEvent::AssistantDelta { text: value, .. }
            | AgentChatEvent::AssistantCompleted { text: value, .. } => *value = text(value),
            AgentChatEvent::ToolUpdated { tool, .. } => {
                tool.target = text(&tool.target);
                tool.detail = tool.detail.as_deref().map(text);
            }
            AgentChatEvent::TurnCompleted { files, .. } => {
                for file in files {
                    changed(file, text);
                }
            }
            AgentChatEvent::TurnFailed { error, .. } => error.message = text(&error.message),
            _ => {}
        },
        _ => {}
    }
    event
}

pub(super) fn response(
    mut response: RunnerFileResponse,
    text: &dyn Fn(&str) -> String,
) -> RunnerFileResponse {
    match &mut response {
        RunnerFileResponse::File(RunnerFileResult::Read {
            result: FileReadOutcome::Success { file, .. },
            ..
        }) => label(&file.path, &mut file.display_path, text),
        RunnerFileResponse::Diff(RunnerDiffResult::Diff {
            result: DiffReadOutcome::Success { diff, .. },
            ..
        }) => {
            label(&diff.path, &mut diff.display_path, text);
            label(&diff.base_branch, &mut diff.display_base_branch, text);
        }
        _ => {}
    }
    response
}
