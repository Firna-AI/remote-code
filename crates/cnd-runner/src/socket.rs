//! TLS WebSocket transport with independent send and receive halves.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::runner_handshake::{RunnerToWorkspace, WorkspaceToRunner};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{AUTHORIZATION, HeaderValue};
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Message, frame::coding::CloseCode};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::config::ConnectionRequest;
use crate::error::{Error, ErrorResultExt, Result};
use crate::json::codec;
use crate::json::commands::workspace_message;

/// One established runner connection, consumed through a trait object.
#[cfg_attr(test, unimock::unimock(api = SocketMock))]
#[async_trait]
pub trait Socket: Send + Sync {
    /// Send one complete compact JSON message.
    async fn send(&self, message: &RunnerToWorkspace) -> Result<()>;
    /// Receive a typed frame. None means a closed connection.
    async fn receive(&self) -> Result<Option<WorkspaceToRunner>>;
    /// Close the connection. Disconnected event state remains saved.
    async fn close(&self) -> Result<()>;
}

/// Creates an authenticated outbound socket.
#[cfg_attr(test, unimock::unimock(api = ConnectorMock))]
#[async_trait]
pub trait Connector: Send + Sync {
    /// Connect using the workspace bearer token without logging it.
    async fn connect(&self, request: &ConnectionRequest) -> Result<Arc<dyn Socket>>;
}

/// Rustls client with public WebPKI roots. It needs no OpenSSL library.
pub struct WebSocketConnector;

type Stream = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct WebSocket {
    sender: Mutex<SplitSink<Stream, Message>>,
    receiver: Mutex<SplitStream<Stream>>,
}

#[async_trait]
impl Connector for WebSocketConnector {
    async fn connect(&self, request: &ConnectionRequest) -> Result<Arc<dyn Socket>> {
        let mut url = Url::parse(&request.url).internal()?;
        if !matches!(url.scheme(), "https" | "wss") {
            return Err(Error::TlsRequired);
        }
        if url.scheme() == "https" && url.set_scheme("wss").is_err() {
            return Err(Error::TlsRequired);
        }
        let mut upgrade = url.as_str().into_client_request().internal()?;
        let mut token =
            HeaderValue::from_str(&format!("Bearer {}", request.workspace_token)).internal()?;
        token.set_sensitive(true);
        upgrade.headers_mut().insert(AUTHORIZATION, token);
        let (socket, _) = tokio_tungstenite::connect_async(upgrade).await.internal()?;
        let (sender, receiver) = socket.split();
        Ok(Arc::new(WebSocket {
            sender: Mutex::new(sender),
            receiver: Mutex::new(receiver),
        }))
    }
}

#[async_trait]
impl Socket for WebSocket {
    async fn send(&self, message: &RunnerToWorkspace) -> Result<()> {
        let bytes = codec::encode(message)?;
        let text = String::from_utf8(bytes).internal()?;
        self.sender
            .lock()
            .await
            .send(Message::Text(text.into()))
            .await
            .internal()
    }

    async fn receive(&self) -> Result<Option<WorkspaceToRunner>> {
        let mut receiver = self.receiver.lock().await;
        while let Some(frame) = receiver.next().await {
            match frame.internal()? {
                Message::Text(text) => return self.parse(text.as_bytes()).await,
                Message::Binary(bytes) => return self.parse(&bytes).await,
                Message::Close(_) => return Ok(None),
                Message::Ping(_) => self.sender.lock().await.flush().await.internal()?,
                _ => {}
            }
        }
        Ok(None)
    }

    async fn close(&self) -> Result<()> {
        self.sender.lock().await.close().await.internal()
    }
}

impl WebSocket {
    async fn parse(&self, bytes: &[u8]) -> Result<Option<WorkspaceToRunner>> {
        match workspace_message(bytes) {
            Ok(message) => Ok(Some(message)),
            Err(error) => {
                let frame = CloseFrame {
                    code: CloseCode::Protocol,
                    reason: "Invalid runner message".into(),
                };
                let _ = self
                    .sender
                    .lock()
                    .await
                    .send(Message::Close(Some(frame)))
                    .await;
                Err(error)
            }
        }
    }
}
