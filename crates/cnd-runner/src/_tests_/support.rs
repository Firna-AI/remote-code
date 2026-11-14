//! Shared pure events and a unimock-backed memory disk.

#![allow(clippy::unwrap_used)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use cnd_runner_interface::agents::Agent;
use cnd_runner_interface::runner::{RunnerEvent, RunnerWorkspaceTitle};
use unimock::{MockFn, Unimock, matching};

use crate::clock::{Clock, ClockMock};
use crate::disk::{Disk, DiskMock};
use crate::error::Error;
use crate::state::records::SavedSession;
use crate::state::store::{DurableStore, EventStore};

#[derive(Clone, Default)]
pub(crate) struct Memory {
    pub(crate) bytes: Arc<Mutex<Option<Vec<u8>>>>,
    pub(crate) fail: Arc<AtomicBool>,
}

impl Memory {
    pub(crate) fn disk(&self) -> Arc<dyn Disk> {
        let read = self.bytes.clone();
        let write = self.bytes.clone();
        let fail = self.fail.clone();
        Arc::new(Unimock::new((
            DiskMock::read
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| Ok(read.lock().unwrap().clone()))),
            DiskMock::write
                .each_call(matching!(_))
                .answers_arc(Arc::new(move |_, bytes| {
                    if fail.swap(false, Ordering::SeqCst) {
                        return Err(Error::Disconnected);
                    }
                    *write.lock().unwrap() = Some(bytes.to_vec());
                    Ok(())
                })),
        )))
    }

    pub(crate) async fn store(&self) -> Arc<dyn EventStore> {
        let store: Arc<dyn EventStore> = Arc::new(DurableStore::new(self.disk(), "stream".into()));
        store.load().await.unwrap();
        store
    }
}

pub(crate) fn clock() -> Arc<dyn Clock> {
    Arc::new(Unimock::new(
        ClockMock::now.each_call(matching!()).answers(&|_| Ok(100)),
    ))
}

pub(crate) fn title(name: &str) -> RunnerEvent {
    RunnerEvent::RunnerWorkspaceTitle(RunnerWorkspaceTitle::WorkspaceTitle { name: name.into() })
}

pub(crate) fn session() -> SavedSession {
    SavedSession {
        session_id: "session".into(),
        agent: Agent::Claude,
        provider_session_id: Some("conversation".into()),
        instructions: Some("saved instructions".into()),
        instruction_branches: Some(None),
    }
}
