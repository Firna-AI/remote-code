# Agent runner

The agent runner is the program of Conductive in each cloud computer, a
Boat sandbox. It runs the agents powered by Claude and Codex for one
workspace. It also reports the files and the changes of the workspace
repository and the listening ports.

The runner opens one outbound WebSocket to the workspace Durable Object.
It speaks runner protocol version 2. It sends numbered events. It gets
turns, messages, interrupts, model changes, file requests, and report
requests. [Agent runner](../docs/protocol/agent-runner.md) and
[Model gateway](../docs/protocol/model-gateway.md) state its requirements,
and the [shared contracts](../src/shared/README.md) define its messages.

The workspace refuses a runner of any other protocol version before any
command, as [Runner versions](../docs/protocol/version-pins.md#runner-versions)
says.

The `hello` advertises every login kind that this runner can run.
The Worker checks that list before dispatching a turn or message.
A login kind that a runner does not advertise gets no command, and the turn fails with recovery steps.

The service runs `/opt/conductive/current/conductive runner`.
The [Rust runner library](../crates/cnd-runner/README.md) owns the connection,
saved state, turns, reports, and output filter. Its [SDK helper](sdk-helper/README.md)
is a separate Node 24 package. The runner starts one helper child for each
agent start. Private pipes carry JSON lines. Only the helper starts the SDK adapters.

The release has three parts: `node`, `system`, and `sdk-helper`.
The runner uses the Node and helper beside its running executable.
A changed `current` link cannot mix their releases.

## What it does

[Runner behavior](behavior.md) describes turn execution, saved events,
recovery, agent settings, filtering, and shutdown.

## Background work

[Background work](background-work.md) gives how a Claude turn waits for the
background work of its agent, the note at the end of a reply, the time
limit of 30 days, the end reason, and their key code. A workspace gets
this behavior when its software update applies.

## Event limits

[Event limits](event-limits.md) gives the byte and count limits of each
event, the parts of the file reports, the unavailable file reports, and
the outbox size check.

## Report requests

The [report guide](reports.md) gives full report requests, their saved
receipts, and the listening-port scan and scheduling boundaries.

## Preview relay

The [preview relay guide](preview-relay.md) gives what the relay does, its
entry points, how it listens, its build, and its separate service with
socket activation.

## Commands

Run these commands from the repository root. Use Node 24 for the helper.

| Command | Purpose |
| --- | --- |
| `npm ci --prefix runner` | Install the helper and live-check dependencies. |
| `npm --prefix runner/sdk-helper run build` | Bundle the helper and measurement tools. |
| `npm run runner:typecheck` | Check the helper and its test support. |
| `npm run runner:test` | Run the helper tests. |
| `cargo run -p cnd-cli -- runner` | Run the Rust runner with the current shell settings. |
| `cargo test -p cnd-runner` | Check the Rust runner. |
| `cargo test -p cnd-relay` | Check the Rust relay. |

The helper build writes `sdk-helper.mjs`, `measure.mjs`, and `compare.mjs`
into `dist/sdk-helper/`. Its local package link supplies the SDK dependencies.
The helper release archive carries its runtime packages and agent programs.
The parent `runner/package.json` installs the helper for CI and holds the
WebSocket dependency of the developer live check. It contains no runner core.

The root `npm run check` keeps the helper typecheck and tests.
The separate Rust gate checks the Rust runner and static program build.

## Service

The [service guide](service/README.md) describes how each build of the org
image installs the runner as a systemd service, and how that service starts.

## Configuration

[Runner configuration](configuration.md) gives the service variables,
their defaults, and the startup failure message.

## Tests and their limits

Rust tests use controlled helper boundaries and a fake helper process.
They test transport and state with fake workspace endpoints.
Repository tests use temporary Git repositories and native filesystem watches.
The relay tests use local HTTP and WebSocket servers and socket activation.
The [crate README](../crates/cnd-runner/README.md#development) gives their commands.

Helper tests stay beside the TypeScript code as `*.test.ts`.
They use fake SDK queries, child processes, and App Servers.
The [helper README](sdk-helper/README.md) describes that boundary.
These checks need no real login, cloud account, or model request.
They do not prove the live gateway, credentials, or sandbox service.
The [live check](../image/developer-scripts.md#live-check) needs those resources.

## First-start measurements

The [first-start measurement guide](sdk-helper/scripts/README.md) describes the two
tools that time the first agent start after a resume.

## Key code

[Key code](key-code.md) lists the entry points of the runner, and the
guides that give the entry points of each part.

## Related docs

- [Architecture: sandbox software](../docs/architecture/components.md#sandbox-software)
- [Agent runner](../docs/protocol/agent-runner.md)
- [Agent runner: background work](../docs/protocol/agent-runner.md#background-work)
- [Agent runner: lost workspace updates](../docs/protocol/lost-workspace-updates.md)
- [Agent runner: listening ports](../docs/protocol/agent-runner.md#listening-ports)
- [Agents and sessions: agents](../docs/protocol/agents-and-sessions.md#agents)
- [Agent instructions](../docs/protocol/agent-instructions.md)
- [Access and security: agent logins in a sandbox](../docs/protocol/isolation.md#agent-logins-in-a-sandbox)
- [Workspaces and sandboxes: files and changes](../docs/protocol/workspace-tools.md#files-and-changes)
- [Agent tools: computer tools](../docs/protocol/agent-tools.md#computer-tools)
- [Agent tools: workspace tools](../docs/protocol/agent-tools.md#workspace-tools)
- [Shared contracts](../src/shared/README.md)
- [Backend and runner fakes](../worker/test-support/README.md)
