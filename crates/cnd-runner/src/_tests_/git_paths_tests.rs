//! Parent-kind caching rejects Git descendants and preserves permission failures.

#![allow(clippy::unwrap_used)]

use std::collections::BTreeSet;
use std::sync::Arc;

use unimock::{MockFn, Unimock, matching};

use crate::repository::error::Error;
use crate::repository::io::{PathKind, RepositoryIo, RepositoryIoMock};
use crate::repository::paths::{EntryState, GitPathClassifier, GitPaths};

#[tokio::test]
async fn caches_parent_kinds_without_following_links_and_propagates_permission_errors() {
    let io: Arc<dyn RepositoryIo> = Arc::new(Unimock::new((
        RepositoryIoMock::kind
            .some_call(matching!((path) if path.to_str() == Some("/repo/parent")))
            .returns(Ok(PathKind::Link)),
        RepositoryIoMock::kind
            .some_call(matching!((path) if path.to_str() == Some("/repo/blocked")))
            .returns(Err(Error::internal(std::io::Error::from(
                std::io::ErrorKind::PermissionDenied,
            )))),
    )));
    let mut paths: Box<dyn GitPaths> = Box::new(GitPathClassifier::new(
        "/repo".into(),
        io,
        BTreeSet::new(),
        BTreeSet::new(),
    ));
    assert_eq!(
        paths.classify("parent/a").await.unwrap().entry,
        EntryState::Absent
    );
    assert_eq!(
        paths.classify("parent/b").await.unwrap().kind,
        PathKind::Absent
    );
    assert!(matches!(
        paths.classify("blocked/child").await,
        Err(Error::Internal(_))
    ));
}
