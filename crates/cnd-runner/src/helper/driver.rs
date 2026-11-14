//! Correlate replies while events stream during pending requests.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use cnd_runner_interface::agents::AgentChoice;
use cnd_runner_interface::provider_events::ProviderEvent;
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput, HelperRequest};
use cnd_runner_interface::sdk_helper_options::{HelperOptions, ProviderInput};
use tokio::sync::{Mutex, oneshot};

use crate::error::{Error, Result};

use super::boundary::{Helper, HelperEvents, HelperPort};

type Reply = oneshot::Sender<Result<Option<HelperModelResult>>>;

#[derive(Default)]
struct Pending {
    replies: BTreeMap<String, Reply>,
    ended: bool,
}

/// One request multiplexer. The reader owns failure fan-out and late output.
pub struct HelperConnection {
    port: Arc<dyn HelperPort>,
    next: AtomicU64,
    pending: Arc<Mutex<Pending>>,
    closing: Arc<AtomicBool>,
    close_lock: Mutex<bool>,
}

impl HelperConnection {
    /// Attach a reader before any request can be written.
    pub fn new(port: Arc<dyn HelperPort>, output: Arc<dyn HelperEvents>) -> Self {
        let connection = Self {
            port: port.clone(),
            next: AtomicU64::new(0),
            pending: Arc::new(Mutex::new(Pending::default())),
            closing: Arc::new(AtomicBool::new(false)),
            close_lock: Mutex::new(false),
        };
        let pending = connection.pending.clone();
        let closing = connection.closing.clone();
        tokio::spawn(async move {
            loop {
                match port.read().await {
                    Ok(Some(HelperOutput::Response { request_id, result })) => {
                        if let Some(reply) = pending.lock().await.replies.remove(&request_id) {
                            let _ = reply.send(Ok(result));
                        }
                    }
                    Ok(Some(HelperOutput::Error {
                        request_id,
                        code,
                        message,
                    })) => {
                        if let Some(reply) = pending.lock().await.replies.remove(&request_id) {
                            let _ = reply.send(Err(Error::Agent { code, message }));
                        }
                    }
                    Ok(Some(message)) => {
                        output.output(message);
                    }
                    _ => break,
                }
            }
            {
                let mut pending = pending.lock().await;
                pending.ended = true;
                for (_, reply) in std::mem::take(&mut pending.replies) {
                    let _ = reply.send(Err(Error::HelperExited));
                }
            }
            if !closing.load(Ordering::Acquire) {
                output.output(HelperOutput::Event {
                    event: ProviderEvent::Failed {
                        code: "agent_exited".into(),
                        message: "The SDK helper process ended.".into(),
                    },
                });
            }
            let _ = port.terminate().await;
        });
        connection
    }

    async fn request(
        &self,
        make: impl FnOnce(String) -> HelperRequest + Send,
    ) -> Result<Option<HelperModelResult>> {
        let id = (self.next.fetch_add(1, Ordering::Relaxed) + 1).to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.ended {
                return Err(Error::HelperExited);
            }
            pending.replies.insert(id.clone(), sender);
        }
        if let Err(error) = self.port.write(make(id.clone())).await {
            self.pending.lock().await.replies.remove(&id);
            return Err(error);
        }
        receiver.await.or(Err(Error::HelperExited))?
    }

    /// Warm-up request exits without creating any agent.
    pub async fn warm(&self) -> Result<()> {
        self.request(|request_id| HelperRequest::Warm { request_id })
            .await?;
        self.port.exited().await
    }
}

#[async_trait]
impl Helper for HelperConnection {
    async fn start(&self, options: HelperOptions) -> Result<()> {
        self.request(|request_id| HelperRequest::Start {
            request_id,
            options: Box::new(options),
        })
        .await?;
        Ok(())
    }
    async fn send(&self, input: ProviderInput) -> Result<()> {
        self.request(|request_id| HelperRequest::Send {
            request_id,
            input: Box::new(input),
        })
        .await?;
        Ok(())
    }
    async fn model(&self, choice: AgentChoice) -> Result<HelperModelResult> {
        self.request(|request_id| HelperRequest::Model { request_id, choice })
            .await?
            .ok_or(Error::HelperResponse)
    }
    async fn interrupt(&self) -> Result<()> {
        self.request(|request_id| HelperRequest::Interrupt { request_id })
            .await?;
        Ok(())
    }
    async fn close(&self) -> Result<()> {
        self.closing.store(true, Ordering::Release);
        let mut closed = self.close_lock.lock().await;
        if *closed {
            return Ok(());
        }
        let response = tokio::time::timeout(
            Duration::from_secs(10),
            self.request(|request_id| HelperRequest::Close { request_id }),
        )
        .await;
        let result = self.port.terminate().await;
        let exited = self.port.exited().await;
        *closed = true;
        result?;
        exited?;
        match response {
            Ok(Err(Error::Agent { code, message })) => Err(Error::Agent { code, message }),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
#[path = "_tests_/driver_tests.rs"]
mod driver_tests;
