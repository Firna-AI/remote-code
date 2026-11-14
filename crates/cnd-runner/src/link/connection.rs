//! Stateful runner link consumed through RunnerLink.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_credentials::{LoginKind, RunnerLoginKind};
use cnd_runner_interface::runner_files::RunnerFileResponse;
use cnd_runner_interface::runner_handshake::{
    RunnerEventEnvelope, RunnerHello, RunnerProtocolVersion, RunnerToWorkspace,
};
use tokio::sync::Mutex;

use crate::clock::Clock;
use crate::config::ConnectionRequest;
use crate::error::Result;
use crate::limits::bound_event;
use crate::socket::{Connector, Socket};
use crate::state::store::EventStore;

use super::ports::{LinkUpdate, RunnerLink};

pub(super) struct Connection {
    pub(super) generation: u64,
    pub(super) socket: Option<Arc<dyn Socket>>,
    pub(super) welcomed: bool,
}

/// Configured transport and state dependencies. Tokens stay in memory only.
pub struct SavedRunnerLink {
    pub(super) workspace_id: String,
    pub(super) request: ConnectionRequest,
    pub(super) connector: Arc<dyn Connector>,
    pub(super) clock: Arc<dyn Clock>,
    pub(super) store: Arc<dyn EventStore>,
    pub(super) connection: Mutex<Connection>,
    connecting: Mutex<()>,
    pub(super) messages: Mutex<()>,
}

impl SavedRunnerLink {
    /// Compose the link without performing IO. The store must already be loaded.
    pub fn new(
        workspace_id: String,
        request: ConnectionRequest,
        connector: Arc<dyn Connector>,
        clock: Arc<dyn Clock>,
        store: Arc<dyn EventStore>,
    ) -> Self {
        Self {
            workspace_id,
            request,
            connector,
            clock,
            store,
            connection: Mutex::new(Connection {
                generation: 0,
                socket: None,
                welcomed: false,
            }),
            connecting: Mutex::new(()),
            messages: Mutex::new(()),
        }
    }

    pub(super) async fn disconnect(&self, generation: u64) {
        let socket = {
            let mut active = self.connection.lock().await;
            if active.generation != generation {
                return;
            }
            active.generation += 1;
            active.welcomed = false;
            active.socket.take()
        };
        if let Some(socket) = socket {
            let _ = socket.close().await;
        }
    }

    pub(super) async fn send(&self, message: RunnerToWorkspace) {
        let current = {
            let active = self.connection.lock().await;
            if !active.welcomed {
                return;
            }
            active
                .socket
                .as_ref()
                .map(|socket| (active.generation, socket.clone()))
        };
        if let Some((generation, socket)) = current
            && socket.send(&message).await.is_err()
        {
            self.disconnect(generation).await;
        }
    }

    pub(super) async fn resend(&self, from: u64) {
        for envelope in self.store.snapshot().await.outbox {
            let RunnerEventEnvelope::Event { event_number, .. } = &envelope;
            if *event_number >= from {
                self.send(RunnerToWorkspace::RunnerEventEnvelope(envelope))
                    .await;
            }
        }
    }
}

#[async_trait]
impl RunnerLink for SavedRunnerLink {
    async fn connect(&self) -> Result<()> {
        let _connecting = self.connecting.lock().await;
        self.close().await?;
        let generation = self.connection.lock().await.generation;
        let socket = self.connector.connect(&self.request).await?;
        {
            let mut active = self.connection.lock().await;
            if active.generation != generation {
                return socket.close().await;
            }
            active.socket = Some(socket.clone());
        }
        let hello = RunnerHello::Hello {
            protocol_version: RunnerProtocolVersion,
            workspace_id: self.workspace_id.clone(),
            stream_id: self.store.snapshot().await.stream_id,
            login_kinds: Some(vec![
                RunnerLoginKind::Claude {
                    kind: LoginKind::Token,
                },
                RunnerLoginKind::Claude {
                    kind: LoginKind::ApiKey,
                },
                RunnerLoginKind::Codex {
                    kind: LoginKind::Token,
                },
                RunnerLoginKind::Codex {
                    kind: LoginKind::ApiKey,
                },
            ]),
        };
        if let Err(error) = socket.send(&RunnerToWorkspace::RunnerHello(hello)).await {
            self.disconnect(generation).await;
            return Err(error);
        }
        Ok(())
    }

    async fn step(&self) -> Result<LinkUpdate> {
        self.next_message().await
    }

    async fn emit(&self, event: RunnerEvent, report_command_id: Option<String>) -> Result<()> {
        match self
            .store
            .append(bound_event(event)?, self.clock.now()?, report_command_id)
            .await?
        {
            Some(envelope) => {
                self.send(RunnerToWorkspace::RunnerEventEnvelope(envelope))
                    .await
            }
            None => tracing::warn!("The runner event exceeds its byte limit."),
        }
        Ok(())
    }

    async fn persist(&self) -> Result<()> {
        self.store.persist().await?;
        self.resend(self.store.snapshot().await.confirmed_through + 1)
            .await;
        Ok(())
    }

    async fn reply(&self, response: RunnerFileResponse) -> Result<()> {
        self.send(RunnerToWorkspace::RunnerFileResponse(response))
            .await;
        Ok(())
    }

    async fn close(&self) -> Result<()> {
        let generation = self.connection.lock().await.generation;
        self.disconnect(generation).await;
        Ok(())
    }
}
