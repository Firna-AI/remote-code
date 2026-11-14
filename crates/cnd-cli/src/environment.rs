//! One saved-settings reader for workspace tools and Git credentials.

use std::path::{Path, PathBuf};
use std::process::Command;

use internal_error::InternalError;
use thiserror::Error;

/// Native settings supplied through each command's environment boundary.
pub struct NativeEnvironment {
    path: PathBuf,
}

impl NativeEnvironment {
    /// Select a saved shell settings file without reading it.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    fn read(&self) -> Result<[Option<String>; 3], Error> {
        let output = Command::new("/bin/sh")
            .args([
                "-c",
                r#"set -e
if [ -r "$1" ]; then
  set -a
  . "$1"
fi
printf '%s\000%s\000%s\000' "${CONDUCTIVE_MACHINE_ORIGIN-}" "${WORKSPACE_TOKEN-}" "${CONDUCTIVE_TURN_ID-}"
"#,
                "conductive-settings",
            ])
            .arg(&self.path)
            .output()
            .internal()?;
        if !output.status.success() {
            return Err(Error::internal_message("saved settings shell failed"));
        }
        let mut values = output.stdout.split(|byte| *byte == 0);
        Ok(std::array::from_fn(|_| {
            values
                .next()
                .filter(|bytes| !bytes.is_empty())
                .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        }))
    }
}

impl Default for NativeEnvironment {
    fn default() -> Self {
        Self::new(Path::new("/run/ascii-secrets/env.sh"))
    }
}

impl cnd_tools::environment::Environment for NativeEnvironment {
    fn variable(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn saved(&self) -> cnd_tools::error::Result<[Option<String>; 3]> {
        cnd_tools::error::ErrorResultExt::internal(self.read())
    }
}

impl cnd_credential::ports::Environment for NativeEnvironment {
    fn caller_turn(&self) -> String {
        std::env::var("CONDUCTIVE_TURN_ID").unwrap_or_default()
    }

    fn saved(&self) -> cnd_credential::error::Result<[String; 2]> {
        let [origin, token, _] = cnd_credential::error::ErrorResultExt::internal(self.read())?;
        Ok([origin.unwrap_or_default(), token.unwrap_or_default()])
    }
}

#[derive(Debug, Error, internal_error::ErrorContract)]
enum Error {
    #[error("[cnd-cli/environment] internal: {0:?}")]
    Internal(#[from] InternalError),
}
