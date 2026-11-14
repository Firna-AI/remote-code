//! Shared in-memory credentials and serialized filtered chat emission.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_files::RunnerFileResponse;
use tokio::sync;

use crate::emitter::EventEmitter;
use crate::error::{Error, Result};
use crate::reports::prepare::ReportFilter;

use super::fields;
use super::streaming::Sanitizer;

/// Credentials remain in memory for the process lifetime.
pub trait Credentials: ReportFilter {
    /// Register a newly accepted turn token before processing its command.
    fn add(&self, secret: String) -> Result<()>;
    /// Filter a complete event, including held streamed prefixes.
    fn events(&self, event: RunnerEvent) -> Result<Vec<RunnerEvent>>;
    /// Filter local helper diagnostics without logging private request bytes.
    fn text(&self, value: &str) -> Result<String>;
}

/// Shared filter used by reports, warnings, and the filtered event emitter.
#[derive(Default)]
pub struct CredentialFilter {
    state: Mutex<Sanitizer>,
}

impl Credentials for CredentialFilter {
    fn events(&self, event: RunnerEvent) -> Result<Vec<RunnerEvent>> {
        Ok(self
            .state
            .lock()
            .or(Err(Error::InvalidCommand))?
            .accept(event))
    }
    fn add(&self, secret: String) -> Result<()> {
        let mut state = self.state.lock().or(Err(Error::InvalidCommand))?;
        if !secret.is_empty() && !state.secrets.contains(&secret) {
            state.secrets.push(secret);
        }
        Ok(())
    }
    fn text(&self, value: &str) -> Result<String> {
        Ok(self
            .state
            .lock()
            .or(Err(Error::InvalidCommand))?
            .text(value))
    }
}

impl ReportFilter for CredentialFilter {
    fn file_report(&self, event: RunnerFileEvent) -> Result<RunnerFileEvent> {
        let state = self.state.lock().or(Err(Error::InvalidCommand))?;
        Ok(fields::file(event, &|s| state.text(s)))
    }
    fn report(&self, event: RunnerEvent) -> Result<RunnerEvent> {
        let state = self.state.lock().or(Err(Error::InvalidCommand))?;
        Ok(fields::clean(event, &|s| state.text(s)))
    }
    fn response(&self, response: RunnerFileResponse) -> Result<RunnerFileResponse> {
        let state = self.state.lock().or(Err(Error::InvalidCommand))?;
        Ok(fields::response(response, &|s| state.text(s)))
    }
}

/// Filters complete chat sources before the saving emitter applies byte limits.
pub struct FilteredEmitter {
    filter: Arc<dyn Credentials>,
    next: Arc<dyn EventEmitter>,
    queue: sync::Mutex<()>,
}

impl FilteredEmitter {
    /// Compose with the same filter supplied to every report owner.
    pub fn new(filter: Arc<dyn Credentials>, next: Arc<dyn EventEmitter>) -> Self {
        Self {
            filter,
            next,
            queue: sync::Mutex::new(()),
        }
    }
}

#[async_trait]
impl EventEmitter for FilteredEmitter {
    async fn persist(&self) -> Result<()> {
        self.next.persist().await
    }
    async fn emit(&self, events: Vec<RunnerEvent>, command: Option<String>) -> Result<()> {
        let _queue = self.queue.lock().await;
        let mut failure = None;
        for event in events {
            let safe = self.filter.events(event)?;
            if let Err(error) = self.next.emit(safe, command.clone()).await {
                failure.get_or_insert(error);
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
