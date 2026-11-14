//! A failed context preparation warns and preserves the runner startup path.

use std::sync::Arc;

use unimock::{MockFn, Unimock, matching};

use crate::reports::files::{FileReporter, FileReports};
use crate::reports::prepare::UnfilteredReports;
use crate::repository::error::Error;
use crate::repository::service::RepositoryMock;
use crate::state::records::FileRevisions;

#[tokio::test]
async fn failed_context_preparation_does_not_block_startup_or_emit_a_report() {
    let files: Arc<dyn FileReports> = Arc::new(FileReporter::new(
        Arc::new(Unimock::new(
            RepositoryMock::prepare_context
                .some_call(matching!())
                .returns(Err(Error::Unavailable)),
        )),
        "main".into(),
        Arc::new(Unimock::new(())),
        Arc::new(UnfilteredReports),
        FileRevisions::default(),
    ));
    assert!(files.start().await.is_ok());
}
