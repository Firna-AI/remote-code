//! Context storage preparation follows Git's exclude path, including linked worktrees.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use super::error::{Error, ErrorResultExt, Result};

pub(super) fn prepare(root: &Path, exclude: &Path) -> Result<()> {
    let rules = match fs::read_to_string(exclude) {
        Ok(rules) => rules,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(Error::internal(error)),
    };
    if !rules.lines().any(|line| line == "/.context/") {
        fs::create_dir_all(exclude.parent().ok_or(Error::Unavailable)?).internal()?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(exclude)
            .internal()?;
        if !rules.is_empty() && !rules.ends_with('\n') {
            file.write_all(b"\n").internal()?;
        }
        file.write_all(b"/.context/\n").internal()?;
    }
    match fs::symlink_metadata(root.join(".context")) {
        Ok(info) if !info.is_dir() => return Err(Error::Unavailable),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(Error::internal(error)),
    }
    fs::create_dir_all(root.join(".context/attachments")).internal()
}
