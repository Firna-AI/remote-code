//! Production executable checks and root system-file installation.

use std::path::Path;
use std::process::Command;

use cnd_release::parts::PartsList;

use super::error::{Error, ErrorResultExt, Result};
use super::ports::Processes;

/// Role containing the root-owned system installer and service units.
pub const SYSTEM_PART: &str = "system";

/// Run checked release programs with no shell expansion.
pub struct SystemProcesses;

impl Processes for SystemProcesses {
    fn inspect(&self, executable: &Path, version: &str) -> Result<PartsList> {
        let output = Command::new(executable)
            .arg("--version")
            .output()
            .internal()?;
        if !output.status.success() || output.stdout != format!("conductive {version}\n").as_bytes()
        {
            return Err(Error::StartFailed);
        }
        let output = Command::new(executable)
            .args(["update", "parts"])
            .output()
            .internal()?;
        if !output.status.success() {
            return Err(Error::StartFailed);
        }
        serde_json::from_slice(&output.stdout).internal()
    }

    fn install_system(&self, folder: &Path) -> Result<()> {
        let status = Command::new("/bin/sh")
            .arg(folder.join(SYSTEM_PART).join("install-system.sh"))
            .status()
            .internal()?;
        if !status.success() {
            return Err(Error::StartFailed);
        }
        Ok(())
    }
}
