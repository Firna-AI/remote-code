//! Complete report filtering precedes splitting and preserves operational paths.

use std::sync::Arc;

use cnd_runner_interface::file_tree::{FILE_EVENT_MAX_BYTES, RunnerFileEvent};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_files::RunnerFileResponse;

use crate::error::Result;
use crate::json::codec;
use crate::reports::files::FileReportKind;
use crate::reports::prepare::ReportFilter;

use super::support::{Fixture, snapshot};

struct ExpandingFilter;
impl ReportFilter for ExpandingFilter {
    fn file_report(&self, mut event: RunnerFileEvent) -> Result<RunnerFileEvent> {
        if let RunnerFileEvent::FilesSnapshot { tree } = &mut event {
            for entry in &mut tree.entries {
                entry.display_path = Some(entry.path.replace('x', "[redacted]"));
            }
        }
        Ok(event)
    }
    fn report(&self, event: RunnerEvent) -> Result<RunnerEvent> {
        Ok(event)
    }
    fn response(&self, response: RunnerFileResponse) -> Result<RunnerFileResponse> {
        Ok(response)
    }
}

#[tokio::test]
async fn expanded_filtered_paths_split_before_emission_and_keep_request_paths() {
    let current = snapshot(
        (0..6)
            .map(|index| format!("{}{index}", "x".repeat(9000)))
            .collect(),
    );
    let h = Fixture::with_filter(current.clone(), Arc::new(ExpandingFilter));
    h.files
        .refresh(true, Some(FileReportKind::Tree), Some("filtered".into()))
        .await
        .unwrap();
    let events = h.take();
    assert_eq!(events.len(), 3);
    let mut paths = vec![];
    for (event, _) in &events {
        assert!(codec::encode(event).unwrap().len() <= FILE_EVENT_MAX_BYTES as usize);
        let RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) = event else {
            panic!("expected filtered tree part");
        };
        assert_eq!(tree.part.part_count, 3);
        for entry in &tree.entries {
            assert_eq!(
                entry.display_path.as_deref(),
                Some(entry.path.replace('x', "[redacted]").as_str())
            );
            paths.push(entry.path.clone());
        }
    }
    assert_eq!(
        paths,
        current
            .entries
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        events
            .iter()
            .filter(|(_, receipt)| receipt.is_some())
            .count(),
        1
    );
    assert_eq!(events.last().unwrap().1.as_deref(), Some("filtered"));
}
