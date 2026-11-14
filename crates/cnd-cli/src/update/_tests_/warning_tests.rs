//! A failed background check emits a warning and returns its failure.

use std::cell::RefCell;
use std::sync::{
    Arc, Once,
    atomic::{AtomicUsize, Ordering},
};

use tracing::{Event, Level};
use tracing_subscriber::{Layer, Registry, layer::Context, prelude::*};
use unimock::{MockFn, Unimock, matching};

use super::error::Error;
use super::ports::UpdateEngine;
use super::test_support::{ClientMock, engine, lock_only};

thread_local! {
    static CAPTURE: RefCell<Option<Arc<AtomicUsize>>> = const { RefCell::new(None) };
}

static SUBSCRIBER: Once = Once::new();

struct Warnings;
struct Capture;

impl Drop for Capture {
    fn drop(&mut self) {
        CAPTURE.with(|capture| *capture.borrow_mut() = None);
    }
}

impl Layer<Registry> for Warnings {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, Registry>) {
        if *event.metadata().level() == Level::WARN {
            CAPTURE.with(|capture| {
                if let Some(warnings) = &*capture.borrow() {
                    warnings.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    }
}

#[tokio::test]
async fn failed_release_read_logs_a_warning_and_keeps_the_release() {
    let warnings = Arc::new(AtomicUsize::new(0));
    SUBSCRIBER.call_once(|| {
        assert!(
            tracing::subscriber::set_global_default(Registry::default().with(Warnings)).is_ok()
        );
    });
    CAPTURE.with(|capture| *capture.borrow_mut() = Some(warnings.clone()));
    let _capture = Capture;
    let engine = engine(
        lock_only(),
        Unimock::new(ClientMock::latest.some_call(matching!(_, _)).returns(Err(
            cli_updater::Error::ReleaseServerStatus {
                url: "https://releases.test".into(),
                status: 503,
            },
        ))),
        Unimock::new(()),
        Unimock::new(()),
    );
    assert!(matches!(
        engine.check("0.0.2").await,
        Err(Error::Internal(_))
    ));
    assert_eq!(warnings.load(Ordering::Relaxed), 1);
}
