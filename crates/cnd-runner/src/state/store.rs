//! Serialized writes with separate pending and committed snapshots.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_commands::RunnerReportKind;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use tokio::sync::{Mutex, RwLock};

use crate::disk::Disk;
use crate::error::{Error, Result};
use crate::json::codec;
use crate::reports::prepare::ReportFilter;

use super::mutations::append;
use super::records::{RunnerState, SavedSession, SavedTurn};
use super::turns::recovered_end;

/// Event state shared by the socket, file reporters, and turn engine.
#[cfg_attr(test, unimock::unimock(api = EventStoreMock))]
#[async_trait]
pub trait EventStore: Send + Sync {
    /// Load and save state before the first connection. Missing state starts a stream.
    async fn load(&self) -> Result<()>;
    /// Return only the last complete successful save, even while a write waits.
    async fn snapshot(&self) -> RunnerState;
    /// Number and save one event. An oversized event takes no number.
    async fn append(
        &self,
        event: RunnerEvent,
        now: i64,
        report_command_id: Option<String>,
    ) -> Result<Option<RunnerEventEnvelope>>;
    /// Save the contiguous confirmation and remove covered end records.
    async fn confirm(&self, through: u64) -> Result<()>;
    /// Replace one session's conversation reference and instructions.
    async fn remember(&self, session: SavedSession) -> Result<()>;
    /// Save acceptance before the session starts. Start and end numbers begin null.
    async fn accept_turn(&self, turn: SavedTurn) -> Result<()>;
    /// Retry the full pending state, including changes from failed saves.
    async fn persist(&self) -> Result<()>;
    /// Save a report command receipt even when no retained report exists.
    async fn remember_report_command(&self, command_id: String) -> Result<()>;
    /// Select, filter, append, and receipt a retained report in one state operation.
    async fn refresh_report(
        &self,
        kind: RunnerReportKind,
        command_id: String,
        now: i64,
        filter: Arc<dyn ReportFilter>,
    ) -> Result<()>;
    /// Append one stopped end for each unfinished saved turn. Never start agents.
    async fn recover(&self, now: i64) -> Result<()>;
}

/// Disk-backed outbox. All mutations remain pending after a failed write.
pub struct DurableStore {
    disk: Arc<dyn Disk>,
    pending: Mutex<RunnerState>,
    committed: RwLock<RunnerState>,
}

impl DurableStore {
    /// Configure a store. Call load once before sharing its EventStore interface.
    pub fn new(disk: Arc<dyn Disk>, stream_id: String) -> Self {
        let state = RunnerState::new(stream_id);
        Self {
            disk,
            pending: Mutex::new(state.clone()),
            committed: RwLock::new(state),
        }
    }

    async fn save(&self, state: &RunnerState) -> Result<()> {
        self.disk.write(&codec::encode(state)?).await?;
        *self.committed.write().await = state.clone();
        Ok(())
    }
}

#[async_trait]
impl EventStore for DurableStore {
    async fn load(&self) -> Result<()> {
        let mut state = self.pending.lock().await;
        if let Some(bytes) = self.disk.read().await? {
            *state = RunnerState::decode(&bytes)?;
        }
        self.save(&state).await
    }

    async fn snapshot(&self) -> RunnerState {
        self.committed.read().await.clone()
    }

    async fn append(
        &self,
        event: RunnerEvent,
        now: i64,
        report_command_id: Option<String>,
    ) -> Result<Option<RunnerEventEnvelope>> {
        let mut state = self.pending.lock().await;
        let Some(envelope) = append(&mut state, event, now, report_command_id)? else {
            return Ok(None);
        };
        self.save(&state).await?;
        Ok(Some(envelope))
    }

    async fn confirm(&self, through: u64) -> Result<()> {
        let mut state = self.pending.lock().await;
        if through < state.confirmed_through {
            return Ok(());
        }
        if through >= state.next_event_number {
            return Err(Error::ConfirmationAhead);
        }
        state.confirmed_through = through;
        state
            .outbox
            .retain(|RunnerEventEnvelope::Event { event_number, .. }| *event_number > through);
        state
            .turns
            .retain(|turn| turn.end_event_number.is_none_or(|end| end > through));
        self.save(&state).await
    }

    async fn remember(&self, session: SavedSession) -> Result<()> {
        let mut state = self.pending.lock().await;
        state
            .sessions
            .retain(|saved| saved.session_id != session.session_id);
        state.sessions.push(session);
        self.save(&state).await
    }

    async fn accept_turn(&self, mut turn: SavedTurn) -> Result<()> {
        let mut state = self.pending.lock().await;
        turn.start_event_number = None;
        turn.end_event_number = None;
        if !state
            .turns
            .iter()
            .any(|saved| saved.session_id == turn.session_id && saved.turn_id == turn.turn_id)
        {
            state.turns.push(turn);
        }
        self.save(&state).await
    }

    async fn persist(&self) -> Result<()> {
        let state = self.pending.lock().await;
        self.save(&state).await
    }

    async fn remember_report_command(&self, command_id: String) -> Result<()> {
        let mut state = self.pending.lock().await;
        state.reports.commands.push(command_id);
        self.save(&state).await
    }

    async fn refresh_report(
        &self,
        kind: RunnerReportKind,
        command_id: String,
        now: i64,
        filter: Arc<dyn ReportFilter>,
    ) -> Result<()> {
        let mut state = self.pending.lock().await;
        if state.reports.commands.contains(&command_id) {
            return Ok(());
        }
        let report = match kind {
            RunnerReportKind::StartUpdated => state
                .reports
                .latest
                .start
                .clone()
                .map(RunnerEvent::RunnerStartUpdated),
            RunnerReportKind::WorkspaceTitle => state
                .reports
                .latest
                .title
                .clone()
                .map(RunnerEvent::RunnerWorkspaceTitle),
            _ => return Err(Error::InvalidCommand),
        };
        if let Some(report) = report {
            append(&mut state, filter.report(report)?, now, Some(command_id))?;
        } else {
            state.reports.commands.push(command_id);
        }
        self.save(&state).await
    }

    async fn recover(&self, now: i64) -> Result<()> {
        let mut state = self.pending.lock().await;
        let turns: Vec<_> = state
            .turns
            .iter()
            .filter(|t| t.end_event_number.is_none())
            .cloned()
            .collect();
        for turn in turns {
            append(&mut state, recovered_end(&turn, now), now, None)?;
            self.save(&state).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "../_tests_/state_tests.rs"]
mod state_tests;
