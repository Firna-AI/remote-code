//! Literal HTTP wire readers for local integration servers.

use std::error::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub(crate) type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

pub(crate) async fn head(stream: &mut (impl AsyncRead + Unpin)) -> TestResult<String> {
    let mut bytes = Vec::new();
    loop {
        bytes.push(stream.read_u8().await?);
        if bytes.ends_with(b"\r\n\r\n") {
            return Ok(String::from_utf8(bytes)?);
        }
    }
}

pub(crate) async fn reply(
    stream: &mut TcpStream,
    status: &str,
    headers: &str,
    body: &str,
) -> TestResult {
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len()).as_bytes()).await?;
    Ok(())
}
