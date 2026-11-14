//! In-memory workspace endpoint: hello, cursors, gaps, duplicates, and refusals.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use cnd_runner::config::ConnectionRequest;
use cnd_runner::error::{Error, Result};
use cnd_runner::json::{codec, commands::workspace_message};
use cnd_runner::socket::{Connector, Socket};
use cnd_runner_interface::runner_handshake::{
    RunnerConfirm, RunnerEventEnvelope, RunnerHello, RunnerProtocolVersion, RunnerResend,
    RunnerToWorkspace, RunnerWelcome, WorkspaceToRunner,
};
use tokio::sync::{Mutex, mpsc};

pub(crate) fn request() -> ConnectionRequest {
    ConnectionRequest {
        url: "wss://machines.test/v1/runner".into(),
        workspace_token: "workspace-token".into(),
    }
}

pub(crate) struct Endpoint {
    pub state: Mutex<State>,
    incoming: Mutex<Option<mpsc::UnboundedSender<Option<Vec<u8>>>>>,
}

pub(crate) struct State {
    pub received: Vec<RunnerToWorkspace>,
    pub events: Vec<RunnerEventEnvelope>,
    pub refusals: Vec<u64>,
    pub confirm: bool,
    pub welcome: bool,
    pub drop_next: bool,
    pub refuse: BTreeSet<u64>,
    cursors: BTreeMap<String, u64>,
}

impl Default for Endpoint {
    fn default() -> Self {
        Self {
            incoming: Mutex::new(None),
            state: Mutex::new(State {
                received: vec![],
                events: vec![],
                refusals: vec![],
                confirm: false,
                welcome: true,
                drop_next: false,
                refuse: BTreeSet::new(),
                cursors: BTreeMap::new(),
            }),
        }
    }
}

impl Endpoint {
    pub(crate) async fn inject(&self, message: WorkspaceToRunner) {
        self.raw(codec::encode(&message).unwrap()).await;
    }

    pub(crate) async fn raw(&self, bytes: Vec<u8>) {
        self.incoming
            .lock()
            .await
            .as_ref()
            .unwrap()
            .send(Some(bytes))
            .unwrap();
    }

    pub(crate) async fn disconnect(&self) {
        self.incoming
            .lock()
            .await
            .as_ref()
            .unwrap()
            .send(None)
            .unwrap();
    }
}

pub(crate) struct EndpointConnector(pub Arc<Endpoint>);

struct Connection {
    endpoint: Arc<Endpoint>,
    input: Mutex<mpsc::UnboundedReceiver<Option<Vec<u8>>>>,
    output: mpsc::UnboundedSender<Option<Vec<u8>>>,
    stream: Mutex<Option<String>>,
    closed: AtomicBool,
}

#[async_trait]
impl Connector for EndpointConnector {
    async fn connect(&self, input: &ConnectionRequest) -> Result<Arc<dyn Socket>> {
        if input.url != request().url || input.workspace_token != request().workspace_token {
            return Err(Error::Disconnected);
        }
        let (sender, receiver) = mpsc::unbounded_channel();
        *self.0.incoming.lock().await = Some(sender.clone());
        Ok(Arc::new(Connection {
            endpoint: self.0.clone(),
            input: Mutex::new(receiver),
            output: sender,
            stream: Mutex::new(None),
            closed: AtomicBool::new(false),
        }))
    }
}

impl Connection {
    fn deliver(&self, message: WorkspaceToRunner) {
        self.output
            .send(Some(codec::encode(&message).unwrap()))
            .unwrap();
    }
}

#[async_trait]
impl Socket for Connection {
    async fn send(&self, message: &RunnerToWorkspace) -> Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(Error::Disconnected);
        }
        let message: RunnerToWorkspace = codec::decode(&codec::encode(message)?).unwrap();
        let mut state = self.endpoint.state.lock().await;
        state.received.push(message.clone());
        match message {
            RunnerToWorkspace::RunnerHello(RunnerHello::Hello {
                stream_id,
                workspace_id,
                ..
            }) => {
                assert_eq!(workspace_id, "workspace");
                *self.stream.lock().await = Some(stream_id.clone());
                if state.welcome {
                    self.deliver(WorkspaceToRunner::RunnerWelcome(RunnerWelcome::Welcome {
                        protocol_version: RunnerProtocolVersion,
                        confirmed_through: *state.cursors.get(&stream_id).unwrap_or(&0),
                        stream_id,
                    }));
                }
            }
            RunnerToWorkspace::RunnerEventEnvelope(ref envelope) => {
                let RunnerEventEnvelope::Event {
                    stream_id,
                    event_number,
                    ..
                } = envelope;
                assert_eq!(
                    self.stream.lock().await.as_deref(),
                    Some(stream_id.as_str())
                );
                if state.drop_next {
                    state.drop_next = false;
                    return Ok(());
                }
                let through = *state.cursors.get(stream_id).unwrap_or(&0);
                if *event_number > through + 1 {
                    self.deliver(WorkspaceToRunner::RunnerResend(RunnerResend::Resend {
                        stream_id: stream_id.clone(),
                        from_event_number: through + 1,
                    }));
                    return Ok(());
                }
                if *event_number == through + 1 {
                    if state.refuse.contains(event_number) {
                        state.refusals.push(*event_number);
                    } else {
                        state.events.push(envelope.clone());
                    }
                    state.cursors.insert(stream_id.clone(), *event_number);
                }
                if state.confirm {
                    self.deliver(WorkspaceToRunner::RunnerConfirm(RunnerConfirm::Confirm {
                        stream_id: stream_id.clone(),
                        through_event_number: *state.cursors.get(stream_id).unwrap_or(&0),
                    }));
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn receive(&self) -> Result<Option<WorkspaceToRunner>> {
        match self.input.lock().await.recv().await.flatten() {
            Some(bytes) => Ok(Some(workspace_message(&bytes)?)),
            None => Ok(None),
        }
    }

    async fn close(&self) -> Result<()> {
        self.closed.store(true, Ordering::SeqCst);
        let _ = self.output.send(None);
        Ok(())
    }
}
