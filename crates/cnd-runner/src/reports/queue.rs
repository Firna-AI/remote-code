//! Reserve scan order synchronously, including calls whose result is not yet polled.

use std::future::Future;
use std::sync::Mutex;

use futures_util::future::BoxFuture;
use tokio::sync::{oneshot, watch};

use crate::error::{Error, Result};

#[derive(Default)]
pub(crate) struct SerialQueue {
    tail: Mutex<Option<watch::Receiver<bool>>>,
}

impl SerialQueue {
    pub(crate) fn run(
        &self,
        operation: impl Future<Output = Result<()>> + Send + 'static,
    ) -> BoxFuture<'static, Result<()>> {
        let (finished, receiver) = watch::channel(false);
        let previous = match self.tail.lock() {
            Ok(mut tail) => tail.replace(receiver),
            Err(_) => return Box::pin(async { Err(Error::InvalidCommand) }),
        };
        let (send, result) = oneshot::channel();
        tokio::spawn(async move {
            if let Some(mut previous) = previous {
                let _ = previous.wait_for(|ready| *ready).await;
            }
            let outcome = operation.await;
            finished.send_replace(true);
            let _ = send.send(outcome);
        });
        Box::pin(async move { result.await.unwrap_or(Err(Error::Disconnected)) })
    }
}
