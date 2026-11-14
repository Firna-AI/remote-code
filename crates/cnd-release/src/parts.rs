//! Versioned parts list shared by the packager and the installed program.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};

/// One independently downloaded release part, besides the program itself.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Part {
    /// Stable installation role, for example `sdk-helper` or `node`.
    pub name: String,
    /// Absolute HTTPS URL of the unchanged archive.
    pub url: String,
    /// SHA-256 digest of the downloaded bytes, in hexadecimal.
    pub sha256: String,
}

#[cfg(test)]
#[path = "_tests_/parts_tests.rs"]
mod parts_tests;

/// Version 1 of the embedded and published parts file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PartsList {
    /// Format version. Readers refuse versions they do not support.
    pub schema_version: u32,
    /// All release parts except the program.
    pub parts: Vec<Part>,
}

impl PartsList {
    /// Check the roles required by the release that will use these parts.
    pub fn require(&self, names: &[&str]) -> Result<()> {
        for name in names {
            if !self.parts.iter().any(|part| part.name == *name) {
                return Err(Error::MissingPart {
                    name: (*name).to_owned(),
                });
            }
        }
        Ok(())
    }

    /// Construct a parts list and check all entries.
    pub fn new(parts: Vec<Part>) -> Result<Self> {
        let list = Self {
            schema_version: 1,
            parts,
        };
        list.validate()?;
        Ok(list)
    }

    /// Check the supported format, unique names, HTTPS URLs, and required digests.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(Error::UnsupportedSchema {
                version: self.schema_version,
            });
        }
        let mut names = HashSet::new();
        for part in &self.parts {
            let valid_url = Url::parse(&part.url).is_ok_and(|url| {
                url.scheme() == "https"
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
            });
            if part.name.is_empty()
                || !part
                    .name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                || !names.insert(&part.name)
                || !valid_url
                || part.sha256.len() != 64
                || !part.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(Error::InvalidPart {
                    name: part.name.clone(),
                });
            }
        }
        Ok(())
    }
}
