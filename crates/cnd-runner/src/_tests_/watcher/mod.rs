//! Debounce and restore schedules use virtual time and mock host boundaries.

#![allow(clippy::unwrap_used)]

mod support;

use std::sync::atomic::Ordering;

use crate::watcher::service::ReportWatches;

use support::{Fixture, advance, count, settle};

#[tokio::test(start_paused = true)]
async fn debounce_resets_and_port_ticks_keep_their_schedule_after_scan_completion() {
    let h = Fixture::new(true, true);
    h.service.start().await.unwrap();
    h.service.start().await.unwrap();
    settle().await;
    h.events.send(()).unwrap();
    settle().await;
    advance(99).await;
    assert_eq!(count(&h.files), 0);
    h.events.send(()).unwrap();
    settle().await;
    advance(99).await;
    assert_eq!(count(&h.files), 0);
    advance(1).await;
    assert_eq!(count(&h.files), 1);
    advance(1800).await;
    assert_eq!(count(&h.ports), 0);
    advance(1).await;
    assert_eq!(count(&h.ports), 1);
    advance(500).await;
    advance(1499).await;
    assert_eq!(count(&h.ports), 1);
    advance(1).await;
    assert_eq!(count(&h.ports), 2);
    assert_eq!(count(&h.opens), 1);
    assert_eq!(count(&h.checks), 1);
    h.service.close().await;
    advance(10_000).await;
    assert_eq!(count(&h.ports), 2);
    assert_eq!(count(&h.closes), 1);
}

#[tokio::test(start_paused = true)]
async fn restore_polls_missing_marker_each_second_and_reopens_and_scans_once() {
    let h = Fixture::new(false, true);
    h.service.start().await.unwrap();
    settle().await;
    advance(999).await;
    assert_eq!(count(&h.checks), 1);
    advance(1).await;
    assert_eq!(count(&h.checks), 2);
    assert_eq!(count(&h.files), 0);
    h.marker.store(true, Ordering::SeqCst);
    advance(999).await;
    assert_eq!(count(&h.opens), 1);
    advance(1).await;
    assert_eq!(count(&h.opens), 2);
    assert_eq!(count(&h.files), 1);
    assert_eq!(count(&h.closes), 1);
    advance(1000).await;
    assert_eq!(count(&h.checks), 3);
    assert_eq!(count(&h.opens), 2);
    assert_eq!(count(&h.files), 1);
    h.service.close().await;
    assert_eq!(count(&h.closes), 2);
}

#[tokio::test(start_paused = true)]
async fn shutdown_prevents_marker_repair_and_debounce_and_cannot_restart() {
    let h = Fixture::new(false, false);
    h.service.start().await.unwrap();
    h.events.send(()).unwrap();
    settle().await;
    advance(99).await;
    h.service.close().await;
    h.marker.store(true, Ordering::SeqCst);
    advance(10_000).await;
    h.service.start().await.unwrap();
    assert_eq!(count(&h.opens), 1);
    assert_eq!(count(&h.files), 0);
    assert_eq!(count(&h.ports), 0);
    assert_eq!(count(&h.checks), 1);
    assert_eq!(count(&h.closes), 1);
}
