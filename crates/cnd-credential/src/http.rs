//! HTTPS transport with redirects disabled and a whole-request timeout.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Certificate, Client, Url, redirect::Policy};

use crate::error::{Error, ErrorResultExt, Result};
use crate::ports::{Context, Http, Reply};

/// Native rustls transport, suitable for a static musl program.
pub struct NativeHttp(Client);

impl NativeHttp {
    /// Create the token transport. Redirects can never receive the bearer token.
    pub fn new() -> Result<Self> {
        Self::with_roots(Vec::new())
    }
    /// Create a transport with additional trusted roots for a private machine host.
    pub fn with_roots(roots: Vec<Certificate>) -> Result<Self> {
        let mut builder = Client::builder();
        for root in roots {
            builder = builder.add_root_certificate(root);
        }
        Ok(Self(
            builder
                .redirect(Policy::custom(|attempt| {
                    attempt.error("credential redirect refused")
                }))
                .timeout(Duration::from_secs(30))
                .build()
                .internal()?,
        ))
    }
}

#[async_trait]
impl Http for NativeHttp {
    async fn credential(&self, context: Context) -> Result<Reply> {
        let origin = Url::parse(&context.origin).internal()?;
        if origin.scheme() != "https"
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(Error::Invalid);
        }
        let mut request = self
            .0
            .post(origin.join("/v1/git/credential").internal()?)
            .bearer_auth(context.token);
        if !context.turn.is_empty() {
            request = request.header("X-Conductive-Turn-Id", context.turn);
        }
        let response = request.send().await.internal()?;
        let status = response.status().as_u16();
        let body = response.bytes().await.internal()?.to_vec();
        Ok(Reply { status, body })
    }
}
