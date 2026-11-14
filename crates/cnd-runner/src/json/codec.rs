//! Node-compatible JSON text at the persistence and socket boundaries.

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use cnd_runner_interface::json::decoder;

use crate::error::{Error, ErrorResultExt, Result};

/// Largest integer shared exactly with the workspace's JavaScript runtime.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Decode typed JSON, repairing lone UTF-16 surrogate escapes like TextEncoder.
pub fn decode<T: DeserializeOwned + Serialize>(bytes: &[u8]) -> Result<T> {
    let result = serde_json::from_value(decode_value(bytes)?).internal()?;
    encode(&result)?;
    Ok(result)
}

pub(super) fn decode_value(bytes: &[u8]) -> Result<Value> {
    let mut value = decoder::decode(bytes).internal()?;
    normalize_numbers(&mut value);
    Ok(value)
}

/// Compact UTF-8 JSON, with the same string escaping and integer form as Node.
pub fn encode(value: &impl Serialize) -> Result<Vec<u8>> {
    let serialized = serde_json::to_value(value).internal()?;
    validate_numbers(&serialized)?;
    serde_json::to_vec(value).internal()
}

fn validate_numbers(value: &Value) -> Result<()> {
    match value {
        Value::Number(n) if n.as_u64().is_none_or(|n| n > MAX_SAFE_INTEGER) => {
            Err(Error::InvalidNumber)
        }
        Value::Array(values) => values.iter().try_for_each(validate_numbers),
        Value::Object(values) => values.values().try_for_each(validate_numbers),
        _ => Ok(()),
    }
}

fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Number(n) if n.as_u64().is_none() => {
            if let Some(number) = n.as_f64().filter(|n| {
                n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n <= MAX_SAFE_INTEGER as f64
            }) {
                *n = (number as u64).into();
            }
        }
        Value::Array(values) => values.iter_mut().for_each(normalize_numbers),
        Value::Object(values) => values.values_mut().for_each(normalize_numbers),
        _ => {}
    }
}

#[cfg(test)]
#[path = "../_tests_/json_tests.rs"]
mod json_tests;
