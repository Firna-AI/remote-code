//! Bounded child-process Git commands with inherited cancellation.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use rustix::process::{Pid, Signal, kill_process};

use super::error::{Error, ErrorResultExt, Result};

/// Cancellation shared by a repository and every temporary comparison.
#[derive(Clone, Default)]
pub struct Cancellation(Arc<(AtomicBool, Mutex<()>, Condvar)>);

impl Cancellation {
    /// Cancel active and future commands. This operation is idempotent.
    pub fn cancel(&self) {
        self.0.0.store(true, Ordering::Release);
        self.0.2.notify_all();
    }

    /// Return cancellation without exposing host state.
    pub fn check(&self) -> Result<()> {
        if self.0.0.load(Ordering::Acquire) {
            Err(Error::Canceled)
        } else {
            Ok(())
        }
    }
}

/// One child request. Git always resolves the working folder anew.
#[derive(Clone)]
pub struct GitRequest {
    /// Absolute repository path.
    pub root: PathBuf,
    /// Arguments after the Git program name.
    pub args: Vec<String>,
    /// Temporary index and object overrides.
    pub environment: BTreeMap<String, String>,
    /// Optional bytes for standard input.
    pub input: Vec<u8>,
    /// Literal paths are the default. Exclusion pathspecs explicitly opt out.
    pub literal_paths: bool,
    /// Explicit stdout cap. The default child buffer cap is 64 MiB.
    pub max_bytes: Option<u64>,
    /// The same cancellation follows commands in a temporary index.
    pub cancellation: Cancellation,
}

/// External Git boundary, replaced with unimock in unit tests.
#[cfg_attr(test, unimock::unimock(api = GitRunnerMock))]
#[async_trait]
pub trait GitRunner: Send + Sync {
    /// Run one command, bounding both captured output streams.
    async fn run(&self, request: GitRequest) -> Result<Vec<u8>>;
}

/// Production Git child owner. No shell interprets repository arguments.
pub struct ChildGit;

#[async_trait]
impl GitRunner for ChildGit {
    async fn run(&self, request: GitRequest) -> Result<Vec<u8>> {
        request.cancellation.check()?;
        tokio::task::spawn_blocking(move || execute(request))
            .await
            .internal()?
    }
}

fn capture(
    mut input: impl Read,
    cap: u64,
    limit: Option<u64>,
    overflow: Arc<AtomicBool>,
) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    input
        .by_ref()
        .take(cap + 1)
        .read_to_end(&mut bytes)
        .internal()?;
    if bytes.len() as u64 > cap {
        overflow.store(true, Ordering::Release);
        return match limit {
            Some(limit) => Err(Error::TooLarge {
                size: limit + 1,
                limit,
            }),
            None => Err(Error::Unavailable),
        };
    }
    Ok(bytes)
}

fn execute(request: GitRequest) -> Result<Vec<u8>> {
    request.cancellation.check()?;
    let mut command = Command::new("git");
    if request.literal_paths {
        command.arg("--literal-pathspecs");
    }
    let mut child = command
        .args(&request.args)
        .current_dir(&request.root)
        .envs(&request.environment)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .internal()?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or(Error::Unavailable)?;
    let stderr = child.stderr.take().ok_or(Error::Unavailable)?;
    let cap = request.max_bytes.unwrap_or(64 * 1024 * 1024);
    let writing = std::thread::spawn(move || {
        if let Some(mut pipe) = stdin {
            let _ = pipe.write_all(&request.input);
        }
    });
    let overflow = Arc::new(AtomicBool::new(false));
    let output_overflow = overflow.clone();
    let error_overflow = overflow.clone();
    let output =
        std::thread::spawn(move || capture(stdout, cap, request.max_bytes, output_overflow));
    let errors = std::thread::spawn(move || capture(stderr, cap, None, error_overflow));
    let mut canceled = false;
    let status = loop {
        if request.cancellation.check().is_err() {
            canceled = true;
        }
        if (canceled || overflow.load(Ordering::Acquire))
            && let Some(pid) = Pid::from_raw(child.id() as i32)
        {
            let _ = kill_process(pid, Signal::TERM);
        }
        if let Some(status) = child.try_wait().internal()? {
            break status;
        }
        let guard = request
            .cancellation
            .0
            .1
            .lock()
            .or(Err(Error::Unavailable))?;
        let _waiting = request
            .cancellation
            .0
            .2
            .wait_timeout(guard, Duration::from_millis(1))
            .or(Err(Error::Unavailable))?;
    };
    let _ = writing.join();
    let bytes = match output.join() {
        Ok(result) => result,
        Err(_) => Err(Error::Unavailable),
    };
    let diagnostic = match errors.join() {
        Ok(result) => result,
        Err(_) => Err(Error::Unavailable),
    };
    if canceled {
        return Err(Error::Canceled);
    }
    let bytes = bytes?;
    diagnostic?;
    if !status.success() {
        return Err(Error::Command {
            code: status.code(),
        });
    }
    Ok(bytes)
}
