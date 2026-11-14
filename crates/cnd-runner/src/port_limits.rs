//! Whole private port labels within the runner's conservative report budget.

use cnd_runner_interface::ports::{ListeningPort, RunnerPortsUpdated};

use crate::error::Result;
use crate::json::codec;

const PRIVATE_REPORT_MAX_BYTES: usize = 524_288;

pub(crate) fn bound(report: &mut RunnerPortsUpdated) -> Result<()> {
    let RunnerPortsUpdated::PortsUpdated { ports: sources } = report;
    let mut ports: Vec<_> = sources
        .iter()
        .map(|source| ListeningPort {
            port: source.port,
            name: None,
            folder: None,
        })
        .collect();
    let mut bytes = codec::encode(&RunnerPortsUpdated::PortsUpdated {
        ports: ports.clone(),
    })?
    .len();
    let mut omitted = false;
    for (source, target) in sources.iter().zip(&mut ports) {
        for (label, field) in [
            (&source.name, &mut target.name),
            (&source.folder, &mut target.folder),
        ] {
            if let Some(label) = label {
                let next = bytes - 4 + codec::encode(label)?.len();
                if next > PRIVATE_REPORT_MAX_BYTES {
                    omitted = true;
                    continue;
                }
                *field = Some(label.clone());
                bytes = next;
            }
        }
    }
    if omitted {
        tracing::warn!("The listening port labels exceeded the private report budget.");
    }
    *sources = ports;
    Ok(())
}
