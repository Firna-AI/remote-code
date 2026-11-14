//! Controlled socket operations and report completion for runtime regressions.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerControlCommand, RunnerInterrupt};
use cnd_runner_interface::runner_handshake::{
    RunnerProtocolVersion, RunnerToWorkspace, RunnerWelcome, WorkspaceToRunner,
};
use futures_util::future::{BoxFuture, pending};
use tokio::sync::{Mutex, Notify, mpsc, watch};
use unimock::{MockFn, Unimock, matching};

use crate::config::ConnectionRequest;
use crate::error::{Error, Result};
use crate::link::connection::SavedRunnerLink;
use crate::runtime::{CommandHandlerMock, Runner, RunnerCore};
use crate::socket::{ConnectorMock, Socket, SocketMock};
use crate::test_support::{Memory, clock, title};

#[unimock::unimock(api = SocketWorkMock)]
trait SocketWork: Send + Sync {
    fn receive(&self) -> BoxFuture<'static, Result<Option<WorkspaceToRunner>>>;
    fn send(&self) -> BoxFuture<'static, Result<()>>;
}

struct ControlledSocket(Unimock);

#[async_trait]
impl Socket for ControlledSocket {
    async fn send(&self, _: &RunnerToWorkspace) -> Result<()> {
        SocketWork::send(&self.0).await
    }
    async fn receive(&self) -> Result<Option<WorkspaceToRunner>> {
        SocketWork::receive(&self.0).await
    }
    async fn close(&self) -> Result<()> {
        Socket::close(&self.0).await
    }
}

pub(super) struct Fixture {
    pub(super) link: Arc<SavedRunnerLink>,
    pub(super) core: Arc<dyn Runner>,
    pub(super) shutdown: watch::Receiver<bool>,
    pub(super) input: mpsc::UnboundedSender<WorkspaceToRunner>,
    pub(super) commands: mpsc::UnboundedReceiver<RunnerCommand>,
    pub(super) reports_release: Arc<Notify>,
    pub(super) reports_done: Arc<Notify>,
    pub(super) hold_sends: Arc<AtomicBool>,
    pub(super) sending: Arc<Notify>,
}

impl Fixture {
    pub(super) async fn new(report_fails: bool) -> Result<Self> {
        let store = Memory::default().store().await;
        store.append(title("saved"), 100, None).await?;
        let runtime_clock = clock();
        let (input, received) = mpsc::unbounded_channel();
        let received = Arc::new(Mutex::new(received));
        let (stop, shutdown) = watch::channel(false);
        let close_stop = stop.clone();
        let send_lock = Arc::new(Mutex::new(()));
        let close_lock = send_lock.clone();
        let hold_sends = Arc::new(AtomicBool::new(false));
        let held = hold_sends.clone();
        let sending = Arc::new(Notify::new());
        let entered = sending.clone();
        let socket: Arc<dyn Socket> = Arc::new(ControlledSocket(Unimock::new((
            SocketWorkMock::receive
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    let received = received.clone();
                    Box::pin(async move { Ok(received.lock().await.recv().await) })
                })),
            SocketWorkMock::send
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    let send_lock = send_lock.clone();
                    let entered = entered.clone();
                    let hold = held.load(Ordering::SeqCst);
                    Box::pin(async move {
                        let _sender = send_lock.lock().await;
                        if hold {
                            entered.notify_one();
                            pending::<()>().await;
                        }
                        Ok(())
                    })
                })),
            SocketMock::close
                .some_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    assert!(
                        close_lock.try_lock().is_ok(),
                        "close must release the parked send"
                    );
                    let _ = close_stop.send(true);
                    Ok(())
                })),
        ))));
        let connector = Unimock::new(
            ConnectorMock::connect
                .some_call(matching!(_))
                .returns(Ok(socket)),
        );
        let link = Arc::new(SavedRunnerLink::new(
            "workspace".into(),
            ConnectionRequest {
                url: "wss://machines.test/v1/runner".into(),
                workspace_token: "workspace-token".into(),
            },
            Arc::new(connector),
            runtime_clock.clone(),
            store.clone(),
        ));
        let reports_release = Arc::new(Notify::new());
        let reports_done = Arc::new(Notify::new());
        let release = reports_release.clone();
        let done = reports_done.clone();
        let (captured, commands) = mpsc::unbounded_channel();
        let handler = Unimock::new((
            CommandHandlerMock::start
                .some_call(matching!())
                .returns(Ok(())),
            CommandHandlerMock::connected
                .some_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    let release = release.clone();
                    let done = done.clone();
                    Box::pin(async move {
                        release.notified().await;
                        done.notify_one();
                        if report_fails {
                            Err(Error::Disconnected)
                        } else {
                            Ok(())
                        }
                    })
                })),
            CommandHandlerMock::command
                .each_call(matching!(_))
                .answers_arc(Arc::new(move |_, command| {
                    if command == interrupt("second") {
                        let _ = stop.send(true);
                    }
                    let _ = captured.send(command);
                    Ok(())
                })),
            CommandHandlerMock::shutdown
                .some_call(matching!())
                .returns(Ok(())),
        ));
        let core = Arc::new(RunnerCore::new(
            link.clone(),
            store,
            runtime_clock,
            Arc::new(handler),
        ));
        Ok(Self {
            link,
            core,
            shutdown,
            input,
            commands,
            reports_release,
            reports_done,
            hold_sends,
            sending,
        })
    }
}

pub(super) fn welcome() -> WorkspaceToRunner {
    WorkspaceToRunner::RunnerWelcome(RunnerWelcome::Welcome {
        protocol_version: RunnerProtocolVersion,
        stream_id: "stream".into(),
        confirmed_through: 0,
    })
}

pub(super) fn interrupt(id: &str) -> RunnerCommand {
    RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
        RunnerInterrupt::Interrupt {
            command_id: id.into(),
            session_id: "session".into(),
            turn_id: "turn".into(),
        },
    ))
}
