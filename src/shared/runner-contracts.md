# Runner contracts

This page belongs to the [shared contracts](README.md).

The [runner interface crate](../../crates/cnd-runner-interface/README.md)
defines the versioned handshake, commands, numbered events, confirmations,
and resend rules. Its Rust comments state the delivery contract.
`ts-rs` generates their TypeScript into `generated/`.
Every importer uses the generated types directly.
`runner.ts` keeps runtime constants and login capability helpers.
Run `cargo run -p cnd-runner-interface --example export_bindings` from the
repository root to regenerate and format every type.
[Repository rules](../../AGENTS.md#repository-rules) state the number and date wire forms.
`RUNNER_PROTOCOL_VERSION` is 2, and `RunnerProtocolVersion` is that one
version. The packaged runner sends it, and each full image build records it.
The Worker accepts only that version. It closes a runner of any other
version before the `welcome` and before any command, as
[Runner versions](../../docs/protocol/version-pins.md#runner-versions) says.
The `welcome` repeats the version of the runner's `hello`.
The optional `hello.loginKinds` declares the login kinds the runner can use.
`runnerSupportsLogin` reads that list. A runner without the list can use
each login kind except a Codex ChatGPT sign-in.
The credential of a turn belongs to the session starter, whoever sent the
message:

- `RunnerTurn` carries a turn token in `credential`, with the agent and
  the login kind. A Codex ChatGPT credential also carries public account
  claims for its temporary login file.
- `RunnerMessageDuringTurn` carries no credential.
- No runner command carries a real agent login.

`RunnerTurnCredential.promptCacheTtl` is optional and accepts only `'1h'`.
The Worker sets it only for Claude own endpoint turns, which keep the `api-key` kind.
The runner ignores unknown values. A runner from before this field ignores it.
Neither requires a new protocol version.

`RunnerCommand` and `WorkspaceToRunner` cover the commands and the other
messages that the workspace sends to the runner.
The [model gateway](../../worker/model-gateway/README.md#model-requests)
gives the form of a turn token.

`account.ts` defines the start and poll contracts of the Codex device code
sign-in. Replies contain the public code and state, never the sign-in tokens.
`RUNNER_EVENT_MAX_BYTES` limits the complete serialized runner event envelope.
The 1 MiB limit leaves room for the workspace storage wrapper.
The workspace stores a refusal marker before it confirms a permanent refusal.
Storage and network failures remain unconfirmed.
After a refused file tree, changes list, start steps, workspace name, or port list,
`RunnerReportRefresh` asks for one fresh full report of that `RunnerReportKind`.
It carries no login and no turn token. A redelivery keeps its command ID.
`generated/` contains `ListeningPort` and `RunnerPortsUpdated`.
`ports.ts` keeps the browser report phase and runtime limits.
`RunnerPortsUpdated` carries complete selected private labels.
`PortsUpdated` carries final filtered display labels, with a null list when
there is no current report. The display limits apply only after the workspace
filter. The module owns those limits and the shared count limit.
`terminal.ts` owns `TERMINAL_PORT`, shared by the runner exclusion
and the terminal backend.
[Listening ports](../../docs/protocol/agent-runner.md#listening-ports) states
that report, its limits, and its refresh kind.
`runner-transport.ts` defines the Worker's in-memory runner test socket boundary.
`RunnerConnection` and `RunnerConnector` take the type of the Worker's
messages.
Browser response types carry no login and no turn token.
`RunnerTurn` and `RunnerMessageDuringTurn` carry the current `branches`: the workspace branch and the target branch.
The current Worker always sends them. A command of an older producer can omit them.
Turn commands also carry the commit author of the member whose message started the turn.
Message commands carry no commit author.
An uploaded attachment reaches the runner as a path, after the backend puts it there.
