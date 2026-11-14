//! HTTP client configuration for large sandbox release archives.

use std::time::Duration;

use cli_updater::HttpReleaseClient;

/// Compose the release download client with separate connect and total limits.
pub fn release_client(server: &str) -> cli_updater::Result<HttpReleaseClient> {
    HttpReleaseClient::new_with_timeouts(
        server,
        Duration::from_secs(60 * 60),
        Duration::from_secs(10),
    )
}
