//! Observe the application's WebSocket handshake through tungstenite's callback.

use hyper::header::HeaderValue;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::handshake::server::{
    Callback, ErrorResponse, Request, Response,
};

pub(crate) struct CaptureHeaders(pub(crate) oneshot::Sender<String>);

impl Callback for CaptureHeaders {
    fn on_request(
        self,
        request: &Request,
        mut response: Response,
    ) -> Result<Response, ErrorResponse> {
        let _ = self
            .0
            .send(format!("{} {:?}", request.uri(), request.headers()));
        response
            .headers_mut()
            .insert("x-conductive-relay", HeaderValue::from_static("untrusted"));
        Ok(response)
    }
}
