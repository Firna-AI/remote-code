//! Ports wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::wire::ReadonlyVec;

/// Complete selected labels. Only the workspace applies display excerpts after its final filter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerPortsUpdated {
    /// ports.updated.
    #[serde(rename = "ports.updated")]
    PortsUpdated {
        /// Complete selected labels. Only the workspace applies display excerpts after its final filter.
        #[ts(as = "ReadonlyVec<ListeningPort>")]
        ports: Vec<ListeningPort>,
    },
}

/// ListeningPort wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    /// port.
    #[ts(type = "number")]
    pub port: u64,
    /// name.
    pub name: Option<String>,
    /// folder.
    pub folder: Option<String>,
}

/// Shared port report max ports.
pub const PORT_REPORT_MAX_PORTS: u64 = 64;

/// Shared port name max characters.
pub const PORT_NAME_MAX_CHARACTERS: u64 = 40;

/// Shared port folder max characters.
pub const PORT_FOLDER_MAX_CHARACTERS: u64 = 120;
