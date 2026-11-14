//! Out-of-band cancellation for pending starts, requests, and repository scans.

use tokio::sync::watch;

use crate::error::{Error, Result};
use crate::repository::git::Cancellation;

#[derive(Clone)]
pub(super) struct Control {
    stop: watch::Sender<bool>,
    pub(super) repository: Cancellation,
}

impl Default for Control {
    fn default() -> Self {
        Self {
            stop: watch::channel(false).0,
            repository: Cancellation::default(),
        }
    }
}

impl Control {
    pub(super) fn stop(&self) {
        self.stop.send_replace(true);
        self.repository.cancel();
    }
    pub(super) fn stopped(&self) -> bool {
        *self.stop.borrow()
    }
    pub(super) async fn canceled(&self) {
        let mut stop = self.stop.subscribe();
        let _ = stop.wait_for(|value| *value).await;
    }
    pub(super) async fn run<T>(&self, future: impl Future<Output = Result<T>>) -> Result<T> {
        tokio::select! { biased; _ = self.canceled() => Err(Error::Canceled), result = future => result }
    }
}
