//! Commit-count ordering and metadata identity checks.

#![expect(
    clippy::unwrap_used,
    reason = "A failed test setup must stop the test."
)]

use cli_release_interface::ReleaseAssetInfo;

use crate::error::Error;
use crate::version::{BINARY, DEVELOPMENT_VERSION, TARGET, is_newer, release_version};

fn metadata(version: &str) -> ReleaseAssetInfo {
    ReleaseAssetInfo {
        binary: BINARY.to_owned(),
        target: TARGET.to_owned(),
        version: version.to_owned(),
        asset_name: String::new(),
        download_url: String::new(),
        sha256: None,
    }
}

#[test]
fn newest_version_advances_only_for_a_larger_commit_count() {
    assert!(is_newer(&metadata("0.0.10"), &metadata("0.0.9")).unwrap());
    assert!(!is_newer(&metadata("0.0.9"), &metadata("0.0.10")).unwrap());
    assert!(!is_newer(&metadata("0.0.10"), &metadata("0.0.10")).unwrap());
    assert!(
        semver::Version::parse(DEVELOPMENT_VERSION).unwrap() < release_version("0.0.1").unwrap()
    );
    assert!(
        matches!(release_version("0.0.9+build"), Err(Error::InvalidVersion { version }) if version == "0.0.9+build")
    );
    let mut wrong_target = metadata("0.0.9");
    wrong_target.target = "aarch64-apple-darwin".to_owned();
    assert!(matches!(
        is_newer(&metadata("0.0.10"), &wrong_target),
        Err(Error::InvalidMetadata)
    ));
}
