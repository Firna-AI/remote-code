//! Real Node child framing, request correlation, close, and startup cleanup.

use std::path::PathBuf;
use std::sync::Arc;

use cnd_runner::error::Error;
use cnd_runner::helper::boundary::{Helper, HelperEvents, HelperPorts, Startup};
use cnd_runner::helper::driver::HelperConnection;
use cnd_runner::helper::process::NodeHelpers;
use cnd_runner::helper::startup::RunnerStartup;
use cnd_runner_interface::provider_events::ProviderEvent;
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput};
use cnd_runner_interface::sdk_helper_options::{HelperOptions, ProviderInput};
use tokio::sync::mpsc;

use super::builders::turn;
use super::helpers::Helpers;
use super::memory::Memory;
use super::support::{Fixture, TestResult};

struct Output(mpsc::UnboundedSender<HelperOutput>);
impl HelperEvents for Output {
    fn output(&self, output: HelperOutput) {
        let _ = self.0.send(output);
    }
}
fn helpers() -> Arc<NodeHelpers> {
    Arc::new(NodeHelpers {
        node: PathBuf::from("node"),
        program: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sdk-helper.mjs"),
    })
}
async fn options(model: &str) -> std::result::Result<HelperOptions, Box<dyn std::error::Error>> {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let mut options = h
        .latest()?
        .options
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("No options")?;
    options.choice.model = model.into();
    h.close().await?;
    Ok(options)
}

#[tokio::test]
async fn correlates_out_of_order_replies_and_preserves_partial_utf8_events() -> TestResult {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let helper = Arc::new(HelperConnection::new(
        helpers().port()?,
        Arc::new(Output(sender)),
    ));
    let starting = helper.clone();
    let start_options = options("hold").await?;
    let start = tokio::spawn(async move { starting.start(start_options).await });
    assert_eq!(
        receiver.recv().await,
        Some(HelperOutput::Warning {
            message: "start held".into()
        })
    );
    assert!(!start.is_finished());
    assert_eq!(
        helper.model(options("next").await?.choice).await?,
        HelperModelResult::Deferred
    );
    start.await??;
    let cnd_runner_interface::runner_commands::RunnerCommand::RunnerTurn(command) =
        turn("session", "first")?
    else {
        return Err("No turn".into());
    };
    helper.send(ProviderInput::Turn(command)).await?;
    assert_eq!(
        receiver.recv().await,
        Some(HelperOutput::Event {
            event: ProviderEvent::Delta {
                message_id: "answer".into(),
                text: "Hello 😀".into()
            }
        })
    );
    assert!(
        matches!(helper.interrupt().await, Err(Error::Agent { code, .. }) if code == "interrupt_failed")
    );
    let (one, two) = tokio::join!(helper.close(), helper.close());
    one?;
    two?;
    assert!(matches!(
        helper.model(options("late").await?.choice).await,
        Err(Error::HelperExited)
    ));
    Ok(())
}

#[tokio::test]
async fn closes_a_pending_start_and_fails_all_requests_after_exit_or_malformed_output() -> TestResult
{
    for model in ["hold", "exit", "malformed"] {
        let port = helpers().port()?;
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let helper = Arc::new(HelperConnection::new(
            port.clone(),
            Arc::new(Output(sender)),
        ));
        let starting = helper.clone();
        let start_options = options(model).await?;
        let start = tokio::spawn(async move { starting.start(start_options).await });
        if model == "hold" {
            assert_eq!(
                receiver.recv().await,
                Some(HelperOutput::Warning {
                    message: "start held".into()
                })
            );
            helper.close().await?;
        } else {
            assert!(matches!(
                receiver.recv().await,
                Some(HelperOutput::Event {
                    event: ProviderEvent::Failed { .. }
                })
            ));
        }
        assert!(matches!(start.await?, Err(Error::HelperExited)));
        port.exited().await?;
        assert!(matches!(helper.interrupt().await, Err(Error::HelperExited)));
        helper.close().await?;
    }
    Ok(())
}

#[tokio::test]
async fn removes_only_stale_credentials_before_credential_free_warming() -> TestResult {
    let home = tempfile::tempdir()?;
    let claude = home.path().join(".conductive/anthropic/credentials");
    let codex = home.path().join(".conductive/codex/session-homes/session");
    std::fs::create_dir_all(&claude)?;
    std::fs::create_dir_all(&codex)?;
    std::fs::write(claude.join("old.json"), "secret")?;
    std::fs::write(codex.join("auth.json"), "secret")?;
    std::fs::write(codex.join(".auth-old"), "secret")?;
    std::fs::write(codex.join("config.toml"), "keep")?;
    let startup: Arc<dyn Startup> = Arc::new(RunnerStartup {
        home: home.path().to_owned(),
        helpers: helpers(),
        executable: PathBuf::from("/unused"),
    });
    startup.prepare().await?;
    assert_eq!(std::fs::read_dir(claude)?.count(), 0);
    assert!(!codex.join("auth.json").exists());
    assert!(!codex.join(".auth-old").exists());
    assert_eq!(std::fs::read_to_string(codex.join("config.toml"))?, "keep");
    Ok(())
}

#[tokio::test]
async fn runs_a_complete_turn_through_real_helper_pipes_and_saves_only_filtered_events()
-> TestResult {
    let h = Fixture::compose(
        Arc::new(Memory::default()),
        Arc::new(Helpers::default()),
        None,
        Some(helpers()),
    )
    .await?;
    let mut command = turn("session", "first")?;
    if let cnd_runner_interface::runner_commands::RunnerCommand::RunnerTurn(
        cnd_runner_interface::runner_commands::RunnerTurn::Turn { message, .. },
    ) = &mut command
    {
        message.choice.model = "complete".into();
    }
    h.command(command).await?;
    h.wait_events(4).await;
    h.engine.idle().await?;
    let events = serde_json::to_value(h.events().await)?;
    assert_eq!(events[1]["text"], "Hello [redacted] 😀");
    assert_eq!(events[2]["text"], "Hello [redacted] 😀");
    assert_eq!(events[3]["type"], "turn.completed");
    assert_eq!(
        h.store.snapshot().await.sessions[0]
            .provider_session_id
            .as_deref(),
        Some("subprocess-conversation")
    );
    let mut failing = turn("session", "exit")?;
    if let cnd_runner_interface::runner_commands::RunnerCommand::RunnerTurn(
        cnd_runner_interface::runner_commands::RunnerTurn::Turn { message, .. },
    ) = &mut failing
    {
        message.choice.model = "exit".into();
    }
    h.command(failing).await?;
    h.wait_events(6).await;
    assert_eq!(
        serde_json::to_value(h.events().await)?[5]["error"]["code"],
        "agent_exited"
    );
    let bytes = h
        .memory
        .bytes
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("No state")?;
    let saved = String::from_utf8(bytes)?;
    assert!(!saved.contains("secret-alice"));
    assert!(!saved.contains("workspace-token"));
    h.close().await
}
