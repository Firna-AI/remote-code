//! Calling refresh reserves order before a consumer polls its completion.

use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;

use crate::reports::files::FileReportKind;

use super::support::{Fixture, snapshot};

#[tokio::test]
async fn report_calls_keep_order_even_when_the_last_completion_is_awaited_first() {
    let h = Fixture::new(snapshot(vec![]));
    let first = h
        .files
        .refresh(true, Some(FileReportKind::Tree), Some("first".into()));
    let second = h
        .files
        .refresh(true, Some(FileReportKind::Tree), Some("second".into()));
    second.await.unwrap();
    first.await.unwrap();
    let events = h.take();
    assert_eq!(
        events
            .iter()
            .map(|(_, receipt)| receipt.as_deref())
            .collect::<Vec<_>>(),
        [Some("first"), Some("second")]
    );
    assert!(
        matches!(&events[0].0, RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) if tree.part.revision == 1)
    );
    assert!(
        matches!(&events[1].0, RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) if tree.part.revision == 2)
    );
}
