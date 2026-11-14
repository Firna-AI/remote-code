//! Stop, shutdown, and recovery remain available while turn saves wait.

use std::sync::Arc;

use cnd_runner::runtime::CommandHandler;
use cnd_runner::state::store::DurableStore;
use serde_json::json;

use super::builders::{stop, turn};
use super::held_store::HeldStore;
use super::helpers::{Gate, Helpers};
use super::memory::Memory;
use super::support::{Fixture, TestResult};

#[tokio::test]
async fn ends_pending_acceptance_and_session_saves_once_without_late_starts() -> TestResult {
    for (session, shutdown) in [(false, false), (true, false), (false, true), (true, true)] {
        let memory = Arc::new(Memory::default());
        let store = Arc::new(HeldStore {
            inner: Arc::new(DurableStore::new(memory.clone(), "stream".into())),
            acceptance: Gate::default(),
            session: Gate::default(),
        });
        let gate = if session {
            &store.session
        } else {
            &store.acceptance
        };
        let h = Fixture::open(
            memory.clone(),
            Arc::new(Helpers::default()),
            Some(store.clone()),
        )
        .await?;
        gate.hold();
        h.engine.command(turn("session", "pending")?)?;
        gate.entered.notified().await;
        if session {
            let saved = h.store.snapshot().await;
            assert_eq!(saved.turns.len(), 1);
            assert_eq!(saved.turns[0].start_event_number, None);
            assert_eq!(saved.turns[0].message_ids, ["message-pending"]);
        }
        h.fail("turn.completed", 2)?;
        h.engine.command(stop("session", "pending", "stop")?)?;
        h.engine.idle().await?;
        assert_eq!(h.events().await.len(), 0);
        if shutdown {
            h.close().await?;
        } else {
            h.command(stop("session", "pending", "retry")?).await?;
        }
        assert_eq!(
            serde_json::to_value(h.events().await)?,
            json!([{"type":"turn.completed","sessionId":"session","turnId":"pending","state":"stopped","durationMs":0,"files":[],"omittedFileCount":0,"userMessageIds":[]}])
        );
        assert_eq!(
            h.helpers
                .processes
                .lock()
                .map_err(|_| "test lock poisoned")?
                .len(),
            0
        );
        gate.release();
        h.engine.idle().await?;
        h.close().await?;
        let recovered = Fixture::open(memory, Arc::new(Helpers::default()), None).await?;
        recovered.command(turn("session", "pending")?).await?;
        assert_eq!(
            recovered
                .helpers
                .processes
                .lock()
                .map_err(|_| "test lock poisoned")?
                .len(),
            0
        );
        assert_eq!(recovered.events().await.len(), 1);
        recovered.close().await?;
    }
    Ok(())
}
