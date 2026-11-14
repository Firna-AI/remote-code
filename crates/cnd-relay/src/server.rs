//! Private HTTP/1 server with per-connection cancellation.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use hyper::{StatusCode, server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use tokio_util::sync::CancellationToken;

use crate::error::Result;
use crate::listener::Listener;
use crate::proxy::{Proxy, failure};

/// Long-running relay boundary.
#[async_trait]
pub trait Server: Send + Sync {
    /// Serve until the service is stopped.
    async fn run(&self) -> Result<()>;
}

/// Native listener and request policy composition.
pub struct RelayServer {
    /// Private listening socket, possibly inherited from systemd.
    pub listener: Arc<dyn Listener>,
    /// HTTP forwarding policy.
    pub proxy: Arc<dyn Proxy>,
}

#[async_trait]
impl Server for RelayServer {
    async fn run(&self) -> Result<()> {
        let port = self.listener.port()?;
        loop {
            let socket = match self.listener.accept().await {
                Ok(socket) => socket,
                Err(error) => {
                    tracing::warn!(%error, "preview relay could not accept a connection");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let proxy = self.proxy.clone();
            tokio::spawn(async move {
                let closed = CancellationToken::new();
                let _guard = closed.clone().drop_guard();
                let service = service_fn(move |request| {
                    let proxy = proxy.clone();
                    let closed = closed.clone();
                    async move {
                        let response = tokio::select! {
                            response = proxy.request(request, port) => response,
                            () = closed.cancelled() => failure(StatusCode::BAD_GATEWAY),
                        };
                        Ok::<_, Infallible>(response)
                    }
                });
                if let Err(error) = http1::Builder::new()
                    .serve_connection(TokioIo::new(socket), service)
                    .with_upgrades()
                    .await
                {
                    tracing::debug!(%error, "preview client closed");
                }
            });
        }
    }
}

#[cfg(test)]
#[path = "_tests_/server_tests.rs"]
mod server_tests;
