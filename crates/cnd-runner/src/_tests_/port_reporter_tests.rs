//! Two successful scans, independent failures, complete labels, and shutdown suppression.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use cnd_runner_interface::ports::{ListeningPort, RunnerPortsUpdated};
use cnd_runner_interface::runner::RunnerEvent;
use unimock::{MockFn, Unimock, matching};

use crate::emitter::{EventEmitter, EventEmitterMock};
use crate::error::Error;
use crate::ports::reporter::{PortReporter, PortReports, PortScanner, PortScannerMock};
use crate::reports::prepare::UnfilteredReports;

fn server(port: u64) -> ListeningPort {
    ListeningPort {
        port,
        name: Some("vite dev".into()),
        folder: None,
    }
}

type Reports = Arc<Mutex<Vec<(Vec<ListeningPort>, Option<String>)>>>;
struct Fixture {
    source: Arc<Mutex<Option<Vec<ListeningPort>>>>,
    reports: Reports,
    reporter: Arc<dyn PortReports>,
}
impl Fixture {
    fn new() -> Self {
        let source = Arc::new(Mutex::new(Some(vec![])));
        let reports = Arc::new(Mutex::new(vec![]));
        let read = source.clone();
        let write = reports.clone();
        let scanner: Arc<dyn PortScanner> = Arc::new(Unimock::new(
            PortScannerMock::scan
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    read.lock().unwrap().clone().ok_or(Error::Disconnected)
                })),
        ));
        let emitter: Arc<dyn EventEmitter> = Arc::new(Unimock::new(
            EventEmitterMock::emit
                .each_call(matching!(_, _))
                .answers_arc(Arc::new(move |_, events, receipt| {
                    for event in events {
                        let RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated {
                            ports,
                        }) = event
                        else {
                            panic!("unexpected event");
                        };
                        write.lock().unwrap().push((ports, receipt.clone()));
                    }
                    Ok(())
                })),
        ));
        let reporter = Arc::new(PortReporter::new(
            scanner,
            emitter,
            Arc::new(UnfilteredReports),
        ));
        Self {
            source,
            reports,
            reporter,
        }
    }
}

#[tokio::test]
async fn keeps_two_successful_scan_stability_across_failures_and_transient_restarts() {
    let h = Fixture::new();
    h.reporter.refresh(true, None).await.unwrap();
    *h.source.lock().unwrap() = Some(vec![server(3000)]);
    h.reporter.refresh(false, None).await.unwrap();
    assert_eq!(h.reports.lock().unwrap().len(), 1);
    *h.source.lock().unwrap() = None;
    h.reporter.refresh(false, None).await.unwrap();
    *h.source.lock().unwrap() = Some(vec![server(3000)]);
    h.reporter.refresh(false, None).await.unwrap();
    assert_eq!(h.reports.lock().unwrap().last().unwrap().0, [server(3000)]);
    *h.source.lock().unwrap() = Some(vec![]);
    h.reporter.refresh(false, None).await.unwrap();
    *h.source.lock().unwrap() = Some(vec![server(3000)]);
    h.reporter.refresh(false, None).await.unwrap();
    assert_eq!(h.reports.lock().unwrap().len(), 2);
    *h.source.lock().unwrap() = Some(vec![]);
    h.reporter.refresh(false, None).await.unwrap();
    h.reporter.refresh(false, None).await.unwrap();
    assert!(h.reports.lock().unwrap().last().unwrap().0.is_empty());
}

#[tokio::test]
async fn full_reports_keep_complete_labels_and_only_the_first_64_sorted_unique_ports() {
    let h = Fixture::new();
    let mut ports: Vec<_> = (3001..=3070).rev().map(server).collect();
    ports.push(server(3001));
    ports.last_mut().unwrap().name = Some("x".repeat(600));
    *h.source.lock().unwrap() = Some(ports);
    h.reporter.refresh(true, None).await.unwrap();
    assert!(h.reports.lock().unwrap()[0].0.is_empty());
    h.reporter.refresh(false, None).await.unwrap();
    h.reporter
        .refresh(true, Some("repair".into()))
        .await
        .unwrap();
    let reports = h.reports.lock().unwrap();
    let (ports, receipt) = reports.last().unwrap();
    assert_eq!(
        ports.iter().map(|port| port.port).collect::<Vec<_>>(),
        (3001..=3064).collect::<Vec<_>>()
    );
    assert_eq!(ports[0].name.as_deref(), Some("x".repeat(600).as_str()));
    assert_eq!(receipt.as_deref(), Some("repair"));
}

#[tokio::test]
async fn close_suppresses_queued_reports_and_later_refreshes() {
    let h = Fixture::new();
    h.reporter.refresh(true, None).await.unwrap();
    let queued = h.reporter.refresh(true, Some("closing".into()));
    h.reporter.close().await;
    queued.await.unwrap();
    h.reporter.refresh(true, None).await.unwrap();
    assert_eq!(h.reports.lock().unwrap().len(), 1);
}

#[unimock::unimock(api = ScanJobMock)]
trait ScanJob: Send + Sync {
    fn start(
        &self,
    ) -> futures_util::future::BoxFuture<'static, crate::error::Result<Vec<ListeningPort>>>;
}

struct HeldScanner(Unimock);
#[async_trait::async_trait]
impl PortScanner for HeldScanner {
    async fn scan(&self) -> crate::error::Result<Vec<ListeningPort>> {
        ScanJob::start(&self.0).await
    }
}

#[tokio::test]
async fn close_waits_for_a_held_final_scan_and_suppresses_its_report() {
    let arrived = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let started = arrived.clone();
    let held = release.clone();
    let scanner: Arc<dyn PortScanner> = Arc::new(HeldScanner(Unimock::new(
        ScanJobMock::start
            .each_call(matching!())
            .answers_arc(Arc::new(move |_| {
                let started = started.clone();
                let held = held.clone();
                Box::pin(async move {
                    started.notify_one();
                    held.notified().await;
                    Ok(vec![server(3000)])
                })
            })),
    )));
    let reporter: Arc<dyn PortReports> = Arc::new(PortReporter::new(
        scanner,
        Arc::new(Unimock::new(())),
        Arc::new(UnfilteredReports),
    ));
    let scanning = reporter.refresh(true, None);
    arrived.notified().await;
    let mut closing = Box::pin(reporter.close());
    assert!(futures_util::poll!(&mut closing).is_pending());
    release.notify_one();
    scanning.await.unwrap();
    closing.await;
    reporter.refresh(true, None).await.unwrap();
}
