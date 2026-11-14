//! Local HTTP fixture and deterministic release archives.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use async_trait::async_trait;
use cli_release_interface::ReleaseAssetInfo;
use cli_updater::{HttpReleaseClient, ReleaseClient};
use cnd_cli::update::http::release_client;
use flate2::{Compression, GzBuilder};
use tar::{Builder, Header};

pub(crate) mod download;
pub(crate) mod locking;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub(super) fn archive(files: &[(&str, &[u8])]) -> std::io::Result<Vec<u8>> {
    let mut archive = Builder::new(
        GzBuilder::new()
            .mtime(0)
            .write(Vec::new(), Compression::default()),
    );
    for (name, bytes) in files {
        let mut header = Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        archive.append_data(&mut header, name, *bytes)?;
    }
    archive.into_inner()?.finish()
}

pub(super) struct Server {
    pub(super) client: LocalClient,
    pub(super) requests: Arc<Mutex<Vec<String>>>,
    thread: JoinHandle<TestResult>,
    stopped: Arc<AtomicBool>,
    address: SocketAddr,
}

impl Server {
    pub(super) fn start(responses: HashMap<String, Vec<u8>>) -> TestResult<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        let base = format!("http://{address}");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let thread = thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream?;
                if stop.load(Ordering::Acquire) {
                    break;
                }
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    assert_eq!(stream.read(&mut byte)?, 1);
                    request.push(byte[0]);
                }
                let line = String::from_utf8(request)?;
                let path = line
                    .split_whitespace()
                    .nth(1)
                    .ok_or("missing request path")?;
                captured
                    .lock()
                    .map_err(|_| "request lock poisoned")?
                    .push(path.to_owned());
                let bytes = responses.get(path).ok_or("unexpected request")?;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
                    bytes.len()
                )?;
                stream.write_all(bytes)?;
            }
            Ok(())
        });
        Ok(Self {
            client: LocalClient {
                inner: release_client(&base)?,
                base,
            },
            requests,
            thread,
            stopped,
            address,
        })
    }

    pub(super) fn finish(self) -> TestResult {
        self.stopped.store(true, Ordering::Release);
        let _wake = TcpStream::connect(self.address);
        self.thread.join().map_err(|_| "HTTP server panicked")?
    }
}

#[derive(Clone)]
pub(super) struct LocalClient {
    inner: HttpReleaseClient,
    base: String,
}

#[async_trait]
impl ReleaseClient for LocalClient {
    async fn latest(&self, binary: &str, target: &str) -> cli_updater::Result<ReleaseAssetInfo> {
        self.inner.latest(binary, target).await
    }
    async fn download(&self, release: &ReleaseAssetInfo) -> cli_updater::Result<Vec<u8>> {
        let mut local = release.clone();
        local.download_url = local
            .download_url
            .replace("https://releases.test", &self.base);
        self.inner.download(&local).await
    }
}
