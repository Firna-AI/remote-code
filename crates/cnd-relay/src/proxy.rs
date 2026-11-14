//! Stream HTTP requests and tunnel upgraded connections without buffering bodies.

use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use http_body_util::Full;
use hyper::{
    Request, Response, StatusCode,
    body::Incoming,
    header::{CONNECTION, HeaderValue, UPGRADE},
};
use hyper_util::rt::TokioIo;
use tokio::io::copy_bidirectional;
use tokio_util::task::AbortOnDropHandle;

use crate::body::RelayBody;
use crate::connect::Connector;
use crate::error::{ErrorResultExt, Result};
use crate::headers;

/// Preview request boundary shared by each accepted connection.
#[cfg_attr(test, unimock::unimock(api = ProxyMock))]
#[async_trait]
pub trait Proxy: Send + Sync {
    /// Validate and forward a preview request.
    async fn request(&self, request: Request<Incoming>, relay_port: u16) -> Response<RelayBody>;
}

/// Native HTTP proxy with a sandbox-only target connector.
pub struct RelayProxy {
    /// Only this boundary can choose the destination address.
    pub connector: Arc<dyn Connector>,
}

#[async_trait]
impl Proxy for RelayProxy {
    async fn request(&self, request: Request<Incoming>, relay_port: u16) -> Response<RelayBody> {
        let port = match headers::target(request.headers(), relay_port) {
            Ok(port) => port,
            Err(status) => return failure(status),
        };
        match self.forward(request, port).await {
            Ok(response) => response,
            Err(_) => failure(StatusCode::BAD_GATEWAY),
        }
    }
}

impl RelayProxy {
    async fn forward(
        &self,
        mut request: Request<Incoming>,
        port: u16,
    ) -> Result<Response<RelayBody>> {
        let socket = self.connector.connect(port).await?;
        let upgrade = request.headers().get(UPGRADE).cloned().filter(|_| {
            request.headers().get_all(CONNECTION).iter().any(|v| {
                v.to_str().is_ok_and(|v| {
                    v.split(',')
                        .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
                })
            })
        });
        let downstream = upgrade.as_ref().map(|_| hyper::upgrade::on(&mut request));
        *request.headers_mut() = headers::request(request.headers(), port);
        if let Some(value) = upgrade {
            request
                .headers_mut()
                .insert(CONNECTION, HeaderValue::from_static("Upgrade"));
            request.headers_mut().insert(UPGRADE, value);
        } else {
            request
                .headers_mut()
                .insert(CONNECTION, HeaderValue::from_static("close"));
        }
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(socket))
            .await
            .internal()?;
        let driver = AbortOnDropHandle::new(tokio::spawn(async move {
            if let Err(error) = connection.with_upgrades().await {
                tracing::debug!(%error, "preview upstream closed");
            }
        }));
        let mut response = sender.send_request(request).await.internal()?;
        let mut filtered = headers::response(response.headers());
        if response.status() == StatusCode::SWITCHING_PROTOCOLS
            && let Some(downstream) = downstream
        {
            filtered.insert(CONNECTION, HeaderValue::from_static("Upgrade"));
            filtered.insert(
                UPGRADE,
                response
                    .headers()
                    .get(UPGRADE)
                    .cloned()
                    .unwrap_or(HeaderValue::from_static("websocket")),
            );
            let upstream = hyper::upgrade::on(&mut response);
            tokio::spawn(async move {
                let _driver = driver;
                if let (Ok(client), Ok(peer)) = tokio::join!(downstream, upstream) {
                    let _ = copy_bidirectional(&mut TokioIo::new(client), &mut TokioIo::new(peer))
                        .await;
                }
            });
            let mut answer = Response::new(RelayBody::Fixed(Full::new(Bytes::new())));
            *answer.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
            *answer.headers_mut() = filtered;
            return Ok(answer);
        }
        filtered.insert(CONNECTION, HeaderValue::from_static("close"));
        let (mut parts, incoming) = response.into_parts();
        parts.headers = filtered;
        Ok(Response::from_parts(
            parts,
            RelayBody::Stream { incoming, driver },
        ))
    }
}

pub(crate) fn failure(status: StatusCode) -> Response<RelayBody> {
    let text = if status == StatusCode::BAD_GATEWAY {
        "The server did not answer."
    } else {
        "The preview is not available."
    };
    let mut response = Response::new(RelayBody::Fixed(Full::new(Bytes::from_static(
        text.as_bytes(),
    ))));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(headers::MARK, HeaderValue::from_static("1"));
    response.headers_mut().insert(
        "content-type",
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(CONNECTION, HeaderValue::from_static("close"));
    response
}
