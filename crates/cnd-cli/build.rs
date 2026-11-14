//! Embed the deploy version and the validated release parts.

use std::env;
use std::path::PathBuf;

use cnd_release::error::{Error, ErrorResultExt, Result};
use cnd_release::files::{DiskReleaseFiles, ReleaseFiles};
use cnd_release::parts::PartsList;
use cnd_release::version::{DEVELOPMENT_VERSION, release_version};

fn main() -> Result<()> {
    println!("cargo:rerun-if-env-changed=CONDUCTIVE_RELEASE_VERSION");
    println!("cargo:rerun-if-env-changed=CONDUCTIVE_PARTS_FILE");
    let version = env::var_os("CONDUCTIVE_RELEASE_VERSION");
    let parts_path = env::var_os("CONDUCTIVE_PARTS_FILE");
    let files: &dyn ReleaseFiles = &DiskReleaseFiles;
    let (version, parts) = match (version, parts_path) {
        (Some(version), Some(path)) => {
            let version = match version.into_string() {
                Ok(version) => version,
                Err(_) => {
                    return Err(Error::InvalidVersion {
                        version: "non-UTF-8".to_owned(),
                    });
                }
            };
            release_version(&version)?;
            let path = PathBuf::from(path);
            println!("cargo:rerun-if-changed={}", path.display());
            (version, files.read_parts(&path)?)
        }
        (None, None) => (DEVELOPMENT_VERSION.to_owned(), PartsList::new(Vec::new())?),
        _ => return Err(Error::IncompleteEmbedding),
    };
    let output = PathBuf::from(env::var("OUT_DIR").internal()?);
    files.write_parts(&output.join("parts.json"), &parts)?;
    println!("cargo:rustc-env=CONDUCTIVE_EMBEDDED_VERSION={version}");
    Ok(())
}
