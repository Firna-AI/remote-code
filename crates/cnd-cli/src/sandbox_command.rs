//! Composition roots for the relay and Git credential command.

use std::sync::Arc;

use cnd_cli::environment::NativeEnvironment;
use cnd_credential::http::NativeHttp;
use cnd_credential::service::{Credential, CredentialService};
use cnd_credential::streams::NativeStreams;
use cnd_relay::connect::LocalConnector;
use cnd_relay::listener::NativeListener;
use cnd_relay::proxy::RelayProxy;
use cnd_relay::server::{RelayServer, Server};

use crate::error::{ErrorResultExt, Result};

pub(crate) async fn credential(mode: &str) -> u8 {
    let http = match NativeHttp::new() {
        Ok(http) => http,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let command: Arc<dyn Credential> = Arc::new(CredentialService {
        environment: Arc::new(NativeEnvironment::default()),
        http: Arc::new(http),
        streams: Arc::new(NativeStreams),
    });
    match command.execute(mode).await {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

pub(crate) async fn relay() -> Result<()> {
    let server: Arc<dyn Server> = Arc::new(RelayServer {
        listener: Arc::new(NativeListener::open().await.internal()?),
        proxy: Arc::new(RelayProxy {
            connector: Arc::new(LocalConnector),
        }),
    });
    server.run().await.internal()
}
