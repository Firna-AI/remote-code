# cnd-runner-interface

This crate owns Conductive's runner, SDK helper, agent chat event, and
workspace tool types. Depend on it when Rust code sends or reads these messages.
The Worker, web app, Mac app, and SDK helper import its generated TypeScript.

## Responsibilities

- Keep the current runner JSON wire format stable.
- Define protocol version 2 and workspace tool messages and their dependent types once.
- Generate TypeScript with serde names, optional fields, and read-only arrays.

## What This Crate Does

The crate provides handshake messages, commands, numbered events, confirmations,
resend requests, file results, and temporary turn credentials.
The workspace tools provide workspace, session, message, repository, section,
model, preview, and Mac command requests and replies. Their replies preserve
accepted message and turn pairs, resume errors, and transcript positions.
Dependent types include workspace and session records, messages, attachments,
model choices, file reports, port reports, startup reports, and commit authors.
Browser-only events and local socket adapters remain in TypeScript.

Optional fields omit `None`. Required nullable fields serialize `None` as null.
Literal booleans and the protocol version preserve their exact JSON values.
Wire integers use JSON numbers within JavaScript's safe integer range.
Dates use Unix milliseconds. Arrays have read-only TypeScript views.
Runtime validation remains the caller's responsibility.
The shared JSON text decoder replaces lone UTF-16 surrogate escapes with
U+FFFD. Valid pairs and literal escape text remain unchanged.
The runner and workspace tools keep their own number and domain validation.

## Quick Start

```rust
use cnd_runner_interface::runner_handshake::{RunnerHello, RunnerProtocolVersion};

let hello = RunnerHello::Hello {
    protocol_version: RunnerProtocolVersion,
    workspace_id: "workspace-1".into(),
    stream_id: "stream-1".into(),
    login_kinds: None,
};
```

## Development

Run these commands from the repository root:

```sh
cargo run -p cnd-runner-interface --example export_bindings
cargo test -p cnd-runner-interface
```

The export example needs the root npm dependencies and Node 24.
It writes the Worker types to `src/shared/generated/`.
It writes helper types and their dependencies to `runner/sdk-helper/src/generated/`.
It formats both folders with Prettier.
It removes old generated files before export. Commit the generated files.
The export command does not add a gate check for generated changes.
JSON file snapshots cover every message form and optional or nullable fields.
One test compares the TypeScript runtime limits with their Rust constants.

### Key Code

- [Handshake](src/runner_handshake.rs) defines the two message directions and event envelope.
- [Commands](src/runner_commands.rs) defines turn, message, control, and report requests.
- [Credentials](src/runner_credentials.rs) defines supported logins and temporary credentials.
- [Chat events](src/chat_events.rs) defines agent events and tool output.
- [File reports](src/file_tree.rs) defines report parts, deltas, and their identities.
- [File results](src/runner_files.rs) defines read commands and their results.
- [Helper messages](src/sdk_helper.rs) defines JSON line requests and outputs.
- [Helper options](src/sdk_helper_options.rs) defines private start options and input.
- [Provider events](src/provider_events.rs) defines adapter results and background state.
- [Workspace tools](src/tools/mod.rs) defines tool payloads and the records that their replies use.
- [Wire helpers](src/wire.rs) preserves literal booleans and read-only array views.
- [JSON decoder](src/json/decoder.rs) reads JavaScript JSON strings for the runner and workspace tools.
- [Export example](examples/export_bindings.rs) registers and formats every shared type.
- [Wire snapshots](tests/wire_1.rs) starts the message serialization cases.

### Related Docs

- [Agent runner protocol](../../docs/protocol/agent-runner.md)
- [Agent tools](../../docs/protocol/agent-tools.md)
- [Chat and events](../../docs/protocol/chat-and-events.md)
- [Shared contracts](../../src/shared/README.md)
- [Architecture](../../docs/architecture.md)
