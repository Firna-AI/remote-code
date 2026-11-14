//! Metadata selection and cache lifetime use a mocked proc filesystem.

#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use unimock::{MockFn, Unimock, matching};

use crate::error::Error;
use crate::ports::proc::{ProcPortScanner, ProcReader, ProcReaderMock};
use crate::ports::reporter::PortScanner;

#[derive(Default)]
struct Proc {
    reads: BTreeMap<String, String>,
    links: BTreeMap<String, String>,
    lists: BTreeMap<String, Vec<String>>,
    calls: Vec<String>,
}

impl Proc {
    fn sockets(&mut self, inode: &str) {
        self.reads.insert(
            "/proc/net/tcp".into(),
            format!("0: 00000000:0BB8 0:0 0A 0:0 0:0 0 1000 0 {inode}\n"),
        );
        self.reads.insert(
            "/proc/net/tcp6".into(),
            format!("0: 00000000000000000000000000000000:0BB8 0:0 0A 0:0 0:0 0 1000 0 {inode}\n"),
        );
    }
    fn process(&mut self, inode: &str, command: &str, folder: &str) {
        self.lists.insert(
            "/proc".into(),
            vec!["nondigit".into(), "10".into(), "11".into()],
        );
        self.lists
            .insert("/proc/10/fd".into(), vec!["0".into(), "1".into()]);
        self.links
            .insert("/proc/10/fd/0".into(), format!("socket:[{inode}]"));
        self.links
            .insert("/proc/10/fd/1".into(), "not-a-socket".into());
        self.reads.insert("/proc/10/cmdline".into(), command.into());
        self.links.insert("/proc/10/cwd".into(), folder.into());
        self.links
            .insert("/proc/10/exe".into(), "/usr/bin/node".into());
    }
}

fn scanner(source: Arc<Mutex<Proc>>) -> Arc<dyn PortScanner> {
    let reading = source.clone();
    let linking = source.clone();
    let listing = source;
    let reader: Arc<dyn ProcReader> = Arc::new(Unimock::new((
        ProcReaderMock::read
            .each_call(matching!(_))
            .answers_arc(Arc::new(move |_, path| {
                let mut source = reading.lock().unwrap();
                source.calls.push(path.clone());
                source.reads.get(&path).cloned().ok_or(Error::Disconnected)
            })),
        ProcReaderMock::list
            .each_call(matching!(_))
            .answers_arc(Arc::new(move |_, path| {
                let mut source = listing.lock().unwrap();
                source.calls.push(path.clone());
                source.lists.get(&path).cloned().ok_or(Error::Disconnected)
            })),
        ProcReaderMock::link
            .each_call(matching!(_))
            .answers_arc(Arc::new(move |_, path| {
                let mut source = linking.lock().unwrap();
                source.calls.push(path.clone());
                source.links.get(&path).cloned().ok_or(Error::Disconnected)
            })),
    )));
    Arc::new(ProcPortScanner::new(
        reader,
        1000,
        "/home/user".into(),
        "/home/user/code/web".into(),
    ))
}

#[tokio::test]
async fn preserves_complete_socket_labels_until_inode_changes_and_never_reads_environments() {
    let source = Arc::new(Mutex::new(Proc::default()));
    let long = format!("secretpass/{}", "z".repeat(115));
    {
        let mut source = source.lock().unwrap();
        source.sockets("100");
        source.process(
            "100",
            "node\0/repo/development-server-entry-point\0secretpass\0--token=UNSELECTED",
            &format!("/home/user/code/web/{long}"),
        );
    }
    let scanner = scanner(source.clone());
    let first = scanner.scan().await.unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(
        first[0].name.as_deref(),
        Some("development-server-entry-point secretpass")
    );
    assert_eq!(first[0].folder.as_deref(), Some(long.as_str()));
    {
        let mut source = source.lock().unwrap();
        assert!(!source.calls.iter().any(|path| path.ends_with("/environ")));
        source.calls.clear();
        source.process("100", "node\0/repo/changed\0dev", "/home/user/code/api");
    }
    assert_eq!(scanner.scan().await.unwrap(), first);
    assert_eq!(
        source.lock().unwrap().calls,
        ["/proc/net/tcp", "/proc/net/tcp6"]
    );
    {
        let mut source = source.lock().unwrap();
        source.sockets("101");
        source.process(
            "101",
            "vite --token FAKE_TOKEN_42",
            "/home/user/code/web/app",
        );
    }
    let next = scanner.scan().await.unwrap();
    assert_eq!(next[0].name, None);
    assert_eq!(next[0].folder.as_deref(), Some("app"));
}

#[tokio::test]
async fn caches_unreadable_metadata_and_propagates_table_failures_without_replacing_the_cache() {
    let source = Arc::new(Mutex::new(Proc::default()));
    {
        let mut source = source.lock().unwrap();
        source.sockets("100");
        source.process("100", "node\0/repo/server\0dev", "/home/user/code/web/app");
        source.reads.remove("/proc/10/cmdline");
        source.links.remove("/proc/10/cwd");
        source.links.remove("/proc/10/exe");
    }
    let scanner = scanner(source.clone());
    let first = scanner.scan().await.unwrap();
    assert_eq!(
        (first[0].name.clone(), first[0].folder.clone()),
        (None, None)
    );
    {
        let mut source = source.lock().unwrap();
        source.process(
            "100",
            "node\0/repo/readable\0dev",
            "/home/user/code/web/app",
        );
        source.reads.remove("/proc/net/tcp6");
    }
    assert!(scanner.scan().await.is_err());
    source.lock().unwrap().sockets("100");
    assert_eq!(scanner.scan().await.unwrap(), first);
}
