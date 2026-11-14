//! Release identity and commit-count version ordering.

use cli_release_interface::ReleaseAssetInfo;
use semver::Version;

use crate::error::{Error, Result};

/// Executable name understood by the updater.
pub const BINARY: &str = "conductive";
/// Static Linux x64 release target.
pub const TARGET: &str = "x86_64-unknown-linux-musl";
/// Public release host.
pub const BASE_URL: &str = "https://runner.conductive.build";
/// Development builds always sort below a published commit-count version.
pub const DEVELOPMENT_VERSION: &str = "0.0.0-dev";
/// Mutable object read by `HttpReleaseClient`.
pub const LATEST_KEY: &str = "releases/latest/conductive/x86_64-unknown-linux-musl";

/// Parse a canonical `0.0.<positive commit count>` release version.
pub fn release_version(value: &str) -> Result<Version> {
    if let Ok(version) = Version::parse(value)
        && version.major == 0
        && version.minor == 0
        && version.patch > 0
        && version.pre.is_empty()
        && version.build.is_empty()
    {
        return Ok(version);
    }
    Err(Error::InvalidVersion {
        version: value.to_owned(),
    })
}

/// Compare metadata before a deploy replaces the mutable newest-version object.
pub fn is_newer(candidate: &ReleaseAssetInfo, current: &ReleaseAssetInfo) -> Result<bool> {
    for metadata in [candidate, current] {
        if metadata.binary != BINARY || metadata.target != TARGET {
            return Err(Error::InvalidMetadata);
        }
    }
    Ok(release_version(&candidate.version)? > release_version(&current.version)?)
}

#[cfg(test)]
#[path = "_tests_/version_tests.rs"]
mod version_tests;
