//! Injectable time for event dates and connection retries.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;

use crate::error::{Error, ErrorResultExt, Result};

/// The runner's clock and retry scheduler.
#[cfg_attr(test, unimock::unimock(api = ClockMock))]
#[async_trait]
pub trait Clock: Send + Sync {
    /// Unix milliseconds for an event or recovered turn.
    fn now(&self) -> Result<i64>;
    /// Wait one second before reconnecting.
    async fn reconnect_delay(&self);
}

/// System time and Tokio's cancellable scheduler.
pub struct SystemClock;

#[async_trait]
impl Clock for SystemClock {
    fn now(&self) -> Result<i64> {
        let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).internal()?;
        let millis = i64::try_from(elapsed.as_millis()).internal()?;
        if millis > 9_007_199_254_740_991 {
            return Err(Error::InvalidNumber);
        }
        Ok(millis)
    }

    async fn reconnect_delay(&self) {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
