//! Reconnect loop and command ownership without agent or repository work.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::runner_commands::RunnerCommand;
use futures_util::future::BoxFuture;
use tokio::sync::watch;
use tokio::task::JoinSet;

use crate::clock::Clock;
use crate::error::Result;
use crate::link::ports::{LinkUpdate, RunnerLink};
use crate::state::store::EventStore;

/// File and turn owners receive commands without blocking socket confirmations.
#[cfg_attr(test, unimock::unimock(api = CommandHandlerMock))]
#[async_trait]
pub trait CommandHandler: Send + Sync {
    /// Start warm-up and offline report schedules before the first connection attempt.
    async fn start(&self) -> Result<()> {
        Ok(())
    }
    /// Reserve initial reports in wire order, then send runner.ready after they finish.
    fn connected(&self) -> BoxFuture<'static, Result<()>>;
    /// Queue one command in wire order. The handler owns its asynchronous work.
    fn command(&self, command: RunnerCommand) -> Result<()>;
    /// End accepted live turns before the final persist and socket close.
    async fn shutdown(&self) -> Result<()>;
}

/// Long-running runner core, consumed through a trait object.
#[async_trait]
pub trait Runner: Send + Sync {
    /// Run until shutdown is true or its sender closes. Startup errors propagate.
    async fn run(&self, shutdown: watch::Receiver<bool>) -> Result<()>;
}

/// Connection runtime. Repository scans and agents belong to injected handlers.
pub struct RunnerCore {
    link: Arc<dyn RunnerLink>,
    store: Arc<dyn EventStore>,
    clock: Arc<dyn Clock>,
    handler: Arc<dyn CommandHandler>,
}

impl RunnerCore {
    /// Compose a runtime from a loaded store and a saved-event link.
    pub fn new(
        link: Arc<dyn RunnerLink>,
        store: Arc<dyn EventStore>,
        clock: Arc<dyn Clock>,
        handler: Arc<dyn CommandHandler>,
    ) -> Self {
        Self {
            link,
            store,
            clock,
            handler,
        }
    }

    async fn connected(
        &self,
        shutdown: &mut watch::Receiver<bool>,
        jobs: &mut JoinSet<(u64, Result<()>)>,
        round: u64,
    ) {
        let mut step = self.link.step();
        loop {
            tokio::select! {
                biased;
                _ = async { let _ = shutdown.wait_for(|stopped| *stopped).await; } => return,
                finished = jobs.join_next(), if !jobs.is_empty() => {
                    match finished {
                        Some(Ok((job_round, Err(_)))) => {
                            tracing::warn!("The runner command could not finish.");
                            if job_round == round {
                                drop(step);
                                let _ = self.link.close().await;
                                return;
                            }
                        },
                        Some(Err(_)) => tracing::warn!("The runner command task could not finish."),
                        _ => {},
                    }
                },
                update = &mut step => {
                    match update {
                        Ok(LinkUpdate::Connected) => {
                            let connected = self.handler.connected();
                            jobs.spawn(async move { (round, connected.await) });
                        },
                        Ok(LinkUpdate::Command(command)) => {
                            if self.handler.command(*command).is_err() { tracing::warn!("The runner command could not finish."); }
                        },
                        Ok(LinkUpdate::Progress) => {},
                        Ok(LinkUpdate::Disconnected) | Err(_) => return,
                    }
                    step = self.link.step();
                },
            }
        }
    }
}

#[async_trait]
impl Runner for RunnerCore {
    async fn run(&self, mut shutdown: watch::Receiver<bool>) -> Result<()> {
        let now = self.clock.now()?;
        if self.store.recover(now).await.is_err() {
            self.store.persist().await?;
            self.store.recover(now).await?;
        }
        self.handler.start().await?;
        let mut jobs = JoinSet::new();
        let mut round = 0;
        while !*shutdown.borrow() && shutdown.has_changed().is_ok() {
            round += 1;
            let connected = tokio::select! {
                biased;
                _ = async { let _ = shutdown.wait_for(|stopped| *stopped).await; } => break,
                connected = self.link.connect() => connected,
            };
            if connected.is_ok() {
                self.connected(&mut shutdown, &mut jobs, round).await;
            }
            if *shutdown.borrow() || shutdown.has_changed().is_err() {
                break;
            }
            tracing::warn!("The runner will retry its connection.");
            tokio::select! {
                biased;
                _ = async { let _ = shutdown.wait_for(|stopped| *stopped).await; } => {},
                _ = self.clock.reconnect_delay() => {},
            }
        }
        let ended = self.handler.shutdown().await;
        while let Some(job) = jobs.join_next().await {
            if !matches!(job, Ok((_, Ok(())))) {
                tracing::warn!("The runner command could not finish.");
            }
        }
        let saved = self.link.persist().await;
        let closed = self.link.close().await;
        ended?;
        saved?;
        closed
    }
}

#[cfg(test)]
#[path = "_tests_/runtime_tests.rs"]
mod runtime_tests;
