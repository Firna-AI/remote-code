//! WebSocket upgrades share the HTTP gates and forward frames in both directions.

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::{
    accept_hdr_async, connect_async,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        protocol::{CloseFrame, frame::coding::CloseCode},
    },
};

use crate::support::fixture::Fixture;
use crate::support::upgrade::CaptureHeaders;
use crate::support::wire::{TestResult, head, reply};

#[tokio::test]
async fn applies_private_host_and_target_rules_to_upgrades() -> TestResult {
    let relay = Fixture::new().await?;
    for (headers, status) in [
        (
            format!(
                "Host: localhost:{}\r\nX-Conductive-Preview-Port: 1234\r\n",
                relay.port
            ),
            403,
        ),
        (
            format!(
                "Host: evil.example:{}\r\nX-Conductive-Preview-Port: 1234\r\n",
                relay.port
            ),
            403,
        ),
        (relay.headers(relay.port), 400),
        (format!("Host: sandbox-{}.on.boat.dev\r\n", relay.port), 400),
    ] {
        let result = relay
            .send(&format!(
                "{headers}Connection: Upgrade\r\nUpgrade: websocket\r\n"
            ))
            .await?;
        assert!(
            result.starts_with(&format!("HTTP/1.1 {status}")),
            "{result}"
        );
        assert!(result.contains("x-conductive-relay: 1\r\n"));
    }
    Ok(())
}

#[tokio::test]
async fn relays_buffered_frames_binary_frames_and_close_with_filtered_local_headers() -> TestResult
{
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (stream, _) = target.accept().await?;
        let (capture, captured) = oneshot::channel();
        let mut socket = accept_hdr_async(stream, CaptureHeaders(capture)).await?;
        let incoming = captured.await?;
        socket.send(Message::Text("from server".into())).await?;
        let frame = socket.next().await.ok_or("missing binary frame")??;
        assert_eq!(frame, Message::Binary(vec![1, 2, 3].into()));
        socket.send(frame).await?;
        let closed = socket.next().await.ok_or("missing close frame")??;
        assert_eq!(
            closed,
            Message::Close(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "finished".into()
            }))
        );
        socket.flush().await?;
        TestResult::Ok(incoming)
    });
    let relay = Fixture::new().await?;
    let mut request =
        format!("ws://127.0.0.1:{}/live?room=one", relay.port).into_client_request()?;
    for (name, value) in [
        ("host", format!("sandbox-{}.on.boat.dev", relay.port)),
        ("x-conductive-preview-port", port.to_string()),
        ("cookie", "_port_auth=secret; theme=dark".into()),
        ("origin", "http://localhost:5173".into()),
        ("forwarded", "host=private.example".into()),
        ("x-forwarded-host", "private.example".into()),
        ("x-keep", "kept".into()),
    ] {
        request.headers_mut().insert(name, value.parse()?);
    }
    let (mut client, handshake) = connect_async(request).await?;
    assert_eq!(handshake.status(), 101);
    assert_eq!(handshake.headers()["x-conductive-relay"], "1");
    assert_eq!(
        client.next().await.ok_or("missing greeting")??,
        Message::Text("from server".into())
    );
    client.send(Message::Binary(vec![1, 2, 3].into())).await?;
    assert_eq!(
        client.next().await.ok_or("missing echo")??,
        Message::Binary(vec![1, 2, 3].into())
    );
    client
        .close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: "finished".into(),
        }))
        .await?;
    assert_eq!(
        client.next().await.ok_or("missing close echo")??,
        Message::Close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: "finished".into()
        }))
    );
    let incoming = served.await??;
    for expected in [
        "/live?room=one".to_string(),
        format!("\"host\": \"localhost:{port}\""),
        "\"cookie\": \"theme=dark\"".into(),
        "\"origin\": \"http://localhost:5173\"".into(),
        "\"x-keep\": \"kept\"".into(),
        "\"upgrade\": \"websocket\"".into(),
    ] {
        assert!(incoming.contains(&expected), "{incoming}");
    }
    for removed in ["_port_auth", "forwarded", "x-conductive-preview-port"] {
        assert!(!incoming.contains(removed), "{incoming}");
    }
    Ok(())
}

#[tokio::test]
async fn marks_refused_upgrades_and_gateway_errors_after_target_stops() -> TestResult {
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        reply(
            &mut stream,
            "403 Forbidden",
            "X-Conductive-Relay: untrusted\r\n",
            "App refused the upgrade.",
        )
        .await
    });
    let relay = Fixture::new().await?;
    let headers = format!(
        "{}Connection: Upgrade\r\nUpgrade: websocket\r\n",
        relay.headers(port)
    );
    let refused = relay.send(&headers).await?;
    assert!(refused.starts_with("HTTP/1.1 403"));
    assert!(refused.ends_with("App refused the upgrade."));
    assert!(refused.contains("x-conductive-relay: 1\r\n"));
    served.await??;
    let stopped = relay.send(&headers).await?;
    assert!(stopped.starts_with("HTTP/1.1 502"));
    assert!(stopped.ends_with("The server did not answer."));
    assert!(stopped.contains("x-conductive-relay: 1\r\n"));
    Ok(())
}
