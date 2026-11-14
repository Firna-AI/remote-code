//! Execute the packaged relay entry point with an isolated fake executable.

use std::error::Error;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

#[test]
fn relay_start_script_executes_the_relay_subcommand() -> Result<(), Box<dyn Error>> {
    let root = tempfile::tempdir()?;
    let program = root.path().join("conductive with spaces");
    fs::write(&program, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 23\n")?;
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755))?;
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../image/preview-relay-start.sh");
    let output = Command::new("/bin/sh").arg(script).arg(program).output()?;
    assert_eq!(output.status.code(), Some(23));
    assert_eq!(output.stdout, b"relay\n");
    assert_eq!(output.stderr, b"");
    Ok(())
}
