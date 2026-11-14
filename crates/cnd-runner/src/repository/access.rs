//! Literal repository paths and unchanged UTF-8 or binary file bytes.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use cnd_runner_interface::files::{FileResponse, FileResponseEncoding};

use super::error::{Error, Result};

pub(super) fn safe_path(path: &str) -> Result<()> {
    if path.contains('\0')
        || path
            .split('/')
            .any(|part| matches!(part, "" | "." | ".." | ".git"))
    {
        return Err(Error::Unavailable);
    }
    Ok(())
}

pub(super) fn text(bytes: &[u8]) -> Option<String> {
    if bytes.contains(&0) {
        None
    } else {
        std::str::from_utf8(bytes).ok().map(str::to_owned)
    }
}

pub(super) fn response(path: String, bytes: Vec<u8>) -> FileResponse {
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    let content = text(&bytes);
    let media = match extension.as_deref() {
        Some("md") => "text/markdown",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        _ if content.is_none() => "application/octet-stream",
        _ => "text/plain",
    };
    FileResponse {
        path,
        display_path: None,
        media_type: media.into(),
        size_bytes: bytes.len() as u64,
        encoding: if content.is_some() {
            FileResponseEncoding::Utf8
        } else {
            FileResponseEncoding::Base64
        },
        content: content.unwrap_or_else(|| STANDARD.encode(&bytes)),
    }
}
