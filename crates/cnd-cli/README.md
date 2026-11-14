# cnd-cli

This crate builds `conductive`, the command line program for Conductive
cloud computers. Use the executable to access its commands. This crate
also exposes the update engine through a library API.

## Responsibilities

Provide one command entry point for the agent runner, preview relay, MCP
server, Git credential helper, software updates, and workspace tools.

## What This Crate Does

The program parses command names with `clap`. `--help` and `--version`
work without runtime credentials.

`--version` prints the version embedded at build time. A deploy sets
`CONDUCTIVE_RELEASE_VERSION` to `0.0.<commit count>` and
`CONDUCTIVE_PARTS_FILE` to an absolute path to its parts JSON. Set both
variables together. The build validates the version and the parts with
`cnd-release`, then embeds both in the program. A build without the
variables uses `0.0.0-dev` and an empty parts list. This development version
sorts below every release.

The commands are `runner`, `relay`, `mcp`, `git-credential`, `update`,
`workspaces`, `sessions`, `messages`, `sections`, `repositories`, `models`,
`previews`, and `mac`. The workspace commands and `mcp` run the 24 calls in
[cnd-tools](../cnd-tools/README.md). They preserve the Worker replies and
refusal codes. `relay` serves previews through [cnd-relay](../cnd-relay/README.md).
`git-credential` supplies fresh GitHub tokens through
[cnd-credential](../cnd-credential/README.md). The installed
`conductive-git-credential` executable name selects that subcommand.
Workspace tools and Git credentials use one native saved-settings reader. It reads the saved
`WORKSPACE_TOKEN` and supplies each crate's `Environment` boundary.
Workspace tools keep explicit runtime values ahead of saved values.
The credential helper keeps the caller's turn ID even when the file has another turn.
`runner` starts the full [Rust runner](../cnd-runner/README.md). It uses the
[runner configuration](../../runner/configuration.md), plus optional
`CONDUCTIVE_NODE` and `CONDUCTIVE_SDK_HELPER` path overrides. Installed builds
resolve Node and the helper beside the running release executable. Local
builds use `node` and `dist/sdk-helper/sdk-helper.mjs` in the working folder.
SIGTERM and SIGINT end live turns, save pending events, and close the connection.
The installed service runs this Rust runner. Its first valid welcome confirms
the release through the pinned executable. It keeps the Node-format state file.

`update check` uses `cli-updater` to read and compare the newest release.
It downloads into a private version folder. It checks the program digest
through `cli-updater` and checks every part digest before extraction.
It reuses complete parts with the same digest. A failed check logs a
warning and returns failure. The independent background unit cannot block a start.
It leaves no complete version on failure. A concurrent background check returns a busy error.
An installation check with `--bootstrap` waits for the download lock.
Downloads have a one-hour total timeout and a ten-second connect timeout.

`update apply` uses no network. It switches to the newest complete version
and installs its system files. It leaves a pending marker until
`update started` confirms the runner start. Confirmation checks this executable's
version against current and pending. A different version changes nothing.
A later apply with that marker restores the previous version and its system files. A persistent rejection
record prevents that version from downloading or applying again after collection.
Collection runs after confirmation and retains current, previous, and the release that the next apply selects.
It reads that set under the download lock. It waits for no download.
Collection defers when a check holds the download lock.

All update operations accept `--root PATH` and `--server URL`.
The defaults are `/opt/conductive` and `https://runner.conductive.build`.
Checks, apply, and confirmation run as root in an installed sandbox.
`update parts` prints this program's embedded parts as JSON.
`update parts` fails for a release build whose list lacks Node, the SDK helper, or system files.
Development builds keep their empty list. Older updaters use the new program's
check and accept added JSON fields.
`update check --bootstrap` stages the first release when the bootstrap
program already has the newest version. An existing active release still
prevents a downgrade. See [the install guide](../../image/install.md#release-installation)
for the image-build sequence and the folder layout.

## Quick Start

Run these commands from the repository root:

```sh
cargo run -p cnd-cli -- --help
cargo run -p cnd-cli -- --version
cargo run -p cnd-cli -- update --help
cargo run -p cnd-cli -- update parts
```

The last command prints the embedded parts without a network request.

## Development

Run these commands from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl -p cnd-cli
```

The musl build needs a C compiler for musl. On Ubuntu, install the
`musl-tools` package. The release program is
`target/x86_64-unknown-linux-musl/release/conductive`.

### Key Code

- [main.rs](src/main.rs) connects command parsing, error output, and exit status.
- [cli.rs](src/cli.rs) owns `Cli` and the command execution boundary.
- [command.rs](src/command.rs) defines the command families and reserved arguments.
- [error.rs](src/error.rs) defines typed command errors and the internal error fallback.
- [build.rs](build.rs) validates and embeds the release inputs.
- [release.rs](src/release.rs) reads the embedded version and parts.
- [update/engine.rs](src/update/engine.rs) owns download, activation, and fallback policy.
- [update/ports.rs](src/update/ports.rs) defines disk, process, and updater boundaries.
- [update/disk.rs](src/update/disk.rs) stores complete versions and locks.
- [update_tests.rs](tests/update_tests.rs) checks real files and local HTTP downloads.
- [runner_command.rs](src/runner_command.rs) composes the full runner and graceful shutdown.
- [sandbox_command.rs](src/sandbox_command.rs) composes the relay and credential runtimes.
- [tool_command.rs](src/tool_command.rs) composes the workspace CLI and MCP runtime.
- [environment.rs](src/environment.rs) reads saved shell settings for tools and credentials.
- [relay_start_tests.rs](tests/relay_start_tests.rs) executes the relay start script with a fake program.
- [cli_tests.rs](src/_tests_/cli_tests.rs) checks relay argument parsing.

### Related Docs

- [Architecture](../../docs/architecture.md) describes the system components.
- [Agent runner](../../docs/protocol/agent-runner.md) defines the runner contract.
- [Workspaces and sandboxes](../../docs/protocol/workspaces-and-sandboxes.md) defines cloud computer behaviour.
- [Workspace tools](../../tools/README.md) describes the workspace command interface.
