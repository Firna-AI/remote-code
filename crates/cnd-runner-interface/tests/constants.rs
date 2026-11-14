//! Keep runtime TypeScript constants aligned with Rust protocol budgets.

#![expect(
    clippy::unwrap_used,
    reason = "Missing runtime constants must stop the test."
)]

use cnd_runner_interface::{chat_events, file_tree, files, ports, runner_handshake};

#[test]
fn typescript_and_rust_share_protocol_version_and_budgets() {
    let runner = include_str!("../../../src/shared/runner.ts");
    let chat = include_str!("../../../src/shared/chat-events.ts");
    let file = include_str!("../../../src/shared/files.ts");
    let port = include_str!("../../../src/shared/ports.ts");
    let constants = [
        (
            runner,
            "RUNNER_PROTOCOL_VERSION",
            u64::from(runner_handshake::RUNNER_PROTOCOL_VERSION),
        ),
        (
            runner,
            "RUNNER_EVENT_MAX_BYTES",
            runner_handshake::RUNNER_EVENT_MAX_BYTES,
        ),
        (
            chat,
            "TOOL_DETAIL_MAX_BYTES",
            chat_events::TOOL_DETAIL_MAX_BYTES,
        ),
        (
            chat,
            "TURN_COMPLETED_MAX_FILES",
            chat_events::TURN_COMPLETED_MAX_FILES,
        ),
        (
            chat,
            "TURN_COMPLETED_FILES_MAX_BYTES",
            chat_events::TURN_COMPLETED_FILES_MAX_BYTES,
        ),
        (
            file,
            "FILE_EVENT_MAX_BYTES",
            file_tree::FILE_EVENT_MAX_BYTES,
        ),
        (
            file,
            "FILE_TREE_DELTA_MAX_CHANGES",
            file_tree::FILE_TREE_DELTA_MAX_CHANGES,
        ),
        (file, "FILE_READ_MAX_BYTES", files::FILE_READ_MAX_BYTES),
        (port, "PORT_REPORT_MAX_PORTS", ports::PORT_REPORT_MAX_PORTS),
        (
            port,
            "PORT_NAME_MAX_CHARACTERS",
            ports::PORT_NAME_MAX_CHARACTERS,
        ),
        (
            port,
            "PORT_FOLDER_MAX_CHARACTERS",
            ports::PORT_FOLDER_MAX_CHARACTERS,
        ),
    ];
    for (source, name, expected) in constants {
        let prefix = format!("export const {name} = ");
        let line = source
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .unwrap();
        let literal: String = line
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '_')
            .filter(|c| *c != '_')
            .collect();
        assert_eq!(literal.parse::<u64>().unwrap(), expected, "{name}");
    }
}
