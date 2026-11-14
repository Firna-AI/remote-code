//! Native protocol streams. The token is written only to stdout.

use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{ErrorResultExt, Result};
use crate::ports::Streams;

/// Process stdin and stdout.
pub struct NativeStreams;

#[async_trait]
impl Streams for NativeStreams {
    async fn input(&self) -> Result<String> {
        let mut bytes = Vec::new();
        tokio::io::stdin()
            .read_to_end(&mut bytes)
            .await
            .internal()?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }
    async fn output(&self, value: String) -> Result<()> {
        let mut output = tokio::io::stdout();
        output.write_all(value.as_bytes()).await.internal()?;
        output.flush().await.internal()?;
        Ok(())
    }
}
