//! Background update requirements with no real IO.

use std::path::PathBuf;

use unimock::{MockFn, Unimock, matching};

use super::error::Error;
use super::ports::{State, StoreMock, UpdateEngine};

use super::test_support::{ClientMock, InstallerMock, engine, locked, release};

#[tokio::test]
async fn downloads_only_a_newer_release() -> Result<(), Box<dyn std::error::Error>> {
    for version in ["0.0.1", "0.0.2"] {
        let engine = engine(
            super::test_support::lock_only(),
            Unimock::new(
                ClientMock::latest
                    .some_call(matching!(_, _))
                    .returns(Ok(release(version))),
            ),
            Unimock::new(()),
            Unimock::new(()),
        );
        engine.check("0.0.2").await?;
    }
    Ok(())
}

#[tokio::test]
async fn refuses_metadata_without_a_digest() -> Result<(), Box<dyn std::error::Error>> {
    let mut latest = release("0.0.3");
    latest.sha256 = None;
    let engine = engine(
        super::test_support::lock_only(),
        Unimock::new(
            ClientMock::latest
                .some_call(matching!(_, _))
                .returns(Ok(latest)),
        ),
        Unimock::new(()),
        Unimock::new(()),
    );
    assert!(matches!(
        engine.check("0.0.2").await,
        Err(Error::MissingDigest)
    ));
    Ok(())
}

#[tokio::test]
async fn concurrent_check_does_not_read_or_download() -> Result<(), Box<dyn std::error::Error>> {
    let engine = engine(
        Unimock::new(StoreMock::lock.some_call(matching!()).returns(Ok(None))),
        Unimock::new(()),
        Unimock::new(()),
        Unimock::new(()),
    );
    assert!(matches!(engine.check("0.0.2").await, Err(Error::Busy)));
    Ok(())
}

#[tokio::test]
async fn failed_download_leaves_the_store_unchanged() -> Result<(), Box<dyn std::error::Error>> {
    let engine = engine(
        Unimock::new((
            StoreMock::lock.some_call(matching!()).returns(Ok(locked())),
            StoreMock::versions
                .some_call(matching!())
                .returns(Ok(vec![])),
            StoreMock::rejected
                .some_call(matching!(_))
                .returns(Ok(false)),
            StoreMock::state
                .some_call(matching!())
                .returns(Ok(State::default())),
        )),
        Unimock::new((
            ClientMock::latest
                .some_call(matching!(_, _))
                .returns(Ok(release("0.0.3"))),
            ClientMock::download.some_call(matching!(_)).returns(Err(
                cli_updater::Error::ReleaseServerStatus {
                    url: "https://releases.test".into(),
                    status: 503,
                },
            )),
        )),
        Unimock::new(()),
        Unimock::new(()),
    );
    assert!(matches!(
        engine.check("0.0.2").await,
        Err(Error::Internal(_))
    ));
    Ok(())
}

#[tokio::test]
async fn wrong_program_digest_never_completes_a_version() -> Result<(), Box<dyn std::error::Error>>
{
    let engine = engine(Unimock::new((
        StoreMock::lock.some_call(matching!()).returns(Ok(locked())),
        StoreMock::versions.some_call(matching!()).returns(Ok(vec![])),
        StoreMock::rejected.some_call(matching!(_)).returns(Ok(false)),
        StoreMock::state.some_call(matching!()).returns(Ok(State::default())),
        StoreMock::prepare.some_call(matching!("0.0.3")).returns(Ok(())),
        StoreMock::version_path.some_call(matching!("0.0.3")).returns(PathBuf::from("/root/versions/0.0.3")),
    )), Unimock::new((
        ClientMock::latest.some_call(matching!(_, _)).returns(Ok(release("0.0.3"))),
        ClientMock::download.some_call(matching!(_)).returns(Ok(vec![1])),
    )), Unimock::new(InstallerMock::install.some_call(matching!((_, "conductive", path, Some(_), _) if *path == std::path::Path::new("/root/versions/0.0.3/conductive")))
        .returns(Err(cli_updater::Error::ChecksumMismatch { asset_name: "program.tar.gz".into() }))), Unimock::new(()));
    assert!(matches!(
        engine.check("0.0.2").await,
        Err(Error::Internal(_))
    ));
    Ok(())
}
