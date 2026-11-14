# cnd-runner

This crate provides the runner connection, repository reports, and agent
turn engine for Conductive. Depend on it to compose a full workspace runner.
The [interface crate](../cnd-runner-interface/README.md) owns its wire types.
The `conductive runner` command composes this crate. The installed service runs `/opt/conductive/current/conductive runner`.

## Responsibilities

- Open an authenticated outbound TLS WebSocket and send the version 2 hello.
- Save numbered events before sending them. Keep unconfirmed events across restarts.
- Process welcome, confirmations, gaps, resends, and connection retries.
- Keep conversation references, instructions, file revisions, turn records, and report receipts.
- Read and write the existing Node state file format without a migration.
- Read safe repository files and compare Git changes through private indexes and objects.
- Send bounded file reports and stable listening-port reports.
- Watch recursive repository changes and repair watches after a restore.
- Prepare ignored context storage, including linked Git worktrees.
- Run independent sessions through private Node SDK helper processes.
- Filter credentials before saving chat output and preparing report labels.
- Cancel pending turns, helper requests, and repository reads on Stop or shutdown.

## What This Crate Does

A store has pending state and committed state. A failed save rejects its
call and keeps its pending changes. Later saves write the complete pending
state. Sends and resends read only committed events. A confirmation removes
an accepted turn record only when it covers the turn's end.

Recovery appends one stopped end for each unfinished saved turn. A recovered
started turn marks its files as unavailable. A saved end keeps its original
number and payload. Recovery starts no agent.

The event emitter retries pending agent output and terminal events once.
A failed output retry permits the turn to continue. A failed start still
reaches its caller. The caller supplies events after its credential filter.
This crate bounds tool details, whole turn-file prefixes, file payloads,
and complete envelopes. The shared credential filter keeps tokens in process
memory. It holds incomplete streamed prefixes and preserves operational paths
and file contents. Report labels use the same filter before byte limits.

The socket accepts HTTPS or WSS endpoints and uses rustls with public roots.
It repairs lone UTF-16 surrogate escapes to U+FFFD before typed decoding.
It preserves valid pairs and literal escaped backslashes. Integer dates,
counts, and event numbers must fit JavaScript's safe integer range.

The runtime retries a dropped or failed connection after one second.
Its command handler owns full reports, readiness, commands, and live-turn
shutdown. These operations can run while the socket handles confirmations.
The handler queues commands in wire order. It must stop its work when shutdown starts.
The runtime keeps each socket step across report completions.
A failed report releases that step before closing the socket.

The repository runs Git child processes with literal paths and cancellation.
Comparisons preserve the real index and object store. Reads check the opened
descriptor, reject escaped paths and Git metadata, and preserve binary bytes.
Diffs use Git representations, including filters, link text, and submodules.

File reports keep separate tree and changes histories. Filtering runs on each
complete report before splitting. Multipart reports keep whole entries and
independent revisions. Report repair saves the answer and request receipt
together. Retained reports select the newest pending state under the store lock.

Port scans inspect Linux socket tables and process metadata. They never read
process environments. Reports require two successful scans for additions and
removals. Complete labels stay cached for each socket identity.
Native watches debounce file events by 100 ms. Restore polling reopens the
live repository path once. Port scans run on an independent two-second timer.

## Quick Start

Run the connection and state tests from the repository root:

```sh
cargo test -p cnd-runner
```

Compose `Arc<dyn Disk>`, `Arc<dyn EventStore>`, `Arc<dyn Clock>`,
`Arc<dyn Connector>`, and `Arc<dyn RunnerLink>`. Give `DurableStore` a fresh
random stream ID for a missing file. Call `EventStore::load` once before
sharing the store. An existing file supplies its saved stream ID.
Give `RunnerCore` the loaded store, link, clock, and a `CommandHandler`.
Drive `Runner::run` with a Tokio watch channel for shutdown.

Compose `GitRepository` with `GitRunner` and `RepositoryIo` boundaries. Give
`FileReporter` the loaded file revisions and a shared `ReportFilter`.
Compose `PortReporter` with a `PortScanner`. Give `ReportCommandHandler`
these reporters, the loaded store, and the next agent command handler.
Optionally supply `ReportWatchService` with a `WatchDriver`.
The startup hook prepares context storage before the next handler warms agents.
The connection handler reserves its initial scan before returning its future.
Its startup hook starts watches before the first connection attempt.
Compose `AgentEngine` with `EngineDependencies` and the loaded state.
Supply `CredentialFilter` to reports and `FilteredEmitter` around the saving
emitter. Supply `NodeHelpers`, `GitTurnRepositories`, and `RunnerStartup`.
Use the engine as the next handler of `ReportCommandHandler`.

