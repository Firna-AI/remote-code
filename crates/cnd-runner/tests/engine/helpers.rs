//! Controlled agent starts, replies, and cleanup without a real SDK.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner::error::{Error, Result};
use cnd_runner::helper::boundary::{Helper, HelperEvents, HelperFactory};
use cnd_runner_interface::agents::AgentChoice;
use cnd_runner_interface::provider_events::ProviderEvent;
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput};
use cnd_runner_interface::sdk_helper_options::{HelperOptions, ProviderInput};
use tokio::sync::{Notify, watch};

pub(super) struct Gate {
    pub entered: Notify,
    held: AtomicBool,
    release: watch::Sender<bool>,
}
impl Default for Gate {
    fn default() -> Self {
        Self {
            entered: Notify::new(),
            held: AtomicBool::new(false),
            release: watch::channel(false).0,
        }
    }
}
impl Gate {
    pub(super) fn hold(&self) {
        self.release.send_replace(false);
        self.held.store(true, Ordering::SeqCst);
    }
    pub(super) fn release(&self) {
        self.held.store(false, Ordering::SeqCst);
        self.release.send_replace(true);
    }
    pub(super) async fn wait(&self) {
        if self.held.load(Ordering::SeqCst) {
            self.entered.notify_one();
            let _ = self.release.subscribe().wait_for(|value| *value).await;
        }
    }
}

pub(super) struct Process {
    pub output: Arc<dyn HelperEvents>,
    pub options: Mutex<Option<HelperOptions>>,
    pub inputs: Mutex<Vec<ProviderInput>>,
    pub models: Mutex<Vec<AgentChoice>>,
    pub model_gate: Gate,
    pub deferred: AtomicBool,
    pub fail_send: AtomicBool,
    pub closed: AtomicBool,
    pub interrupts: AtomicUsize,
    pub start_gate: Arc<Gate>,
    pub send_gate: Gate,
    pub close_gate: Gate,
}
impl Process {
    pub(super) fn event(&self, event: ProviderEvent) {
        self.output.output(HelperOutput::Event { event });
    }
    pub(super) fn result(&self, ids: &[&str]) {
        self.event(ProviderEvent::Result {
            state: cnd_runner_interface::provider_events::ProviderResultState::Finished,
            user_message_ids: ids.iter().map(|s| (*s).to_owned()).collect(),
            end_reason: None,
        });
    }
}

#[async_trait]
impl Helper for Process {
    async fn start(&self, options: HelperOptions) -> Result<()> {
        *self.options.lock().or(Err(Error::InvalidCommand))? = Some(options);
        self.start_gate.wait().await;
        self.event(ProviderEvent::Conversation {
            id: "conversation-1".into(),
        });
        Ok(())
    }
    async fn send(&self, input: ProviderInput) -> Result<()> {
        self.send_gate.wait().await;
        if self.fail_send.swap(false, Ordering::SeqCst) {
            return Err(Error::Agent {
                code: "request_failed".into(),
                message: "Request failed.".into(),
            });
        }
        self.inputs
            .lock()
            .or(Err(Error::InvalidCommand))?
            .push(input);
        Ok(())
    }
    async fn model(&self, choice: AgentChoice) -> Result<HelperModelResult> {
        self.model_gate.wait().await;
        self.models
            .lock()
            .or(Err(Error::InvalidCommand))?
            .push(choice);
        Ok(if self.deferred.load(Ordering::SeqCst) {
            HelperModelResult::Deferred
        } else {
            HelperModelResult::Applied
        })
    }
    async fn interrupt(&self) -> Result<()> {
        self.interrupts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn close(&self) -> Result<()> {
        self.close_gate.wait().await;
        self.closed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Default)]
pub(super) struct Helpers {
    pub processes: Mutex<Vec<Arc<Process>>>,
    pub start_gate: Arc<Gate>,
    pub opened: Notify,
}
impl HelperFactory for Helpers {
    fn open(&self, output: Arc<dyn HelperEvents>) -> Result<Arc<dyn Helper>> {
        let mut processes = self.processes.lock().or(Err(Error::InvalidCommand))?;
        let process = Arc::new(Process {
            output,
            options: Mutex::new(None),
            inputs: Mutex::new(vec![]),
            models: Mutex::new(vec![]),
            model_gate: Gate::default(),
            deferred: AtomicBool::new(false),
            fail_send: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            interrupts: AtomicUsize::new(0),
            start_gate: if processes.is_empty() {
                self.start_gate.clone()
            } else {
                Arc::new(Gate::default())
            },
            send_gate: Gate::default(),
            close_gate: Gate::default(),
        });
        processes.push(process.clone());
        self.opened.notify_one();
        Ok(process)
    }
}
