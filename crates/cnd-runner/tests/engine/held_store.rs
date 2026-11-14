//! Hold store entry points independently of the durable write queue.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner::error::Result;
use cnd_runner::reports::prepare::ReportFilter;
use cnd_runner::state::records::{RunnerState, SavedSession, SavedTurn};
use cnd_runner::state::store::EventStore;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_commands::RunnerReportKind;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

use super::helpers::Gate;

pub(super) struct HeldStore {
    pub inner: Arc<dyn EventStore>,
    pub acceptance: Gate,
    pub session: Gate,
}
#[async_trait]
impl EventStore for HeldStore {
    async fn load(&self) -> Result<()> {
        self.inner.load().await
    }
    async fn snapshot(&self) -> RunnerState {
        self.inner.snapshot().await
    }
    async fn append(
        &self,
        event: RunnerEvent,
        now: i64,
        command: Option<String>,
    ) -> Result<Option<RunnerEventEnvelope>> {
        self.inner.append(event, now, command).await
    }
    async fn confirm(&self, through: u64) -> Result<()> {
        self.inner.confirm(through).await
    }
    async fn remember(&self, session: SavedSession) -> Result<()> {
        self.session.wait().await;
        self.inner.remember(session).await
    }
    async fn accept_turn(&self, turn: SavedTurn) -> Result<()> {
        self.acceptance.wait().await;
        self.inner.accept_turn(turn).await
    }
    async fn persist(&self) -> Result<()> {
        self.inner.persist().await
    }
    async fn remember_report_command(&self, command: String) -> Result<()> {
        self.inner.remember_report_command(command).await
    }
    async fn refresh_report(
        &self,
        kind: RunnerReportKind,
        command: String,
        now: i64,
        filter: Arc<dyn ReportFilter>,
    ) -> Result<()> {
        self.inner.refresh_report(kind, command, now, filter).await
    }
    async fn recover(&self, now: i64) -> Result<()> {
        self.inner.recover(now).await
    }
}
