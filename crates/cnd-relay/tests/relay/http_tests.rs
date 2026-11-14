//! HTTP validation, local addressing, and header filtering on real sockets.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::support::fixture::Fixture;
use crate::support::wire::{TestResult, head, reply};

#[tokio::test]
async fn accepts_only_private_host_and_one_valid_nonlooping_target() -> TestResult {
    let relay = Fixture::new().await?;
    for host in [
        format!("localhost:{}", relay.port),
        format!("127.0.0.1:{}", relay.port),
        format!("evil.example:{}", relay.port),
        format!("sandbox-{}.on.boat.dev.evil.example", relay.port),
        format!("sandbox-{}.on.boat.dev:80", relay.port),
        "sandbox-7681.on.boat.dev".into(),
    ] {
        let result = relay
            .send(&format!(
                "Host: {host}\r\nX-Conductive-Preview-Port: 1234\r\n"
            ))
            .await?;
        assert!(result.starts_with("HTTP/1.1 403"), "{host}: {result}");
        assert!(result.contains("x-conductive-relay: 1\r\n"));
        assert!(result.contains("content-type: text/plain; charset=utf-8\r\n"));
        assert!(result.ends_with("The preview is not available."));
    }
    for port in [
        None,
        Some("".into()),
        Some("abc".into()),
        Some("1.5".into()),
        Some("+1234".into()),
        Some("1234, 1235".into()),
        Some("0".into()),
        Some("-1".into()),
        Some("65536".into()),
        Some("99999999999999999999".into()),
        Some(relay.port.to_string()),
        Some("7682".into()),
        Some("1234\r\nX-Conductive-Preview-Port: 1235".into()),
    ] {
        let target = port
            .map(|p| format!("X-Conductive-Preview-Port: {p}\r\n"))
            .unwrap_or_default();
        let result = relay
            .send(&format!(
                "Host: sandbox-{}.on.boat.dev\r\n{target}",
                relay.port
            ))
            .await?;
        assert!(result.starts_with("HTTP/1.1 400"), "{result}");
        assert!(result.contains("x-conductive-relay: 1\r\n"));
        assert!(result.ends_with("The preview is not available."));
    }
    Ok(())
}

#[tokio::test]
async fn forwards_method_path_body_and_filters_proxy_headers_and_provider_cookie() -> TestResult {
    let target = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        let incoming = head(&mut stream).await?;
        let mut body = [0; 22];
        stream.read_exact(&mut body).await?;
        reply(&mut stream, "200 OK", "Set-Cookie: one=1\r\nSet-Cookie: two=2\r\nX-Conductive-Relay: untrusted\r\nX-Response-Hop: secret\r\nConnection: X-Response-Hop\r\n", "ready").await?;
        TestResult::Ok((incoming.to_lowercase(), body))
    });
    let relay = Fixture::new().await?;
    let mut stream = relay.stream("POST", "/submit/a%20b?one=1&two=2", &format!("{}Cookie: theme=dark; _port_auth=secret; session=kept; _port_auth=again\r\nOrigin: http://localhost:5173\r\nForwarded: host=private.example\r\nX-Forwarded-Host: private.example\r\nX-Forwarded-Proto: https\r\nX-Forwarded-For: 1.2.3.4\r\nConnection: close, X-Custom-Hop\r\nX-Custom-Hop: remove\r\nKeep-Alive: timeout=5\r\nProxy-Authorization: remove\r\nProxy-Authenticate: remove\r\nTE: trailers\r\nX-Keep: unchanged\r\nContent-Type: text/plain\r\nContent-Length: 22\r\n", relay.headers(port))).await?;
    stream.write_all(b"first line\nsecond line").await?;
    let mut result = String::new();
    stream.read_to_string(&mut result).await?;
    assert!(result.starts_with("HTTP/1.1 200"), "{result}");
    let (incoming, body) = served.await??;
    assert!(incoming.starts_with("post /submit/a%20b?one=1&two=2 http/1.1\r\n"));
    for expected in [
        format!("host: localhost:{port}\r\n"),
        "cookie: theme=dark; session=kept\r\n".into(),
        "origin: http://localhost:5173\r\n".into(),
        "x-keep: unchanged\r\n".into(),
        "content-type: text/plain\r\n".into(),
        "content-length: 22\r\n".into(),
        "connection: close\r\n".into(),
    ] {
        assert!(incoming.contains(&expected), "{expected}: {incoming}");
    }
    for removed in [
        "x-forwarded-",
        "forwarded:",
        "_port_auth",
        "x-custom-hop",
        "keep-alive",
        "proxy-",
        "te:",
        "x-conductive-preview-port",
    ] {
        assert!(!incoming.contains(removed), "{incoming}");
    }
    assert_eq!(&body, b"first line\nsecond line");
    assert!(result.starts_with("HTTP/1.1 200"));
    assert!(result.ends_with("ready"));
    assert!(result.contains("x-conductive-relay: 1\r\n"));
    assert!(result.contains("set-cookie: one=1\r\nset-cookie: two=2\r\n"));
    assert!(!result.contains("untrusted"));
    assert!(!result.contains("x-response-hop"));
    Ok(())
}

#[tokio::test]
async fn keeps_post_body_after_ipv4_refusal_and_connects_to_ipv6() -> TestResult {
    let target = TcpListener::bind(("::1", 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        let headers = head(&mut stream).await?;
        let mut body = [0; 9];
        stream.read_exact(&mut body).await?;
        reply(&mut stream, "200 OK", "", "ipv6").await?;
        TestResult::Ok((headers, body))
    });
    let relay = Fixture::new().await?;
    let mut stream = relay
        .stream(
            "POST",
            "/",
            &format!("{}Content-Length: 9\r\n", relay.headers(port)),
        )
        .await?;
    stream.write_all(b"kept body").await?;
    let mut result = String::new();
    stream.read_to_string(&mut result).await?;
    assert!(result.starts_with("HTTP/1.1 200"), "{result}");
    let (headers, body) = served.await??;
    assert_eq!(&body, b"kept body");
    assert!(headers.contains(&format!("host: localhost:{port}")));
    assert!(result.ends_with("ipv6"));
    Ok(())
}

#[tokio::test]
async fn tries_assigned_sandbox_address_after_both_loopback_addresses() -> TestResult {
    let address = if_addrs::get_if_addrs()?
        .into_iter()
        .find(|a| !a.is_loopback() && a.ip().is_ipv4())
        .ok_or("A nonloopback sandbox address is required")?
        .ip();
    let target = TcpListener::bind((address, 0)).await?;
    let port = target.local_addr()?.port();
    let served = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await?;
        head(&mut stream).await?;
        reply(&mut stream, "200 OK", "", "later address").await
    });
    let relay = Fixture::new().await?;
    let result = relay.send(&relay.headers(port)).await?;
    assert!(result.starts_with("HTTP/1.1 200"));
    assert!(result.ends_with("later address"));
    served.await??;
    Ok(())
}

#[tokio::test]
async fn marks_gateway_errors_when_no_local_address_accepts() -> TestResult {
    let port = {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        listener.local_addr()?.port()
    };
    let relay = Fixture::new().await?;
    let result = relay.send(&relay.headers(port)).await?;
    assert!(result.starts_with("HTTP/1.1 502"));
    assert!(result.contains("x-conductive-relay: 1\r\n"));
    assert!(result.ends_with("The server did not answer."));
    Ok(())
}
