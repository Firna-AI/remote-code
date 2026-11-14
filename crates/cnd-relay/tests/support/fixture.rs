//! A private relay instance for each integration test.

use crate::support::wire::TestResult;
use cnd_relay::connect::LocalConnector;
use cnd_relay::listener::{Listener, NativeListener};
use cnd_relay::proxy::RelayProxy;
use cnd_relay::server::{RelayServer, Server};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_util::task::AbortOnDropHandle;

pub(crate) struct Fixture {
    pub(crate) port: u16,
    _server: AbortOnDropHandle<()>,
}
impl Fixture {
    pub(crate) async fn new() -> TestResult<Self> {
        let listener = NativeListener::bind(0).await?;
        let address = match &listener {
            NativeListener::Tcp(socket) => socket.local_addr()?.ip(),
            NativeListener::Unix(_) => return Err("expected a TCP listener".into()),
        };
        assert_eq!(address.to_string(), "127.0.0.1");
        let port = listener.port()?;
        let server: Arc<dyn Server> = Arc::new(RelayServer {
            listener: Arc::new(listener),
            proxy: Arc::new(RelayProxy {
                connector: Arc::new(LocalConnector),
            }),
        });
        Ok(Self {
            port,
            _server: AbortOnDropHandle::new(tokio::spawn(async move {
                let _ = server.run().await;
            })),
        })
    }
    pub(crate) fn headers(&self, target: u16) -> String {
        format!(
            "Host: sandbox-{}.on.boat.dev\r\nX-Conductive-Preview-Port: {target}\r\n",
            self.port
        )
    }
    pub(crate) async fn stream(
        &self,
        method: &str,
        path: &str,
        headers: &str,
    ) -> TestResult<TcpStream> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).await?;
        stream
            .write_all(format!("{method} {path} HTTP/1.1\r\n{headers}\r\n").as_bytes())
            .await?;
        Ok(stream)
    }
    pub(crate) async fn send(&self, headers: &str) -> TestResult<String> {
        let mut stream = self.stream("GET", "/", headers).await?;
        let mut text = String::new();
        stream.read_to_string(&mut text).await?;
        Ok(text)
    }
}
