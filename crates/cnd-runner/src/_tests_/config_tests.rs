//! Service variables and Node-compatible path defaults.

#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::Configuration;
use crate::error::Error;

#[test]
fn parses_required_settings_and_only_named_repository_folders() {
    let mut env: BTreeMap<String, String> = [
        ("CONDUCTIVE_WORKSPACE_ID", "workspace"),
        ("CONDUCTIVE_WORKSPACE_TOKEN", "token"),
        ("CONDUCTIVE_RUNNER_URL", "https://machines.test/v1/runner"),
        ("CONDUCTIVE_REPOSITORY", "../repo"),
        ("CONDUCTIVE_DEFAULT_BRANCH", "main"),
        ("CONDUCTIVE_HOME", "../agents"),
        ("CONDUCTIVE_REPOSITORY_ZETA_DIR", "/repos/zeta"),
        ("CONDUCTIVE_REPOSITORY_API_DIR", "../api"),
        ("CONDUCTIVE_REPOSITORY_DIR", "/ignored"),
        ("CONDUCTIVE_REPOSITORY_API_TOKEN", "secret"),
        ("CONDUCTIVE_REPOSITORY_empty_DIR", "/ignored"),
        ("CONDUCTIVE_REPOSITORY_EMPTY_DIR", ""),
    ]
    .into_iter()
    .map(|(a, b)| (a.into(), b.into()))
    .collect();
    let config =
        Configuration::parse(&env, Path::new("/code/current"), Path::new("/home/user")).unwrap();
    assert_eq!(config.cwd, PathBuf::from("/code/repo"));
    assert_eq!(config.home, PathBuf::from("/code/agents"));
    assert_eq!(
        config.state_path,
        PathBuf::from("/code/agents/.conductive/runner-state.json")
    );
    assert_eq!(config.workspace_branch, None);
    assert_eq!(
        config.repository_directories,
        BTreeMap::from([
            (
                "CONDUCTIVE_REPOSITORY_API_DIR".into(),
                PathBuf::from("/code/api")
            ),
            (
                "CONDUCTIVE_REPOSITORY_ZETA_DIR".into(),
                PathBuf::from("/repos/zeta")
            )
        ])
    );
    env.insert("CONDUCTIVE_WORKSPACE_BRANCH".into(), "alice/work".into());
    env.insert("CONDUCTIVE_STATE_PATH".into(), "custom-state.json".into());
    let config = Configuration::parse(&env, Path::new("/code"), Path::new("/home/user")).unwrap();
    assert_eq!(config.workspace_branch.as_deref(), Some("alice/work"));
    assert_eq!(config.state_path, PathBuf::from("custom-state.json"));
    env.remove("CONDUCTIVE_WORKSPACE_TOKEN");
    assert!(matches!(
        Configuration::parse(&env, Path::new("/code"), Path::new("/home/user")),
        Err(Error::MissingSetting {
            name: "CONDUCTIVE_WORKSPACE_TOKEN"
        })
    ));
}
