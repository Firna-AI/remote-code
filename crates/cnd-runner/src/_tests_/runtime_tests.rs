//! Deterministic retry scheduling and shutdown order.

#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::runner_commands::RunnerCommand;
use futures_util::future::BoxFuture;
use tokio::sync::watch;
use unimock::{MockFn, Unimock, matching};

use crate::clock::{Clock, SystemClock};
use crate::error::{Error, Result};
use crate::link::ports::RunnerLinkMock;
use crate::runtime::{CommandHandler, Runner, RunnerCore};
use crate::test_support::{Memory, clock};

#[unimock::unimock(api = HandlerMock)]
#[async_trait]
trait Handler {
    async fn start(&self) -> Result<()>;
    async fn shutdown(&self) -> Result<()>;
}

struct TestClock;
#[async_trait]
impl Clock for TestClock {
    fn now(&self) -> Result<i64> {
        clock().now()
    }
    async fn reconnect_delay(&self) {
        SystemClock.reconnect_delay().await
    }
}

struct HandlerAdapter(Unimock);
#[async_trait]
impl CommandHandler for HandlerAdapter {
    async fn start(&self) -> Result<()> {
        Handler::start(&self.0).await
    }
    fn connected(&self) -> BoxFuture<'static, Result<()>> {
        Box::pin(async { Ok(()) })
    }
    fn command(&self, _: RunnerCommand) -> Result<()> {
        Ok(())
    }
    async fn shutdown(&self) -> Result<()> {
        Handler::shutdown(&self.0).await
    }
}

#[tokio::test(start_paused = true)]
async fn reconnects_after_one_second_and_saves_before_shutdown_close() {
    let memory = Memory::default();
    let store = memory.store().await;
    let (stop, receiver) = watch::channel(false);
    let link = Unimock::new((
        HandlerMock::start.next_call(matching!()).returns(Ok(())),
        RunnerLinkMock::connect
            .next_call(matching!())
            .returns(Err(Error::Disconnected)),
        RunnerLinkMock::connect
            .next_call(matching!())
            .answers_arc(Arc::new(move |_| {
                stop.send(true).unwrap();
                Ok(())
            })),
        HandlerMock::shutdown.next_call(matching!()).returns(Ok(())),
        RunnerLinkMock::persist
            .next_call(matching!())
            .returns(Ok(())),
        RunnerLinkMock::close.next_call(matching!()).returns(Ok(())),
    ));
    let core: Arc<dyn Runner> = Arc::new(RunnerCore::new(
        Arc::new(link.clone()),
        store,
        Arc::new(TestClock),
        Arc::new(HandlerAdapter(link)),
    ));
    let running = tokio::spawn(async move { core.run(receiver).await });
    tokio::task::yield_now().await;
    tokio::time::advance(std::time::Duration::from_millis(999)).await;
    tokio::task::yield_now().await;
    assert!(!running.is_finished());
    tokio::time::advance(std::time::Duration::from_millis(1)).await;
    running.await.unwrap().unwrap();
}
