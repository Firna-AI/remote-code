//! Connect only to loopback or addresses assigned to this sandbox.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use async_trait::async_trait;
use tokio::net::TcpStream;

use crate::error::{Error, ErrorResultExt, Result};

/// Target connection boundary. The request supplies only the port.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Try each local address before consuming any request body.
    async fn connect(&self, port: u16) -> Result<TcpStream>;
}

/// Native sandbox connections. No request can supply an address.
pub struct LocalConnector;

#[async_trait]
impl Connector for LocalConnector {
    async fn connect(&self, port: u16) -> Result<TcpStream> {
        let addresses = [
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
        ]
        .into_iter()
        .chain(
            if_addrs::get_if_addrs()
                .internal()?
                .into_iter()
                .filter(|a| !a.is_loopback())
                .map(|a| a.ip()),
        );
        for address in addresses {
            if let Ok(stream) = TcpStream::connect((address, port)).await {
                return Ok(stream);
            }
        }
        Err(Error::Unavailable)
    }
}
