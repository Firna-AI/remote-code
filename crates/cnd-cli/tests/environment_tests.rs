//! Integration coverage for the shared native saved-settings reader.

use std::error::Error;
use std::fs;

use cnd_cli::environment::NativeEnvironment;
use cnd_tools::environment::Environment;

#[test]
fn reads_the_workers_saved_workspace_token_for_both_commands() -> Result<(), Box<dyn Error>> {
    let root = tempfile::tempdir()?;
    let path = root.path().join("settings with spaces.sh");
    fs::write(
        &path,
        "CONDUCTIVE_MACHINE_ORIGIN='https://saved.test'\nWORKSPACE_TOKEN='saved-token'\nCONDUCTIVE_TURN_ID='saved-turn'\nCONDUCTIVE_WORKSPACE_TOKEN=''\n",
    )?;
    let environment = NativeEnvironment::new(path);
    assert_eq!(
        environment.saved()?,
        [
            Some("https://saved.test".into()),
            Some("saved-token".into()),
            Some("saved-turn".into()),
        ]
    );
    assert_eq!(
        cnd_credential::ports::Environment::saved(&environment)?,
        ["https://saved.test".to_string(), "saved-token".to_string()]
    );
    Ok(())
}
