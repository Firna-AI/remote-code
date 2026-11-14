//! Api wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Wire dates are Unix milliseconds. IDs and model names are opaque strings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(type = "number")]
pub struct Timestamp(pub i64);
