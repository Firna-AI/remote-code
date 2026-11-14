//! Repair JavaScript string escapes before typed JSON decoding.

use serde::de::DeserializeOwned;

use super::surrogates;

/// Decode JSON, replacing lone UTF-16 surrogate escapes with U+FFFD.
/// Valid pairs and literal escape text remain unchanged.
/// Callers retain responsibility for number and domain validation.
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> serde_json::Result<T> {
    serde_json::from_slice(&surrogates::repair(bytes))
}
