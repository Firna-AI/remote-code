//! Background work waits, input receipts, and handoff deadlines.

use std::sync::atomic::Ordering;
use std::time::Duration;

use cnd_runner::runtime::CommandHandler;
use cnd_runner_interface::provider_events::{ProviderEvent, ProviderResultState};
use serde_json::json;

use super::builders::{message, turn};
use super::support::{Fixture, TestResult};

const LIMIT: Duration = Duration::from_secs(30 * 24 * 60 * 60);

async fn wait(h: &Fixture) -> TestResult {
    let helper = h.latest()?;
    helper.event(ProviderEvent::Background {
        live: true,
        idle: false,
    });
    helper.result(&[]);
    helper.event(ProviderEvent::Activity { idle: true });
    h.engine.idle().await?;
    assert_eq!(h.events().await.len(), 1);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn ends_a_thirty_day_wait_and_preserves_the_deadline_through_active_handoff() -> TestResult {
    for handoff in [false, true] {
        let h = Fixture::new().await?;
        h.command(turn("session", "first")?).await?;
        wait(&h).await?;
        h.advance(Duration::from_secs(1)).await;
        if handoff {
            let first = h.latest()?;
            first.event(ProviderEvent::Activity { idle: false });
            h.engine.idle().await?;
            first.deferred.store(true, Ordering::SeqCst);
            h.command(message("session", "first", "next")?).await?;
            first.result(&[]);
            h.engine.idle().await?;
            assert!(first.closed.load(Ordering::SeqCst));
        }
        h.advance(LIMIT - Duration::from_secs(1)).await;
        if handoff {
            h.engine.idle().await?;
            assert_eq!(h.events().await.len(), 1);
            h.latest()?.result(&["message-next"]);
        }
        h.wait_events(2).await;
        h.engine.idle().await?;
        let end = serde_json::to_value(h.events().await)?;
        assert_eq!(end[1]["endReason"], "background_work_limit");
        assert_eq!(end[1]["durationMs"], LIMIT.as_millis() as u64);
        assert!(h.latest()?.closed.load(Ordering::SeqCst));
        h.close().await?;
    }
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn resets_only_waiting_input_and_does_not_acknowledge_input_on_wakeup() -> TestResult {
    for active in [false, true] {
        let h = Fixture::new().await?;
        h.command(turn("session", "first")?).await?;
        wait(&h).await?;
        h.advance(Duration::from_secs(1)).await;
        let helper = h.latest()?;
        if active {
            helper.event(ProviderEvent::Activity { idle: false });
            h.engine.idle().await?;
        }
        h.command(message("session", "first", "next")?).await?;
        helper.event(ProviderEvent::WakeUp {
            state: ProviderResultState::Finished,
        });
        h.engine.idle().await?;
        assert_eq!(h.events().await.len(), 1);
        helper.result(&["message-next"]);
        helper.event(ProviderEvent::Activity { idle: true });
        h.engine.idle().await?;
        h.advance(LIMIT - Duration::from_secs(1)).await;
        h.engine.idle().await?;
        if !active {
            assert_eq!(h.events().await.len(), 1);
            h.advance(Duration::from_secs(1)).await;
        }
        h.wait_events(2).await;
        let end = serde_json::to_value(h.events().await)?;
        assert_eq!(
            end[1]["durationMs"],
            LIMIT.as_millis() as u64 + if active { 0 } else { 1000 }
        );
        assert_eq!(
            end[1]["userMessageIds"],
            json!(["message-first", "message-next"])
        );
        h.close().await?;
    }
    Ok(())
}

#[tokio::test]
async fn starts_deferred_waiting_input_without_another_result_and_waits_for_final_idle()
-> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    wait(&h).await?;
    let first = h.latest()?;
    first.deferred.store(true, Ordering::SeqCst);
    h.command(message("session", "first", "next")?).await?;
    assert!(first.closed.load(Ordering::SeqCst));
    let helper = h.latest()?;
    helper.event(ProviderEvent::Background {
        live: true,
        idle: false,
    });
    helper.result(&["message-next"]);
    helper.event(ProviderEvent::Activity { idle: false });
    helper.event(ProviderEvent::Background {
        live: false,
        idle: false,
    });
    helper.event(ProviderEvent::WakeUp {
        state: ProviderResultState::Finished,
    });
    h.engine.idle().await?;
    assert_eq!(h.events().await.len(), 1);
    helper.event(ProviderEvent::Activity { idle: true });
    h.engine.idle().await?;
    assert_eq!(h.events().await.len(), 2);
    h.close().await
}

#[tokio::test(start_paused = true)]
async fn resets_the_wait_from_receipt_even_when_the_session_queue_is_held() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    wait(&h).await?;
    h.advance(Duration::from_secs(1)).await;
    let helper = h.latest()?;
    helper.model_gate.hold();
    let choice = helper
        .options
        .lock()
        .map_err(|_| "test lock poisoned")?
        .as_ref()
        .ok_or("No options")?
        .choice
        .clone();
    h.engine.command(
        cnd_runner_interface::runner_commands::RunnerCommand::RunnerControlCommand(
            cnd_runner_interface::runner_commands::RunnerControlCommand::RunnerChangeModel(
                cnd_runner_interface::runner_commands::RunnerChangeModel::Model {
                    command_id: "model".into(),
                    session_id: "session".into(),
                    choice,
                },
            ),
        ),
    )?;
    helper.model_gate.entered.notified().await;
    h.engine.command(message("session", "first", "next")?)?;
    h.advance(Duration::from_secs(1)).await;
    helper.model_gate.release();
    h.engine.idle().await?;
    helper.result(&["message-next"]);
    helper.event(ProviderEvent::Activity { idle: true });
    h.engine.idle().await?;
    h.advance(LIMIT - Duration::from_secs(1)).await;
    h.wait_events(2).await;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["durationMs"],
        LIMIT.as_millis() as u64 + 1000
    );
    h.close().await
}
