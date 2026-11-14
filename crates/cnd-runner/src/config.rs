//! Service settings, parsed without reading the process environment.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};

/// A WebSocket request. Its token must never enter event state or diagnostics.
#[derive(Clone)]
pub struct ConnectionRequest {
    /// HTTPS or WSS runner route on the machine hostname.
    pub url: String,
    /// Workspace bearer token.
    pub workspace_token: String,
}

/// Parsed service configuration shared with the file and turn owners.
#[derive(Clone)]
pub struct Configuration {
    /// Workspace identity sent in hello.
    pub workspace_id: String,
    /// Authenticated transport settings.
    pub request: ConnectionRequest,
    /// Absolute repository folder.
    pub cwd: PathBuf,
    /// Absolute agent home folder.
    pub home: PathBuf,
    /// Base branch of repository reports.
    pub default_branch: String,
    /// Branch tracked by the workspace, when supplied by its service.
    pub workspace_branch: Option<String>,
    /// Image repository variables in name order.
    pub repository_directories: BTreeMap<String, PathBuf>,
    /// State file path, with the Node runner's default.
    pub state_path: PathBuf,
}

impl Configuration {
    /// Parse supplied environment values with explicit path and home defaults.
    pub fn parse(env: &BTreeMap<String, String>, cwd: &Path, home: &Path) -> Result<Self> {
        let home = absolute(
            cwd,
            env.get("CONDUCTIVE_HOME").map(Path::new).unwrap_or(home),
        );
        let workspace_branch = env
            .get("CONDUCTIVE_WORKSPACE_BRANCH")
            .filter(|s| !s.is_empty())
            .cloned();
        if workspace_branch.is_none() {
            tracing::warn!("The workspace branch is unavailable. Agent instructions will omit it.");
        }
        Ok(Self {
            workspace_id: required(env, "CONDUCTIVE_WORKSPACE_ID")?,
            request: ConnectionRequest {
                url: required(env, "CONDUCTIVE_RUNNER_URL")?,
                workspace_token: required(env, "CONDUCTIVE_WORKSPACE_TOKEN")?,
            },
            cwd: absolute(cwd, Path::new(&required(env, "CONDUCTIVE_REPOSITORY")?)),
            state_path: env
                .get("CONDUCTIVE_STATE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".conductive/runner-state.json")),
            home,
            default_branch: required(env, "CONDUCTIVE_DEFAULT_BRANCH")?,
            workspace_branch,
            repository_directories: env
                .iter()
                .filter(|(name, value)| repository_variable(name) && !value.is_empty())
                .map(|(name, value)| (name.clone(), absolute(cwd, Path::new(value))))
                .collect(),
        })
    }
}

fn required(env: &BTreeMap<String, String>, name: &'static str) -> Result<String> {
    env.get(name)
        .filter(|s| !s.is_empty())
        .cloned()
        .ok_or(Error::MissingSetting { name })
}

fn repository_variable(name: &str) -> bool {
    name.strip_prefix("CONDUCTIVE_REPOSITORY_")
        .and_then(|s| s.strip_suffix("_DIR"))
        .is_some_and(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        })
}

fn absolute(cwd: &Path, path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in cwd.join(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other),
        }
    }
    result
}

#[cfg(test)]
#[path = "_tests_/config_tests.rs"]
mod config_tests;
