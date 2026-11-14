//! Accept errors leave the relay alive and retry after a bounded delay.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::poll;
use unimock::{MockFn, Unimock, matching};

use crate::error::{Error, Result};
use crate::listener::ListenerMock;
use crate::server::{RelayServer, Server};

#[tokio::test(start_paused = true)]
async fn keeps_accepting_after_an_injected_accept_failure() -> Result<()> {
    let attempts = Arc::new(AtomicUsize::new(0));
    let listener = Unimock::new((
        ListenerMock::port.some_call(matching!()).returns(Ok(7682)),
        ListenerMock::accept
            .each_call(matching!())
            .answers_arc({
                let attempts = attempts.clone();
                Arc::new(move |_| {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(Error::Unavailable)
                })
            })
            .at_least_times(1),
    ));
    let server = RelayServer {
        listener: Arc::new(listener),
        proxy: Arc::new(Unimock::new(())),
    };
    let mut serving = Box::pin(server.run());
    assert!(
        poll!(serving.as_mut()).is_pending(),
        "accept error stopped the relay"
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(poll!(serving.as_mut()).is_pending());
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    Ok(())
}
