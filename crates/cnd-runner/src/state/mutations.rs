//! Number accepted events and update their metadata in the same snapshot.

use cnd_runner_interface::api::Timestamp;
use cnd_runner_interface::file_tree::{FILE_EVENT_MAX_BYTES, RunnerFileEvent};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_handshake::{RUNNER_EVENT_MAX_BYTES, RunnerEventEnvelope};

use crate::error::{Error, Result};
use crate::json::codec::{self, MAX_SAFE_INTEGER};

use super::records::{RunnerState, validate_event};
use super::turns::{pending_end, record};

pub(super) fn append(
    state: &mut RunnerState,
    event: RunnerEvent,
    now: i64,
    command_id: Option<String>,
) -> Result<Option<RunnerEventEnvelope>> {
    if let Some(end) = pending_end(state, &event) {
        return Ok(Some(end));
    }
    validate_event(&event)?;
    if state.next_event_number >= MAX_SAFE_INTEGER {
        return Err(Error::InvalidNumber);
    }
    let envelope = RunnerEventEnvelope::Event {
        stream_id: state.stream_id.clone(),
        event_number: state.next_event_number,
        occurred_at: Timestamp(now),
        event: event.clone(),
    };
    let file = matches!(
        &event,
        RunnerEvent::RunnerFileEvent(
            RunnerFileEvent::FilesSnapshot { .. }
                | RunnerFileEvent::FilesChanged { .. }
                | RunnerFileEvent::ChangesUpdated { .. }
        )
    );
    if codec::encode(&envelope)?.len() as u64 > RUNNER_EVENT_MAX_BYTES
        || (file && codec::encode(&event)?.len() as u64 > FILE_EVENT_MAX_BYTES)
    {
        return Ok(None);
    }
    let number = state.next_event_number;
    state.next_event_number += 1;
    retain_revision(state, &event);
    record(state, &event, number, now);
    if let Some(command_id) = command_id {
        state.reports.commands.push(command_id);
    }
    state.outbox.push(envelope.clone());
    Ok(Some(envelope))
}

pub(super) fn retain_revision(state: &mut RunnerState, event: &RunnerEvent) {
    match event {
        RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) => {
            state.file_revisions.tree = tree.part.revision
        }
        RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesChanged { delta }) => {
            state.file_revisions.tree = delta.revision
        }
        RunnerEvent::RunnerFileEvent(RunnerFileEvent::ChangesUpdated { changes }) => {
            state.file_revisions.changes = changes.runner_file_revision_part.revision
        }
        RunnerEvent::RunnerStartUpdated(report) => {
            state.reports.latest.start = Some(report.clone())
        }
        RunnerEvent::RunnerWorkspaceTitle(report) => {
            state.reports.latest.title = Some(report.clone())
        }
        _ => {}
    }
}
