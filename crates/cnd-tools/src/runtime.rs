//! Native runtime composition for workspace tools.

use std::io::Read;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, redirect::Policy};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines, Stdin};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::ports::{Http, HttpRequest, HttpResponse, Runtime, Streams};

/// Native HTTP transport, never following a redirect.
pub struct NativeHttp(Client);

impl NativeHttp {
    /// Construct an isolated transport with redirect following disabled.
    pub fn new() -> Result<Self> {
        Ok(Self(
            Client::builder()
                .redirect(Policy::none())
                .build()
                .internal()?,
        ))
    }
}

#[async_trait]
impl Http for NativeHttp {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse> {
        let mut call = if let Some(body) = request.body {
            self.0
                .post(&request.url)
                .header("Content-Type", "application/json")
                .body(body)
        } else {
            self.0.get(&request.url)
        };
        call = call.bearer_auth(request.token);
        if let Some(turn) = request.turn_id {
            call = call.header("X-Conductive-Turn-Id", turn);
        }
        let response = call.send().await.internal()?;
        Ok(HttpResponse {
            status: response.status().as_u16(),
            body: response.text().await.internal()?,
        })
    }
}

/// Files, UUIDs, and polling for the installed program.
pub struct NativeRuntime;

#[async_trait]
impl Runtime for NativeRuntime {
    async fn message(&self, path: &str) -> Result<String> {
        let result = if path == "-" {
            let mut bytes = Vec::new();
            std::io::stdin()
                .read_to_end(&mut bytes)
                .map(|_| String::from_utf8_lossy(&bytes).into_owned())
        } else {
            std::fs::read(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        };
        match result {
            Ok(text) => Ok(text),
            Err(_) => Err(Error::Input(if path == "-" {
                InputError::MessageStdin
            } else {
                InputError::MessageFile
            })),
        }
    }
    fn request_id(&self) -> String {
        Uuid::new_v4().to_string()
    }
    async fn wait(&self) {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Serialized writes and buffered protocol input on process stdio.
pub struct NativeStreams {
    input: Mutex<Lines<BufReader<Stdin>>>,
    output: Mutex<tokio::io::Stdout>,
    error: Mutex<tokio::io::Stderr>,
}

impl Default for NativeStreams {
    fn default() -> Self {
        Self {
            input: Mutex::new(BufReader::new(tokio::io::stdin()).lines()),
            output: Mutex::new(tokio::io::stdout()),
            error: Mutex::new(tokio::io::stderr()),
        }
    }
}

#[async_trait]
impl Streams for NativeStreams {
    async fn line(&self) -> Result<Option<String>> {
        Ok(self.input.lock().await.next_line().await.internal()?)
    }
    async fn stdout(&self, text: &str) -> Result<()> {
        let mut output = self.output.lock().await;
        output.write_all(text.as_bytes()).await.internal()?;
        output.flush().await.internal()?;
        Ok(())
    }
    async fn stderr(&self, text: &str) -> Result<()> {
        let mut error = self.error.lock().await;
        error.write_all(text.as_bytes()).await.internal()?;
        error.flush().await.internal()?;
        Ok(())
    }
}
