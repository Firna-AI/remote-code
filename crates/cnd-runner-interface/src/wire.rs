//! Exact JSON literals and read-only TypeScript collections.

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use ts_rs::TS;

/// A JSON true literal, used for optional presence flags and successful results.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(type = "true")]
pub struct WireTrue;

impl Serialize for WireTrue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for WireTrue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            Ok(Self)
        } else {
            Err(D::Error::custom("expected true"))
        }
    }
}

/// A JSON false literal, used for failed file results.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(type = "false")]
pub struct WireFalse;

impl Serialize for WireFalse {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(false)
    }
}

impl<'de> Deserialize<'de> for WireFalse {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            Err(D::Error::custom("expected false"))
        } else {
            Ok(Self)
        }
    }
}

/// TypeScript collection view. Rust fields keep ordinary vectors.
#[derive(TS)]
#[ts(type = "ReadonlyArray<T>")]
pub struct ReadonlyVec<T: TS>(pub Vec<T>);
