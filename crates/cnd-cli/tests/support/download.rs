//! Hold a large HTTP body until the test releases its final chunk.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub(crate) async fn large_body(
    listener: TcpListener,
    sent: oneshot::Sender<()>,
    finish: oneshot::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (mut stream, _) = listener.accept().await?;
    let mut request = Vec::new();
    while !request.ends_with(b"\r\n\r\n") {
        request.push(stream.read_u8().await?);
    }
    stream
        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n")
        .await?;
    stream.write_all(&vec![42; 512 * 1024]).await?;
    assert!(sent.send(()).is_ok());
    finish.await?;
    stream.write_all(&vec![42; 512 * 1024]).await?;
    Ok(())
}
