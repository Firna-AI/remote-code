//! Git credential protocol and safe Worker refusal handling.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use unicode_general_category::{GeneralCategory, get_general_category};

use crate::error::{Error, Result};
use crate::ports::{Environment, Http, Streams};

/// The credential command, including Git's ignored store and erase operations.
#[async_trait]
pub trait Credential: Send + Sync {
    /// Supply a fresh credential, or ignore an unsupported operation or host.
    async fn execute(&self, mode: &str) -> Result<()>;
}

/// Credential policy with injected side-effect boundaries.
pub struct CredentialService {
    /// Sandbox settings.
    pub environment: Arc<dyn Environment>,
    /// Fresh credential transport.
    pub http: Arc<dyn Http>,
    /// Git input and output.
    pub streams: Arc<dyn Streams>,
}

#[derive(Deserialize)]
struct Token {
    token: String,
}
#[derive(Deserialize)]
struct Refusal {
    error: Message,
}
#[derive(Deserialize)]
struct Message {
    message: String,
}

#[async_trait]
impl Credential for CredentialService {
    async fn execute(&self, mode: &str) -> Result<()> {
        if mode != "get" && mode != "token" {
            return Ok(());
        }
        if mode == "get" {
            let input = self.streams.input().await?;
            let fields: HashMap<_, _> = input
                .lines()
                .filter_map(|line| line.split_once('='))
                .collect();
            if fields.get("protocol") != Some(&"https") || fields.get("host") != Some(&"github.com")
            {
                return Ok(());
            }
        }
        let context = self.environment.context()?;
        if context.origin.is_empty() || context.token.is_empty() {
            return Err(Error::Invalid);
        }
        if mode == "get" && context.turn.is_empty() {
            return Err(Error::TurnRequired);
        }
        let reply = self.http.credential(context).await?;
        if !(200..300).contains(&reply.status) {
            if let Ok(refusal) = serde_json::from_slice::<Refusal>(&reply.body) {
                let message = refusal.error.message;
                let length = message.chars().count();
                if (1..=300).contains(&length)
                    && message.chars().all(|c| {
                        !matches!(
                            get_general_category(c),
                            GeneralCategory::Control | GeneralCategory::Format
                        )
                    })
                {
                    return Err(Error::Refused(message));
                }
            }
            return Err(Error::Invalid);
        }
        let token = match serde_json::from_slice::<Token>(&reply.body) {
            Ok(value) if !value.token.is_empty() && !value.token.contains(['\r', '\n']) => {
                value.token
            }
            _ => return Err(Error::Invalid),
        };
        self.streams
            .output(if mode == "token" {
                format!("{token}\n")
            } else {
                format!("username=x-access-token\npassword={token}\n\n")
            })
            .await
    }
}

#[cfg(test)]
#[path = "_tests_/service_tests.rs"]
mod service_tests;
