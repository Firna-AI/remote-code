//! Full durable engine fixture with in-memory effect boundaries.

use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use cnd_runner::emitter::{EventEmitter, SavingEmitter};
use cnd_runner::engine::dependencies::EngineDependencies;
use cnd_runner::engine::handler::AgentEngine;
use cnd_runner::filter::service::{CredentialFilter, Credentials, FilteredEmitter};
use cnd_runner::helper::boundary::HelperFactory;
use cnd_runner::link::connection::SavedRunnerLink;
use cnd_runner::runtime::CommandHandler;
use cnd_runner::state::store::{DurableStore, EventStore};
use cnd_runner_interface::chat_events::AgentChatEvent;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_commands::RunnerCommand;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

use super::builders::configuration;
use super::helpers::{Helpers, Process};
use super::memory::{Memory, NoConnection, Start, TestClock};
use super::repository::{Factory, Repositories};

pub(super) type TestResult = std::result::Result<(), Box<dyn std::error::Error>>;

pub(super) struct Fixture {
    pub engine: Arc<AgentEngine>,
    pub store: Arc<dyn EventStore>,
    pub memory: Arc<Memory>,
    pub helpers: Arc<Helpers>,
    pub repositories: Arc<Repositories>,
    pub clock: Arc<TestClock>,
    pub startup: Arc<Start>,
}
impl Fixture {
    pub(super) async fn new() -> std::result::Result<Self, Box<dyn std::error::Error>> {
        Self::open(
            Arc::new(Memory::default()),
            Arc::new(Helpers::default()),
            None,
        )
        .await
    }
    pub(super) async fn open(
        memory: Arc<Memory>,
        helpers: Arc<Helpers>,
        saved: Option<Arc<dyn EventStore>>,
    ) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        Self::compose(memory, helpers, saved, None).await
    }
    pub(super) async fn compose(
        memory: Arc<Memory>,
        helpers: Arc<Helpers>,
        saved: Option<Arc<dyn EventStore>>,
        factory: Option<Arc<dyn HelperFactory>>,
    ) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let store: Arc<dyn EventStore> =
            saved.unwrap_or_else(|| Arc::new(DurableStore::new(memory.clone(), "stream".into())));
        store.load().await?;
        store.recover(100).await?;
        let clock = Arc::new(TestClock(AtomicI64::new(100)));
        let configuration = configuration()?;
        let link = Arc::new(SavedRunnerLink::new(
            "workspace".into(),
            configuration.request.clone(),
            Arc::new(NoConnection),
            clock.clone(),
            store.clone(),
        ));
        let filter = Arc::new(CredentialFilter::default());
        filter.add("workspace-token".into())?;
        let emitter: Arc<dyn EventEmitter> = Arc::new(FilteredEmitter::new(
            filter.clone(),
            Arc::new(SavingEmitter::new(link)),
        ));
        let repositories = Arc::new(Repositories::default());
        let startup = Arc::new(Start::default());
        let engine = Arc::new(AgentEngine::new(
            EngineDependencies {
                configuration,
                store: store.clone(),
                emitter,
                credentials: filter.clone(),
                helpers: factory.unwrap_or_else(|| helpers.clone()),
                repositories: Arc::new(Factory(repositories.clone())),
                clock: clock.clone(),
                startup: startup.clone(),
                background_limit: Duration::from_secs(30 * 24 * 60 * 60),
            },
            store.snapshot().await,
        ));
        Ok(Self {
            engine,
            store,
            memory,
            helpers,
            repositories,
            clock,
            startup,
        })
    }
    pub(super) async fn command(&self, command: RunnerCommand) -> TestResult {
        self.engine.command(command)?;
        self.engine.idle().await?;
        Ok(())
    }
    pub(super) fn latest(&self) -> std::result::Result<Arc<Process>, Box<dyn std::error::Error>> {
        self.helpers
            .processes
            .lock()
            .map_err(|_| "test lock poisoned")?
            .last()
            .cloned()
            .ok_or_else(|| "No helper opened".into())
    }
    pub(super) async fn events(&self) -> Vec<AgentChatEvent> {
        self.store
            .snapshot()
            .await
            .outbox
            .into_iter()
            .filter_map(|RunnerEventEnvelope::Event { event, .. }| match event {
                RunnerEvent::AgentChatEvent(event) => Some(event),
                _ => None,
            })
            .collect()
    }
    pub(super) async fn wait_events(&self, count: usize) {
        loop {
            let changed = self.memory.changed.notified();
            if self.events().await.len() >= count {
                return;
            }
            changed.await;
        }
    }
    pub(super) async fn close(&self) -> TestResult {
        self.engine.shutdown().await?;
        Ok(())
    }
    pub(super) fn fail(&self, kind: &str, count: usize) -> TestResult {
        *self
            .memory
            .fail_kind
            .lock()
            .map_err(|_| "test lock poisoned")? = kind.to_owned();
        *self
            .memory
            .failures
            .lock()
            .map_err(|_| "test lock poisoned")? = count;
        Ok(())
    }
    pub(super) async fn advance(&self, duration: Duration) {
        self.clock
            .0
            .fetch_add(duration.as_millis() as i64, Ordering::SeqCst);
        tokio::time::advance(duration).await;
    }
}
