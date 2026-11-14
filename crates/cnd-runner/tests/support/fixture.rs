//! Compose real store and link services over controlled external boundaries.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner::clock::Clock;
use cnd_runner::disk::Disk;
use cnd_runner::error::Result;
use cnd_runner::link::connection::SavedRunnerLink;
use cnd_runner::link::ports::RunnerLink;
use cnd_runner::state::store::{DurableStore, EventStore};

use super::disk::ControlledDisk;
use super::workspace::{Endpoint, EndpointConnector, request};

pub(crate) struct FixedClock;
#[async_trait]
impl Clock for FixedClock {
    fn now(&self) -> Result<i64> {
        Ok(100)
    }
    async fn reconnect_delay(&self) {
        tokio::task::yield_now().await;
    }
}

pub(crate) struct Fixture {
    pub disk: Arc<ControlledDisk>,
    pub store: Arc<dyn EventStore>,
    pub endpoint: Arc<Endpoint>,
    pub link: Arc<dyn RunnerLink>,
}

impl Fixture {
    pub(crate) async fn new() -> Self {
        let disk = Arc::new(ControlledDisk::default());
        let endpoint = Arc::new(Endpoint::default());
        let store = open(disk.clone()).await;
        let link = link(store.clone(), endpoint.clone());
        Self {
            disk,
            store,
            endpoint,
            link,
        }
    }

    pub(crate) async fn connected(&self) {
        self.link.connect().await.unwrap();
        assert_eq!(
            self.link.step().await.unwrap(),
            cnd_runner::link::ports::LinkUpdate::Connected
        );
    }
}

pub(crate) async fn open(disk: Arc<dyn Disk>) -> Arc<dyn EventStore> {
    let store: Arc<dyn EventStore> = Arc::new(DurableStore::new(disk, "stream".into()));
    store.load().await.unwrap();
    store
}

pub(crate) fn link(store: Arc<dyn EventStore>, endpoint: Arc<Endpoint>) -> Arc<dyn RunnerLink> {
    Arc::new(SavedRunnerLink::new(
        "workspace".into(),
        request(),
        Arc::new(EndpointConnector(endpoint)),
        Arc::new(FixedClock),
        store,
    ))
}
