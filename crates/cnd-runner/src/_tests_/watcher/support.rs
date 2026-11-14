//! Mock watch and report boundaries with Tokio's paused scheduling clock.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use futures_util::future::BoxFuture;
use tokio::sync::{Mutex, mpsc};
use unimock::{MockFn, Unimock, matching};

use crate::error::Result;
use crate::ports::reporter::{PortReports, PortReportsMock};
use crate::reports::files::{FileReports, FileReportsMock};
use crate::watcher::boundary::{RepositoryWatch, WatchDriver, WatchDriverMock};
use crate::watcher::service::ReportWatchService;

#[unimock::unimock(api = EventsMock)]
trait Events: Send + Sync {
    fn next(&self) -> BoxFuture<'static, Result<()>>;
    fn closed(&self);
}

struct Watch(Unimock);
#[async_trait]
impl RepositoryWatch for Watch {
    async fn changed(&self) -> Result<()> {
        Events::next(&self.0).await
    }
    async fn close(&self) {
        Events::closed(&self.0);
    }
}

struct Driver(Unimock);
#[async_trait]
impl WatchDriver for Driver {
    async fn open(&self, root: PathBuf) -> Result<Arc<dyn RepositoryWatch>> {
        WatchDriver::open(&self.0, root).await
    }
    async fn exists(&self, marker: PathBuf) -> bool {
        WatchDriver::exists(&self.0, marker).await
    }
    async fn delay(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}

pub(super) struct Fixture {
    pub service: ReportWatchService,
    pub events: mpsc::UnboundedSender<()>,
    pub marker: Arc<AtomicBool>,
    pub opens: Arc<AtomicUsize>,
    pub checks: Arc<AtomicUsize>,
    pub closes: Arc<AtomicUsize>,
    pub files: Arc<AtomicUsize>,
    pub ports: Arc<AtomicUsize>,
}

impl Fixture {
    pub(super) fn new(marker_exists: bool, expect_reports: bool) -> Self {
        let (events, receiver) = mpsc::unbounded_channel();
        let receiver = Arc::new(Mutex::new(receiver));
        let closes = Arc::new(AtomicUsize::new(0));
        let count = closes.clone();
        let watcher: Arc<dyn RepositoryWatch> = Arc::new(Watch(Unimock::new((
            EventsMock::next
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    let receiver = receiver.clone();
                    Box::pin(async move {
                        receiver.lock().await.recv().await.unwrap();
                        Ok(())
                    })
                })),
            EventsMock::closed
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    count.fetch_add(1, Ordering::SeqCst);
                })),
        ))));
        let marker = Arc::new(AtomicBool::new(marker_exists));
        let checks = Arc::new(AtomicUsize::new(0));
        let opens = Arc::new(AtomicUsize::new(0));
        let marker_value = marker.clone();
        let open_count = opens.clone();
        let check_count = checks.clone();
        let driver: Arc<dyn WatchDriver> = Arc::new(Driver(Unimock::new((
            WatchDriverMock::open
                .each_call(matching!((path) if path == &PathBuf::from("/repo")))
                .answers_arc(Arc::new(move |_, _| {
                    open_count.fetch_add(1, Ordering::SeqCst);
                    Ok(watcher.clone())
                })),
            WatchDriverMock::exists
                .each_call(matching!((path) if path == &PathBuf::from("/run/restore-ended")))
                .answers_arc(Arc::new(move |_, _| {
                    check_count.fetch_add(1, Ordering::SeqCst);
                    marker_value.load(Ordering::SeqCst)
                })),
        ))));
        let files = Arc::new(AtomicUsize::new(0));
        let file_count = files.clone();
        let file_reports: Arc<dyn FileReports> = if expect_reports {
            Arc::new(Unimock::new(
                FileReportsMock::refresh
                    .each_call(matching!(false, None, None))
                    .answers_arc(Arc::new(move |_, _, _, _| {
                        file_count.fetch_add(1, Ordering::SeqCst);
                        Box::pin(async { Ok(()) })
                    })),
            ))
        } else {
            Arc::new(Unimock::new(()))
        };
        let ports = Arc::new(AtomicUsize::new(0));
        let port_count = ports.clone();
        let port_reports: Arc<dyn PortReports> = if expect_reports {
            Arc::new(Unimock::new(
                PortReportsMock::refresh
                    .each_call(matching!(false, None))
                    .answers_arc(Arc::new(move |_, _, _| {
                        port_count.fetch_add(1, Ordering::SeqCst);
                        Box::pin(async {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            Ok(())
                        })
                    })),
            ))
        } else {
            Arc::new(Unimock::new(()))
        };
        Self {
            service: ReportWatchService::new(
                driver,
                file_reports,
                Some(port_reports),
                "/repo".into(),
                "/run/restore-ended".into(),
            ),
            events,
            marker,
            opens,
            checks,
            closes,
            files,
            ports,
        }
    }
}

pub(super) fn count(value: &AtomicUsize) -> usize {
    value.load(Ordering::SeqCst)
}

pub(super) async fn settle() {
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
}

pub(super) async fn advance(milliseconds: u64) {
    tokio::time::advance(Duration::from_millis(milliseconds)).await;
    settle().await;
}
