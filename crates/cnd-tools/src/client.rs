//! Authenticated request orchestration with typed reply validation.

use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;

use cnd_runner_interface::json::decoder;

use crate::call::{Call, Name};
use crate::error::{Error, InputError, Result};
use crate::ports::{Http, HttpRequest, Runtime};
use crate::reply::{self, Reply};
use crate::request::{self, Request};

/// Validated runtime configuration, without printable credentials.
#[derive(Clone)]
pub struct Configuration {
    origin: String,
    token: String,
    turn_id: Option<String>,
}

impl Configuration {
    #[cfg(test)]
    pub(crate) fn context(&self) -> (&str, &str, Option<&str>) {
        (&self.origin, &self.token, self.turn_id.as_deref())
    }

    /// Validate the machine origin without making a network request.
    pub fn new(
        origin: Option<String>,
        token: Option<String>,
        turn_id: Option<String>,
    ) -> Result<Self> {
        let (Some(origin), Some(token)) = (
            origin.filter(|v| !v.is_empty()),
            token.filter(|v| !v.is_empty()),
        ) else {
            return Err(Error::Input(InputError::Credentials));
        };
        let url = match reqwest::Url::parse(&origin) {
            Ok(url) => url,
            Err(_) => return Err(Error::Input(InputError::Address)),
        };
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::Input(InputError::Address));
        }
        Ok(Self {
            origin: origin.trim_end_matches('/').into(),
            token,
            turn_id: turn_id.filter(|v| !v.is_empty()),
        })
    }
}

/// Workspace tools composed with replaceable HTTP and runtime effects.
pub(crate) struct Client {
    configuration: Configuration,
    http: Arc<dyn Http>,
    runtime: Arc<dyn Runtime>,
}

impl Client {
    /// Construct the shared CLI/MCP client.
    pub(crate) fn new(
        configuration: Configuration,
        http: Arc<dyn Http>,
        runtime: Arc<dyn Runtime>,
    ) -> Self {
        Self {
            configuration,
            http,
            runtime,
        }
    }
}

#[async_trait]
pub(crate) trait Dispatch: Send + Sync {
    async fn execute(&self, call: Call) -> Result<Reply>;
}

#[async_trait]
impl Dispatch for Client {
    async fn execute(&self, call: Call) -> Result<Reply> {
        let name = call.name();
        if name == Name::RunMacCommand && self.configuration.turn_id.is_none() {
            return Err(Error::Input(InputError::ActiveTurn));
        }
        let mut reply = self.read(name, request::request(&call)?).await?;
        while let Some(key) = reply.pending_mac() {
            let path = format!("/v1/tools/mac-command/{}", request::component(key));
            self.runtime.wait().await;
            reply = self.read(name, Request { path, body: None }).await?;
        }
        Ok(reply)
    }
}

impl Client {
    async fn read(&self, name: Name, request: Request) -> Result<Reply> {
        let mac = name == Name::RunMacCommand;
        let body = request
            .body
            .map(|body| if body == "null" { "{}".into() } else { body });
        let response = match self
            .http
            .send(HttpRequest {
                url: format!("{}{}", self.configuration.origin, request.path),
                token: self.configuration.token.clone(),
                turn_id: self.configuration.turn_id.clone(),
                body,
            })
            .await
        {
            Ok(response) => response,
            Err(_) => return Err(Error::Network { mac }),
        };
        if !(200..300).contains(&response.status) {
            if let Ok(failure) = decoder::decode::<Failure>(response.body.as_bytes())
                && !failure.error.code.is_empty()
            {
                let code = failure
                    .error
                    .code
                    .replace(&self.configuration.token, "[redacted]");
                let mut message = failure
                    .error
                    .message
                    .replace(&self.configuration.token, "[redacted]");
                if mac && response.status == 403 && failure.error.code == "calling_turn_required" {
                    message.push_str(
                        " The agent turn ended. The tool cannot read the Mac command result.",
                    );
                }
                return Err(Error::Worker {
                    status: response.status,
                    code,
                    message,
                });
            }
            return Err(Error::Status {
                mac,
                status: response.status,
            });
        }
        reply::parse(name, &response.body)
    }
}

#[derive(Deserialize)]
struct Failure {
    error: WorkerFailure,
}
#[derive(Deserialize)]
struct WorkerFailure {
    code: String,
    message: String,
}

#[cfg(test)]
#[path = "_tests_/client/mod.rs"]
mod client_tests;
