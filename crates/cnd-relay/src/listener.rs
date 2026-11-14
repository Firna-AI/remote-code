//! Private listener with safe ownership of systemd's inherited descriptor.

use async_trait::async_trait;
use listenfd::ListenFd;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, UnixListener};

use crate::error::{Error, ErrorResultExt, Result};

/// Bidirectional transport accepted by the relay.
pub trait Socket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Socket for T {}

/// Listening socket boundary.
#[cfg_attr(test, unimock::unimock(api = ListenerMock))]
#[async_trait]
pub trait Listener: Send + Sync {
    /// Port checked against the request's private hostname.
    fn port(&self) -> Result<u16>;
    /// Accept one connection from the sandbox.
    async fn accept(&self) -> Result<Box<dyn Socket>>;
}

/// Native listener, including Unix activation for integration environments.
pub enum NativeListener {
    /// A loopback TCP listener.
    Tcp(TcpListener),
    /// An inherited local Unix listener.
    Unix(UnixListener),
}

impl NativeListener {
    /// Use descriptor 3 only when systemd names this process and exactly one FD.
    pub async fn open() -> Result<Self> {
        let activated = std::env::var("LISTEN_FDS").ok().as_deref() == Some("1")
            && std::env::var("LISTEN_PID").ok().as_deref() == Some(&std::process::id().to_string());
        if activated {
            let mut descriptors = ListenFd::from_env();
            if let Ok(Some(socket)) = descriptors.take_tcp_listener(0) {
                if !socket.local_addr().internal()?.ip().is_loopback() {
                    return Err(Error::Activation);
                }
                socket.set_nonblocking(true).internal()?;
                return Ok(Self::Tcp(TcpListener::from_std(socket).internal()?));
            }
            if let Some(socket) = descriptors.take_unix_listener(0).internal()? {
                socket.set_nonblocking(true).internal()?;
                return Ok(Self::Unix(UnixListener::from_std(socket).internal()?));
            }
            return Err(Error::Activation);
        }
        Self::bind(7682).await
    }
    /// Bind a loopback listener. Port zero selects a free local port.
    pub async fn bind(port: u16) -> Result<Self> {
        Ok(Self::Tcp(
            TcpListener::bind(("127.0.0.1", port)).await.internal()?,
        ))
    }
}

#[async_trait]
impl Listener for NativeListener {
    fn port(&self) -> Result<u16> {
        match self {
            Self::Tcp(socket) => Ok(socket.local_addr().internal()?.port()),
            Self::Unix(_) => Ok(0),
        }
    }
    async fn accept(&self) -> Result<Box<dyn Socket>> {
        match self {
            Self::Tcp(socket) => loop {
                let (stream, peer) = socket.accept().await.internal()?;
                if peer.ip().is_loopback() {
                    return Ok(Box::new(stream));
                }
            },
            Self::Unix(socket) => Ok(Box::new(socket.accept().await.internal()?.0)),
        }
    }
}
