//! Build-time release identity and parts used by the program.

use cnd_release::parts::PartsList;

use crate::error::{ErrorResultExt, Result};

/// Release version supplied by the deploy, or the development prerelease.
pub(crate) const VERSION: &str = env!("CONDUCTIVE_EMBEDDED_VERSION");

/// Read the parts whose exact bytes form part of this program.
pub(crate) fn parts() -> Result<PartsList> {
    let parts: PartsList =
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/parts.json"))).internal()?;
    parts.validate().internal()?;
    Ok(parts)
}
