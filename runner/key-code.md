# Agent runner: key code

This guide belongs to the [agent runner](README.md).

- [runner_command.rs](../crates/cnd-cli/src/runner_command.rs) composes the installed Rust runtime.
- [config.rs](../crates/cnd-runner/src/config.rs) parses service settings and the saved-state path.
- [runtime.rs](../crates/cnd-runner/src/runtime.rs) owns retries and shutdown.
- [link](../crates/cnd-runner/src/link/) owns hello, welcome, confirmations, and replay.
- [state](../crates/cnd-runner/src/state/) owns the Node-compatible atomic state file and recovered turns.
- [engine](../crates/cnd-runner/src/engine/) owns each session actor, input, helper handoffs, and turn completion.
- [filter](../crates/cnd-runner/src/filter/) masks credentials before event limits and storage.
- [helper](../crates/cnd-runner/src/helper/) drives the private Node child and confirms a release after its first welcome.
- [reports](../crates/cnd-runner/src/reports/) serializes scans, revisions, retained replies, and bounded parts.
- [repository](../crates/cnd-runner/src/repository/) owns safe file access and Git comparisons.
- [ports](../crates/cnd-runner/src/ports/) reads stable listening ports and complete selected labels.
- [watcher](../crates/cnd-runner/src/watcher/) reopens watches after disk restore and schedules scans.
- [cnd-relay](../crates/cnd-relay/README.md) owns the preview relay and inherited socket.
- [SDK helper](sdk-helper/README.md#key-code) owns adapters, credentials, tools, and measurement bundles.

[Agent input](agent-input.md#key-code), [background work](background-work.md#key-code),
[file reports](file-reports.md#key-code), and [agent logins](agent-logins.md#key-code)
give the entry points of each area.
