//! Streaming order and disconnect propagation on real TCP connections.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::support::fixture::Fixture;
use crate::support::wire::{TestResult, head};

#[tokio::test]
async fn sends_events_before_upstream_ends_and_closes_upstream_on_client_disconnect() -> TestResult
{
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\nd\r\ndata: first\n\n\r\n").await?;
        let mut byte = [0];
        TestResult::Ok(stream.read(&mut byte).await?)
    });
    let relay = Fixture::new().await?;
    {
        let mut client = relay.stream("GET", "/events", &relay.headers(port)).await?;
        let headers = head(&mut client).await?;
        assert!(headers.starts_with("HTTP/1.1 200"));
        assert!(headers.contains("content-type: text/event-stream"));
        let mut frame = [0; 18];
        client.read_exact(&mut frame).await?;
        assert_eq!(
            u8::from_str_radix(std::str::from_utf8(&frame[..1])?, 16)?,
            13
        );
        assert_eq!(&frame[1..], b"\r\ndata: first\n\n\r\n");
    }
    assert_eq!(served.await??, 0);
    Ok(())
}

#[tokio::test]
async fn streams_upload_before_request_ends_and_cancels_it_on_client_disconnect() -> TestResult {
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let (received, body) = oneshot::channel();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
            .await?;
        let mut first = [0; 18];
        stream.read_exact(&mut first).await?;
        let _ = received.send(first);
        let mut byte = [0];
        TestResult::Ok(stream.read(&mut byte).await?)
    });
    let relay = Fixture::new().await?;
    {
        let mut client = relay
            .stream(
                "POST",
                "/upload",
                &format!("{}Content-Length: 1000\r\n", relay.headers(port)),
            )
            .await?;
        client.write_all(b"upload in progress").await?;
        let response = head(&mut client).await?;
        assert!(response.starts_with("HTTP/1.1 200"));
        assert_eq!(&body.await?, b"upload in progress");
    }
    assert_eq!(served.await??, 0);
    Ok(())
}

#[tokio::test]
async fn breaks_the_client_stream_when_upstream_ends_an_incomplete_response() -> TestResult {
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let (end, ending) = oneshot::channel();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\nfirst chunk")
            .await?;
        ending.await?;
        TestResult::Ok(())
    });
    let relay = Fixture::new().await?;
    let mut client = relay.stream("GET", "/broken", &relay.headers(port)).await?;
    assert!(head(&mut client).await?.starts_with("HTTP/1.1 200"));
    let mut chunk = [0; 11];
    client.read_exact(&mut chunk).await?;
    assert_eq!(&chunk, b"first chunk");
    end.send(()).map_err(|_| "upstream ended too early")?;
    let mut rest = Vec::new();
    client.read_to_end(&mut rest).await?;
    assert_eq!(rest, b"");
    served.await??;
    Ok(())
}

#[tokio::test]
async fn closes_upstream_when_client_disconnects_before_response_headers() -> TestResult {
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let (ready, request_ready) = oneshot::channel();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        let _ = ready.send(());
        let mut byte = [0];
        TestResult::Ok(stream.read(&mut byte).await?)
    });
    let relay = Fixture::new().await?;
    {
        let _client = relay
            .stream("GET", "/waiting", &relay.headers(port))
            .await?;
        request_ready.await?;
    }
    assert_eq!(served.await??, 0);
    Ok(())
}
