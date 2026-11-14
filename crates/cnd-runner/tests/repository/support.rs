//! An isolated real repository without user Git settings, hooks, or network access.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use cnd_runner::repository::git::{Cancellation, ChildGit};
use cnd_runner::repository::io::LocalRepositoryIo;
use cnd_runner::repository::service::{GitRepository, Repository};
use tempfile::TempDir;

pub(super) struct Fixture {
    _directory: TempDir,
    pub root: PathBuf,
    pub repository: Arc<dyn Repository>,
}

impl Fixture {
    pub(super) async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("repository");
        std::fs::create_dir(&root).unwrap();
        let repository = Self::at(&root, Cancellation::default());
        let fixture = Self {
            _directory: directory,
            root,
            repository,
        };
        fixture.git(&["init", "--initial-branch=main"]);
        fixture.git(&["config", "user.name", "Runner test"]);
        fixture.git(&["config", "user.email", "runner@example.test"]);
        fixture.git(&["config", "core.autocrlf", "false"]);
        fixture.git(&["config", "core.fileMode", "true"]);
        fixture.write("README.md", b"first\nsame\n");
        fixture.write("rename me.txt", b"keep\nthese\nlines\n");
        fixture.write("a[1].txt", b"bracket old\n");
        fixture.write("a1.txt", b"plain old\n");
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-m", "base"]);
        fixture.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        fixture.git(&["checkout", "-b", "task"]);
        fixture
    }

    pub(super) fn at(root: &Path, cancellation: Cancellation) -> Arc<dyn Repository> {
        Arc::new(GitRepository::new(
            root.to_owned(),
            Arc::new(ChildGit),
            Arc::new(LocalRepositoryIo),
            cancellation,
        ))
    }

    pub(super) fn write(&self, path: &str, bytes: &[u8]) {
        let path = self.root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    pub(super) fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.root)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    pub(super) fn base(&self) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", "new base"]);
        self.git(&["update-ref", "refs/heads/main", "HEAD"]);
        self.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    }

    pub(super) fn stored_git(&self) -> Vec<(PathBuf, Vec<u8>)> {
        fn visit(root: &Path, path: &Path, result: &mut Vec<(PathBuf, Vec<u8>)>) {
            for entry in std::fs::read_dir(path).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    visit(root, &entry.path(), result);
                } else {
                    result.push((
                        entry.path().strip_prefix(root).unwrap().to_owned(),
                        std::fs::read(entry.path()).unwrap(),
                    ));
                }
            }
        }
        let mut result = vec![];
        let index = self.root.join(".git/index");
        result.push((PathBuf::from("index"), std::fs::read(index).unwrap()));
        visit(
            &self.root.join(".git"),
            &self.root.join(".git/objects"),
            &mut result,
        );
        result.sort();
        result
    }
}
