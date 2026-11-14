//! Two-successful-scan stability, sorted bounded lists, and independent scan serialization.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use cnd_runner_interface::ports::{ListeningPort, PORT_REPORT_MAX_PORTS, RunnerPortsUpdated};
use cnd_runner_interface::runner::RunnerEvent;
use futures_util::future::BoxFuture;
use tokio::sync::Mutex;

use crate::emitter::EventEmitter;
use crate::error::Result;
use crate::reports::prepare::ReportFilter;
use crate::reports::queue::SerialQueue;

/// A replaceable scan never reads host state in unit tests.
#[cfg_attr(test, unimock::unimock(api = PortScannerMock))]
#[async_trait]
pub trait PortScanner: Send + Sync {
    /// Capture current listeners, or fail without changing reporter state.
    async fn scan(&self) -> Result<Vec<ListeningPort>>;
}

/// Connection and timer owner share this queue without blocking repository work.
#[cfg_attr(test, unimock::unimock(api = PortReportsMock))]
#[async_trait]
pub trait PortReports: Send + Sync {
    /// Scan again. A full refresh sends even an empty unchanged stable list.
    fn refresh(&self, full: bool, command_id: Option<String>) -> BoxFuture<'static, Result<()>>;
    /// Stop new reports and wait for an active scan to settle.
    async fn close(&self);
}

#[derive(Default)]
struct History {
    previous: BTreeMap<u64, ListeningPort>,
    stable: BTreeMap<u64, ListeningPort>,
    last: Vec<ListeningPort>,
}

/// Stable full reports retain listeners across transient restarts and scan failures.
#[derive(Clone)]
pub struct PortReporter {
    scanner: Arc<dyn PortScanner>,
    emitter: Arc<dyn EventEmitter>,
    filter: Arc<dyn ReportFilter>,
    stopped: Arc<AtomicBool>,
    history: Arc<Mutex<History>>,
    queue: Arc<SerialQueue>,
}

impl PortReporter {
    /// Compose a reporter. The watch owner schedules refresh every two seconds.
    pub fn new(
        scanner: Arc<dyn PortScanner>,
        emitter: Arc<dyn EventEmitter>,
        filter: Arc<dyn ReportFilter>,
    ) -> Self {
        Self {
            scanner,
            emitter,
            filter,
            stopped: Arc::new(AtomicBool::new(false)),
            history: Arc::new(Mutex::new(History::default())),
            queue: Arc::new(SerialQueue::default()),
        }
    }
}

impl PortReporter {
    async fn scan(&self, full: bool, command_id: Option<String>) -> Result<()> {
        let mut history = self.history.lock().await;
        if self.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        let scanned = self.scanner.scan().await;
        if self.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        match scanned {
            Ok(scanned) => {
                let current: BTreeMap<_, _> =
                    scanned.into_iter().map(|port| (port.port, port)).collect();
                for (number, port) in &current {
                    if history.previous.contains_key(number) {
                        history.stable.insert(*number, port.clone());
                    }
                }
                let previous = history.previous.clone();
                history.stable.retain(|number, _| {
                    current.contains_key(number) || previous.contains_key(number)
                });
                history.previous = current;
            }
            Err(_) => tracing::warn!("The listening ports could not be read."),
        }
        let ports: Vec<_> = history
            .stable
            .values()
            .take(PORT_REPORT_MAX_PORTS as usize)
            .cloned()
            .collect();
        if full || ports != history.last {
            let event = self.filter.report(RunnerEvent::RunnerPortsUpdated(
                RunnerPortsUpdated::PortsUpdated {
                    ports: ports.clone(),
                },
            ))?;
            self.emitter.emit(vec![event], command_id).await?;
            history.last = ports;
        }
        Ok(())
    }
}

#[async_trait]
impl PortReports for PortReporter {
    fn refresh(&self, full: bool, command_id: Option<String>) -> BoxFuture<'static, Result<()>> {
        let reporter = self.clone();
        self.queue
            .run(async move { reporter.scan(full, command_id).await })
    }

    async fn close(&self) {
        self.stopped.store(true, Ordering::Release);
        let _ = self.queue.run(async { Ok(()) }).await;
    }
}

#[cfg(test)]
#[path = "../_tests_/port_reporter_tests.rs"]
mod port_reporter_tests;
