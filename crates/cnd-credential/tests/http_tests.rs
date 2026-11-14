//! Real HTTPS request shape, redirect refusal, and credential confinement.

use std::error::Error;
use std::sync::Arc;

use cnd_credential::error;
use cnd_credential::http::NativeHttp;
use cnd_credential::ports::{Context, Http};
use rcgen::{CertifiedKey, generate_simple_self_signed};
use reqwest::Certificate;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::{
    TlsAcceptor,
    rustls::{ServerConfig, pki_types::PrivatePkcs8KeyDer},
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

#[tokio::test]
async fn posts_without_body_or_content_type_with_only_current_turn_and_refuses_redirects()
-> TestResult {
    let CertifiedKey { cert, signing_key } = generate_simple_self_signed(vec!["localhost".into()])?;
    let client: Arc<dyn Http> = Arc::new(NativeHttp::with_roots(vec![Certificate::from_der(
        cert.der(),
    )?])?);
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.der().clone()],
            PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let served = tokio::spawn(async move {
        let mut requests = Vec::new();
        for status in ["200 OK", "302 Found"] {
            let (socket, _) = listener.accept().await?;
            let mut stream = acceptor.accept(socket).await?;
            let mut bytes = Vec::new();
            while !bytes.ends_with(b"\r\n\r\n") {
                bytes.push(stream.read_u8().await?);
            }
            requests.push(String::from_utf8(bytes)?);
            stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 18\r\nConnection: close\r\nLocation: /elsewhere\r\nContent-Type: application/json\r\n\r\n{{\"token\":\"fresh!\"}}").as_bytes()).await?;
            stream.shutdown().await?;
        }
        TestResult::Ok(requests)
    });
    let reply = client
        .credential(Context {
            origin: format!("https://localhost:{port}"),
            token: "workspace-token".into(),
            turn: "current-turn".into(),
        })
        .await?;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, br#"{"token":"fresh!"}"#);
    let refused = client
        .credential(Context {
            origin: format!("https://localhost:{port}"),
            token: "workspace-token".into(),
            turn: "".into(),
        })
        .await;
    assert_eq!(
        refused.err().map(|error| error.to_string()).as_deref(),
        Some("GitHub access failed. Try again.")
    );
    let requests = served.await??;
    for request in &requests {
        let request = request.to_lowercase();
        assert!(request.starts_with("post /v1/git/credential http/1.1\r\n"));
        assert!(request.contains("authorization: bearer workspace-token\r\n"));
        assert!(!request.contains("content-type:"));
        assert!(!request.contains("transfer-encoding:"));
        assert!(request.ends_with("\r\n\r\n"));
    }
    assert!(requests[0].contains("x-conductive-turn-id: current-turn\r\n"));
    assert!(!requests[1].contains("x-conductive-turn-id:"));
    Ok(())
}

#[tokio::test]
async fn rejects_invalid_machine_origins_before_sending_credentials() -> TestResult {
    let client: Arc<dyn Http> = Arc::new(NativeHttp::new()?);
    for origin in [
        "http://localhost",
        "https://user:pass@localhost",
        "https://localhost/path",
        "https://localhost?query=1",
        "https://localhost#fragment",
    ] {
        let result = client
            .credential(Context {
                origin: origin.into(),
                token: "must-stay-private".into(),
                turn: "turn".into(),
            })
            .await;
        assert!(matches!(result, Err(error::Error::Invalid)));
    }
    Ok(())
}
