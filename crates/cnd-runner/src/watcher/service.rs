//! Watch lifecycle, 100 ms debounce, restore polling, and independent port scheduling.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::future::BoxFuture;
use tokio::sync::{Mutex, watch};
use tokio::task::{JoinHandle, JoinSet};

use crate::error::Result;
use crate::ports::reporter::PortReports;
use crate::reports::files::FileReports;

use super::boundary::{RepositoryWatch, WatchDriver};

/// Lifecycle boundary supplied to the report command handler.
#[async_trait]
pub trait ReportWatches: Send + Sync {
    /// Start once. Reconnects keep the same timers and watch.
    async fn start(&self) -> Result<()>;
    /// Stop schedules and await outstanding driver tasks.
    async fn close(&self);
}

#[cfg(test)]
#[path = "../_tests_/watcher/mod.rs"]
mod watcher_tests;

/// Repository watcher with restore repair and independent port timer.
pub struct ReportWatchService {
    driver: Arc<dyn WatchDriver>,
    files: Arc<dyn FileReports>,
    ports: Option<Arc<dyn PortReports>>,
    root: PathBuf,
    marker: PathBuf,
    stopped: watch::Sender<bool>,
    jobs: Mutex<Option<Vec<JoinHandle<()>>>>,
}

impl ReportWatchService {
    /// Compose watches before connection. The driver is the only host-watch boundary.
    pub fn new(
        driver: Arc<dyn WatchDriver>,
        files: Arc<dyn FileReports>,
        ports: Option<Arc<dyn PortReports>>,
        root: PathBuf,
        marker: PathBuf,
    ) -> Self {
        Self {
            driver,
            files,
            ports,
            root,
            marker,
            stopped: watch::channel(false).0,
            jobs: Mutex::new(None),
        }
    }
}

fn delay(driver: Arc<dyn WatchDriver>, duration: Duration) -> BoxFuture<'static, ()> {
    Box::pin(async move {
        driver.delay(duration).await;
    })
}

async fn monitor(
    driver: Arc<dyn WatchDriver>,
    files: Arc<dyn FileReports>,
    mut watcher: Arc<dyn RepositoryWatch>,
    root: PathBuf,
    marker: PathBuf,
    mut stopped: watch::Receiver<bool>,
    mut restore_pending: bool,
) {
    let mut restore_tick = delay(driver.clone(), Duration::from_secs(1));
    let mut debounce = delay(driver.clone(), Duration::from_millis(100));
    let mut debouncing = false;
    let mut scans = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = async { let _ = stopped.wait_for(|value| *value).await; } => break,
            _ = &mut restore_tick, if restore_pending => {
                restore_tick = delay(driver.clone(), Duration::from_secs(1));
                if driver.exists(marker.clone()).await {
                    restore_pending = false;
                    watcher.close().await;
                    match driver.open(root.clone()).await {
                        Ok(new_watch) => watcher = new_watch,
                        Err(_) => { tracing::warn!("The repository watcher is unavailable."); break; },
                    }
                    scans.spawn(files.refresh(false, None, None));
                }
            },
            _ = &mut debounce, if debouncing => {
                debouncing = false;
                scans.spawn(files.refresh(false, None, None));
            },
            changed = watcher.changed() => {
                if changed.is_err() { tracing::warn!("The repository watcher is unavailable."); break; }
                debounce = delay(driver.clone(), Duration::from_millis(100));
                debouncing = true;
            },
            finished = scans.join_next(), if !scans.is_empty() => {
                if !matches!(finished, Some(Ok(Ok(())))) { tracing::warn!("The file lists could not update."); }
            },
        }
    }
    watcher.close().await;
    while scans.join_next().await.is_some() {}
}

#[async_trait]
impl ReportWatches for ReportWatchService {
    async fn start(&self) -> Result<()> {
        let mut jobs = self.jobs.lock().await;
        if jobs.is_some() || *self.stopped.borrow() {
            return Ok(());
        }
        let watcher = self.driver.open(self.root.clone()).await?;
        let pending = !self.driver.exists(self.marker.clone()).await;
        let mut tasks = vec![tokio::spawn(monitor(
            self.driver.clone(),
            self.files.clone(),
            watcher,
            self.root.clone(),
            self.marker.clone(),
            self.stopped.subscribe(),
            pending,
        ))];
        if let Some(ports) = &self.ports {
            let ports = ports.clone();
            let driver = self.driver.clone();
            let mut stopped = self.stopped.subscribe();
            tasks.push(tokio::spawn(async move {
                let mut scans = JoinSet::new();
                let mut tick = delay(driver.clone(), Duration::from_secs(2));
                loop {
                    tokio::select! {
                        biased;
                        _ = async { let _ = stopped.wait_for(|value| *value).await; } => break,
                        _ = &mut tick => {
                            tick = delay(driver.clone(), Duration::from_secs(2));
                            scans.spawn(ports.refresh(false, None));
                        },
                        finished = scans.join_next(), if !scans.is_empty() => {
                            if !matches!(finished, Some(Ok(Ok(())))) { tracing::warn!("The listening ports could not update."); }
                        },
                    }
                }
                while scans.join_next().await.is_some() {}
            }));
        }
        *jobs = Some(tasks);
        Ok(())
    }

    async fn close(&self) {
        self.stopped.send_replace(true);
        let jobs = self.jobs.lock().await.take().unwrap_or_default();
        for job in jobs {
            let _ = job.await;
        }
    }
}