Each session pins its agent, instructions, and branch context. Helper
handoffs retain the first turn's token, author, tool context, conversation,
and background deadline. Result lists resolve only their named inputs.
An empty ordinary result resolves all sent inputs. A wake-up resolves none.
Claude background work can keep a turn open for thirty days from its first
wait. Member input during a wait resets the deadline from its receipt time.

Stop signals cancellation outside the session queue. Completion waits for
helper cleanup and OS exit. A canceled completion scan gets a fresh file
read with a ten-second limit. Failed saves retain their original event numbers.
The first valid welcome triggers one noninteractive sudo call to the pinned
`conductive update started` executable. The runner process remains unprivileged.
The service has no process-start release confirmation.

## Development

Run these commands from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --release --target x86_64-unknown-linux-musl -p cnd-cli
```

Unit tests use unimock at the disk, Git, process, watch, scan, and link boundaries.
Connection-loop tests hold message processing after receipt and control report completion.
Timer tests use paused Tokio time. Integration tests use temporary real Git
repositories, native watches, a controlled disk, and an in-memory endpoint.
Turn tests use controlled helper and repository boundaries. Helper transport
tests start a small Node 24 fixture through real private pipes. No test needs
an agent login or a cloud computer.
The fake endpoint models cursors, gaps, duplicates, refusal confirmations,
and connection drops. It does not run the Worker.

### Key Code

- [config.rs](src/config.rs): `Configuration::parse` reads supplied service settings.
- [store.rs](src/state/store.rs): `EventStore` defines serialized state operations.
- [records.rs](src/state/records.rs): `RunnerState` reads the existing JSON format.
- [disk.rs](src/disk.rs): `AtomicDisk` replaces the private state file atomically.
- [connection.rs](src/link/connection.rs): `SavedRunnerLink` sends hello and saved events.
- [socket.rs](src/socket.rs): `WebSocketConnector` supplies the production TLS socket.
- [emitter.rs](src/emitter.rs): `SavingEmitter` applies the failed-save retry policy.
- [runtime.rs](src/runtime.rs): `RunnerCore` recovers turns and owns reconnection and shutdown.
- [handler.rs](src/engine/handler.rs): `AgentEngine` routes turns and Stop to independent session actors.
- [service.rs](src/filter/service.rs): `CredentialFilter` filters chat, report labels, and helper warnings.
- [driver.rs](src/helper/driver.rs): `HelperConnection` correlates requests while agent events stream.
- [process.rs](src/helper/process.rs): `NodeHelpers` owns private pipes and process-group cleanup.
- [startup.rs](src/helper/startup.rs): `RunnerStartup` clears stale credentials, warms the SDK, and confirms a welcome.
- [runner_command.rs](../cnd-cli/src/runner_command.rs): the CLI composes the full runner and signal handling.
- [limits.rs](src/limits.rs): `bound_event` applies serialized chat excerpts.
- [commands.rs](src/json/commands.rs): `workspace_message` repairs and validates command JSON.
- [service.rs](src/repository/service.rs): `Repository` supplies scans, reads, diffs, and checkpoints.
- [setup.rs](src/repository/setup.rs): context setup adds the exclude rule once and creates attachment storage.
- [files.rs](src/reports/files.rs): `FileReporter` serializes captured report parts and file requests.
- [handler.rs](src/reports/handler.rs): `ReportCommandHandler` connects reports to commands and durable state.
- [prepare.rs](src/reports/prepare.rs): `ReportFilter` receives complete sources before byte limits.
- [reporter.rs](src/ports/reporter.rs): `PortReporter` keeps stable bounded port lists.
- [proc.rs](src/ports/proc.rs): `ProcPortScanner` captures Linux listeners and complete cached labels.
- [service.rs](src/watcher/service.rs): `ReportWatchService` owns watch debounce, restore repair, and port timing.

### Related Docs

- [Agent runner protocol](../../docs/protocol/agent-runner.md)
- [Lost workspace updates](../../docs/protocol/lost-workspace-updates.md)
- [Version pins](../../docs/protocol/version-pins.md)
- [Sandbox architecture](../../docs/architecture/components.md#sandbox-software)
- [Runner guide](../../runner/README.md)
- [Event limits](../../runner/event-limits.md)
- [File reports](../../runner/file-reports.md)
- [Report requests](../../runner/reports.md)
- [Workspace files and changes](../../docs/protocol/workspace-tools.md#files-and-changes)
- [Runner configuration](../../runner/configuration.md)
