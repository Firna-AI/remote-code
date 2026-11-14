//! Host and target validation, hop headers, and provider-cookie removal.

use hyper::{
    HeaderMap, StatusCode,
    header::{CONNECTION, COOKIE, HOST, HeaderValue},
};

pub(crate) const MARK: &str = "x-conductive-relay";
pub(crate) const PORT: &str = "x-conductive-preview-port";

pub(crate) fn target(headers: &HeaderMap, relay_port: u16) -> Result<u16, StatusCode> {
    let host = headers
        .get(HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    let suffix = format!("-{relay_port}.on.boat.dev");
    let private = host.strip_suffix(&suffix).is_some_and(|prefix| {
        !prefix.is_empty()
            && prefix
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    });
    if !private {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut values = headers.get_all(PORT).iter();
    let value = values
        .next()
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    if values.next().is_some() || value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    match value.parse::<u16>() {
        Ok(port) if port != 0 && port != 7682 && port != relay_port => Ok(port),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

fn forwarded(headers: &HeaderMap) -> HeaderMap {
    let mut result = headers.clone();
    for value in headers.get_all(CONNECTION) {
        if let Ok(value) = value.to_str() {
            for name in value.split(',').map(str::trim) {
                result.remove(name);
            }
        }
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        result.remove(name);
    }
    result
}

pub(crate) fn request(headers: &HeaderMap, port: u16) -> HeaderMap {
    let mut result = forwarded(headers);
    let removed: Vec<_> = result
        .keys()
        .filter(|name| {
            *name == HOST
                || *name == PORT
                || *name == "forwarded"
                || name.as_str().starts_with("x-forwarded-")
        })
        .cloned()
        .collect();
    for name in removed {
        result.remove(name);
    }
    result.insert(
        HOST,
        HeaderValue::from_str(&format!("localhost:{port}"))
            .unwrap_or_else(|_| HeaderValue::from_static("localhost")),
    );
    let cookies: Vec<_> = result.get_all(COOKIE).iter().cloned().collect();
    result.remove(COOKIE);
    for value in &cookies {
        if let Ok(value) = value.to_str() {
            let cookie = value
                .split(';')
                .map(str::trim)
                .filter(|pair| pair.split('=').next().unwrap_or_default().trim() != "_port_auth")
                .collect::<Vec<_>>()
                .join("; ");
            if !cookie.is_empty()
                && let Ok(value) = HeaderValue::from_str(&cookie)
            {
                result.append(COOKIE, value);
            }
        }
    }
    result
}

pub(crate) fn response(headers: &HeaderMap) -> HeaderMap {
    let mut result = forwarded(headers);
    result.insert(MARK, HeaderValue::from_static("1"));
    result
}
