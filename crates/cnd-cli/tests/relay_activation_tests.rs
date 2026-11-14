//! The shipped command consumes systemd's inherited listening descriptor.

use std::error::Error;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, UnixStream};
use tokio::process::Command;

#[tokio::test]
async fn serves_requests_on_the_descriptor_inherited_from_systemd()
-> Result<(), Box<dyn Error + Send + Sync>> {
    let root = tempfile::tempdir()?;
    let path = root.path().join("relay.sock");
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(stream.read_u8().await?);
        }
        let incoming = String::from_utf8_lossy(&bytes).into_owned();
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\nactivated",
            )
            .await?;
        Ok::<_, std::io::Error>(incoming)
    });
    let mut child = Command::new("systemd-socket-activate")
        .arg(format!("--listen={}", path.display()))
        .args([env!("CARGO_BIN_EXE_conductive"), "relay"])
        .env_remove("LISTEN_FDS")
        .env_remove("LISTEN_PID")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stderr = child.stderr.take().ok_or("missing activation stderr")?;
    let mut reader = BufReader::new(stderr);
    let mut ready = String::new();
    reader.read_line(&mut ready).await?;
    assert!(ready.contains("Listening on"), "{ready}");
    let mut client = UnixStream::connect(path).await?;
    client.write_all(format!("GET /activated?value=1 HTTP/1.1\r\nHost: sandbox-0.on.boat.dev\r\nX-Conductive-Preview-Port: {port}\r\n\r\n").as_bytes()).await?;
    let mut response = String::new();
    client.read_to_string(&mut response).await?;
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("x-conductive-relay: 1\r\n"));
    assert!(response.ends_with("activated"));
    let incoming = served.await??;
    assert!(incoming.starts_with("GET /activated?value=1 HTTP/1.1\r\n"));
    assert!(incoming.contains(&format!("host: localhost:{port}\r\n")));
    child.kill().await?;
    child.wait().await?;
    Ok(())
}
