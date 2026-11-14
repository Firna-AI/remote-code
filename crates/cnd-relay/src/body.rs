//! Streaming response ownership also owns the upstream connection driver.

use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::{Body, Frame, Incoming, SizeHint};
use tokio_util::task::AbortOnDropHandle;

/// HTTP response body with disconnect propagation.
pub enum RelayBody {
    /// A small fixed relay error.
    Fixed(Full<Bytes>),
    /// A streamed response. Dropping it also stops an unfinished upload.
    Stream {
        /// Upstream body.
        incoming: Incoming,
        /// Driver kept alive only as long as its response.
        driver: AbortOnDropHandle<()>,
    },
}

impl Body for RelayBody {
    type Data = Bytes;
    type Error = hyper::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, hyper::Error>>> {
        match &mut *self {
            Self::Fixed(body) => Pin::new(body).poll_frame(cx).map(|frame| {
                frame.map(|result| match result {
                    Ok(value) => Ok(value),
                    Err(never) => match never {},
                })
            }),
            Self::Stream { incoming, .. } => Pin::new(incoming).poll_frame(cx),
        }
    }
    fn is_end_stream(&self) -> bool {
        match self {
            Self::Fixed(body) => body.is_end_stream(),
            Self::Stream { incoming, .. } => incoming.is_end_stream(),
        }
    }
    fn size_hint(&self) -> SizeHint {
        match self {
            Self::Fixed(body) => body.size_hint(),
            Self::Stream { incoming, .. } => incoming.size_hint(),
        }
    }
}
