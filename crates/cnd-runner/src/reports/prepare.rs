//! Complete-source filter boundaries run before report splitting or private budgets.

use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_files::RunnerFileResponse;

use crate::error::Result;

/// The turn owner supplies the credential filter shared with agent output.
pub trait ReportFilter: Send + Sync {
    /// Filter one complete captured file report without changing operational paths.
    fn file_report(&self, event: RunnerFileEvent) -> Result<RunnerFileEvent>;
    /// Filter a complete retained report or port list before saving it.
    fn report(&self, event: RunnerEvent) -> Result<RunnerEvent>;
    /// Filter displayed file text without changing its request identity or real path.
    fn response(&self, response: RunnerFileResponse) -> Result<RunnerFileResponse>;
}

/// Identity preparation for compositions with no known credentials.
pub struct UnfilteredReports;

impl ReportFilter for UnfilteredReports {
    fn file_report(&self, event: RunnerFileEvent) -> Result<RunnerFileEvent> {
        Ok(event)
    }
    fn report(&self, event: RunnerEvent) -> Result<RunnerEvent> {
        Ok(event)
    }
    fn response(&self, response: RunnerFileResponse) -> Result<RunnerFileResponse> {
        Ok(response)
    }
}
