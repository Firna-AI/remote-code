//! Cached Git namespace classification never traverses directory links or submodules.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;

use super::error::Result;
use super::io::{PathKind, RepositoryIo};

/// Whether Git can compare this physical entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryState {
    /// A supported entry.
    Present,
    /// A missing entry or an ordinary directory replacing a tracked file.
    Absent,
    /// A special file that Git cannot store.
    Unavailable,
}

/// Physical kind and Git interpretation captured during one scan.
#[derive(Debug, Clone, Copy)]
pub struct PathState {
    /// Physical kind without following directory links.
    pub kind: PathKind,
    /// Git's supported-entry interpretation.
    pub entry: EntryState,
    /// A recorded Git submodule.
    pub submodule: bool,
}

/// A classifier caches physical parent kinds for one repository scan.
#[async_trait]
pub trait GitPaths: Send + Sync {
    /// Classify in the Git namespace. Children of links and submodules are absent.
    async fn classify(&mut self, path: &str) -> Result<PathState>;
}

/// Cached classifier over an injected filesystem boundary.
pub struct GitPathClassifier {
    root: PathBuf,
    io: Arc<dyn RepositoryIo>,
    modes: BTreeSet<String>,
    submodules: BTreeSet<String>,
    kinds: BTreeMap<String, PathKind>,
}

impl GitPathClassifier {
    /// Supply paths with recorded modes and the subset that are submodules.
    pub fn new(
        root: PathBuf,
        io: Arc<dyn RepositoryIo>,
        modes: BTreeSet<String>,
        submodules: BTreeSet<String>,
    ) -> Self {
        Self {
            root,
            io,
            modes,
            submodules,
            kinds: BTreeMap::new(),
        }
    }
}

#[async_trait]
impl GitPaths for GitPathClassifier {
    async fn classify(&mut self, path: &str) -> Result<PathState> {
        let mut parent_kind = PathKind::Directory;
        let mut prefix = String::new();
        for part in path.split('/') {
            let parent = prefix.clone();
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if parent_kind != PathKind::Directory || self.submodules.contains(&parent) {
                parent_kind = PathKind::Absent;
                continue;
            }
            parent_kind = match self.kinds.get(&prefix) {
                Some(kind) => *kind,
                None => {
                    let kind = self.io.kind(self.root.join(&prefix)).await?;
                    self.kinds.insert(prefix.clone(), kind);
                    kind
                }
            };
        }
        let submodule = self.submodules.contains(path);
        let entry = match parent_kind {
            PathKind::Absent => EntryState::Absent,
            PathKind::Special => EntryState::Unavailable,
            PathKind::Directory if self.modes.contains(path) && !submodule => EntryState::Absent,
            _ => EntryState::Present,
        };
        Ok(PathState {
            kind: parent_kind,
            entry,
            submodule,
        })
    }
}

#[cfg(test)]
#[path = "../_tests_/git_paths_tests.rs"]
mod git_paths_tests;
