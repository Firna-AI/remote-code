//! Commands stay in wire order while the initial reports wait.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner::error::Result;
use cnd_runner::runtime::{CommandHandler, Runner, RunnerCore};
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerControlCommand, RunnerInterrupt};
use futures_util::future::BoxFuture;
use tokio::sync::{Notify, watch};

use crate::support::fixture::{FixedClock, Fixture};

struct HeldReports {
    started: Notify,
    release: Arc<Notify>,
    commands: Mutex<Vec<String>>,
    stop: watch::Sender<bool>,
}

#[async_trait]
impl CommandHandler for HeldReports {
    fn connected(&self) -> BoxFuture<'static, Result<()>> {
        self.started.notify_one();
        let release = self.release.clone();
        Box::pin(async move {
            release.notified().await;
            Ok(())
        })
    }

    fn command(&self, command: RunnerCommand) -> Result<()> {
        let RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
            RunnerInterrupt::Interrupt { command_id, .. },
        )) = command
        else {
            panic!("expected interrupt");
        };
        let mut commands = self.commands.lock().unwrap();
        commands.push(command_id);
        if commands.len() == 2 {
            self.stop.send(true).unwrap();
        }
        Ok(())
    }

    async fn shutdown(&self) -> Result<()> {
        self.release.notify_one();
        Ok(())
    }
}

#[tokio::test]
async fn dispatches_commands_in_wire_order_while_initial_reports_wait() {
    let h = Fixture::new().await;
    let (stop, receiver) = watch::channel(false);
    let handler = Arc::new(HeldReports {
        started: Notify::new(),
        release: Arc::new(Notify::new()),
        commands: Mutex::new(vec![]),
        stop,
    });
    let core: Arc<dyn Runner> = Arc::new(RunnerCore::new(
        h.link.clone(),
        h.store.clone(),
        Arc::new(FixedClock),
        handler.clone(),
    ));
    let running = tokio::spawn(async move { core.run(receiver).await });
    handler.started.notified().await;
    for id in ["first", "second"] {
        h.endpoint.raw(serde_json::to_vec(&serde_json::json!({"type":"interrupt","commandId":id,"sessionId":"s","turnId":"t"})).unwrap()).await;
    }
    running.await.unwrap().unwrap();
    assert_eq!(*handler.commands.lock().unwrap(), vec!["first", "second"]);
    assert_eq!(h.store.snapshot().await.confirmed_through, 0);
}
