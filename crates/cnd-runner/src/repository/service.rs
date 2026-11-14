//! Repository service boundary and injected production dependencies.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::file_changes::{ChangedFile, ChangesResponse};
use cnd_runner_interface::file_tree::FileEntry;
use cnd_runner_interface::files::{DiffResponse, FILE_READ_MAX_BYTES, FileResponse};

use super::access::{response, safe_path};
use super::error::{Error, Result};
use super::git::{Cancellation, GitRequest, GitRunner};
use super::io::RepositoryIo;

/// Git identities used by reports and by the turn owner's before/after capture.
pub type Checkpoint = BTreeMap<String, String>;

/// One captured state supplies a tree and its complete changes report.
#[derive(Debug, Clone, PartialEq)]
pub struct RepositorySnapshot {
    /// Flat file and directory entries.
    pub entries: Vec<FileEntry>,
    /// Complete changes with counts from the same scan.
    pub changes: ChangesResponse,
    /// Git representation identities.
    pub identities: Checkpoint,
    /// Readable raw identities, including ignored link targets and context files.
    pub read_identities: BTreeMap<String, String>,
    /// Resolved merge base. A changed base invalidates the changes report.
    pub base_commit: String,
}

/// Independent file operations. Cancellation belongs to this repository instance.
#[cfg_attr(test, unimock::unimock(api = RepositoryMock))]
#[async_trait]
pub trait Repository: Send + Sync {
    /// Prepare ignored context storage before runner warm-up and connection.
    async fn prepare_context(&self) -> Result<()>;
    /// Capture all reports using the current comparison base.
    async fn snapshot(&self, branch: String) -> Result<RepositorySnapshot>;
    /// Capture the complete branch changes without reading raw file content.
    async fn changes(&self, branch: String) -> Result<ChangesResponse>;
    /// Read a safe file, capped even when a larger limit is supplied.
    async fn read(&self, path: String, max_bytes: u64) -> Result<FileResponse>;
    /// Read both versions and a bounded isolated patch.
    async fn diff(&self, path: String, branch: String) -> Result<DiffResponse>;
    /// Capture identities without buffering file contents.
    async fn checkpoint(&self) -> Result<Checkpoint>;
    /// Compare a turn checkpoint with current Git identities.
    async fn changed_since(&self, branch: String, before: Checkpoint) -> Result<Vec<ChangedFile>>;
}

/// Production repository assembled from replaceable Git and filesystem boundaries.
#[derive(Clone)]
pub struct GitRepository {
    pub(super) root: PathBuf,
    pub(super) runner: Arc<dyn GitRunner>,
    pub(super) io: Arc<dyn RepositoryIo>,
    pub(super) cancellation: Cancellation,
}

impl GitRepository {
    /// Compose a repository. A turn uses its own cancellation handle.
    pub fn new(
        root: PathBuf,
        runner: Arc<dyn GitRunner>,
        io: Arc<dyn RepositoryIo>,
        cancellation: Cancellation,
    ) -> Self {
        Self {
            root,
            runner,
            io,
            cancellation,
        }
    }

    pub(super) fn request(&self, args: &[&str]) -> GitRequest {
        GitRequest {
            root: self.root.clone(),
            args: args.iter().map(|value| (*value).to_owned()).collect(),
            environment: BTreeMap::new(),
            input: vec![],
            literal_paths: true,
            max_bytes: None,
            cancellation: self.cancellation.clone(),
        }
    }

    pub(super) async fn run(&self, args: &[&str]) -> Result<Vec<u8>> {
        self.runner.run(self.request(args)).await
    }

    pub(super) async fn optional(&self, args: &[&str]) -> Result<Option<String>> {
        match self.run(args).await {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).trim().to_owned())),
            Err(Error::Command { code: Some(1) }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub(super) async fn comparison_base(&self, fallback: &str) -> Result<(String, String)> {
        let head = self.optional(&["symbolic-ref", "--quiet", "HEAD"]).await?;
        let selected = match head
            .as_deref()
            .and_then(|head| head.strip_prefix("refs/heads/"))
        {
            Some(branch) => {
                self.optional(&[
                    "config",
                    "--local",
                    "--get",
                    &format!("branch.{branch}.gh-merge-base"),
                ])
                .await?
            }
            None => None,
        };
        let branch = selected
            .filter(|branch| !branch.is_empty())
            .unwrap_or_else(|| fallback.to_owned());
        let remote = format!("refs/remotes/origin/{branch}");
        let refs = self
            .run(&["for-each-ref", "--format=%(refname)", "--", &remote])
            .await?;
        let reference = if String::from_utf8_lossy(&refs)
            .lines()
            .any(|line| line == remote)
        {
            &remote
        } else {
            &branch
        };
        let base = self.resolve(reference).await?;
        let head = self.resolve("HEAD").await?;
        let sha = self.run(&["merge-base", &head, &base]).await?;
        Ok((branch, String::from_utf8_lossy(&sha).trim().to_owned()))
    }

    async fn resolve(&self, reference: &str) -> Result<String> {
        let bytes = self
            .run(&[
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("{reference}^{{commit}}"),
            ])
            .await?;
        let sha = String::from_utf8_lossy(&bytes).trim().to_owned();
        if !(40..=64).contains(&sha.len())
            || !sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(Error::InvalidOutput);
        }
        Ok(sha)
    }
}

#[async_trait]
impl Repository for GitRepository {
    async fn prepare_context(&self) -> Result<()> {
        let exclude = self
            .run(&["rev-parse", "--git-path", "info/exclude"])
            .await?;
        let exclude = self.root.join(String::from_utf8_lossy(&exclude).trim());
        self.io.prepare_context(self.root.clone(), exclude).await
    }

    async fn snapshot(&self, branch: String) -> Result<RepositorySnapshot> {
        self.capture(&branch).await
    }
    async fn changes(&self, branch: String) -> Result<ChangesResponse> {
        let (branch, sha) = self.comparison_base(&branch).await?;
        let mut index = self.index(Some(&sha)).await?;
        self.index_changes(&mut index, &branch, &sha).await
    }
    async fn read(&self, path: String, max_bytes: u64) -> Result<FileResponse> {
        safe_path(&path)?;
        self.cancellation.check()?;
        let bytes = self
            .io
            .read(
                self.root.clone(),
                path.clone(),
                max_bytes.min(FILE_READ_MAX_BYTES),
            )
            .await?;
        self.cancellation.check()?;
        Ok(response(path, bytes))
    }
    async fn diff(&self, path: String, branch: String) -> Result<DiffResponse> {
        self.read_diff(path, &branch).await
    }
    async fn checkpoint(&self) -> Result<Checkpoint> {
        let index = self.index(None).await?;
        self.index_checkpoint(&index).await
    }
    async fn changed_since(&self, branch: String, before: Checkpoint) -> Result<Vec<ChangedFile>> {
        self.compare_checkpoint(branch, before).await
    }
}
