# cnd-tools

This crate implements the workspace CLI and stdio MCP server of Conductive.
Use it from the `conductive` executable to call the Worker's machine routes.
Use `cnd-runner-interface` for the shared wire types.

## Responsibilities

Parse tool options. Preserve valid Unicode message text. Authenticate fixed-route HTTP
requests. Validate replies. Serve the same 24 calls through CLI and MCP.

## What This Crate Does

The CLI returns one JSON reply on stdout. Local and HTTP failures return
safe text on stderr and exit status 1. Mac command results remain JSON;
only a completed command with exit code 0 returns success. MCP returns the
same result as text and structured content, with the matching `isError`.

The server negotiates MCP `2025-11-25`. It requires initialization before
tool calls, ignores notifications, answers ping while HTTP calls wait,
and finishes outstanding replies before it exits at EOF.

The runtime uses `CONDUCTIVE_MACHINE_ORIGIN`,
`CONDUCTIVE_WORKSPACE_TOKEN`, and optional `CONDUCTIVE_TURN_ID`.
Explicit values take precedence over saved settings supplied through `Environment`.
The executable's shared reader loads `/run/ascii-secrets/env.sh` and maps
saved `WORKSPACE_TOKEN` to the runtime token field.
Help needs no credential. HTTP never follows redirects.
Worker refusal codes and messages keep their meaning, with the known
credential removed. Malformed replies and network errors use fixed text.
The shared JSON decoder replaces lone UTF-16 surrogate escapes with U+FFFD
in Worker replies and MCP tool text. Valid surrogate pairs remain unchanged.
Every MCP reply preserves its request ID exactly, including error replies.

## Quick Start

Run from the repository root:

```sh
cargo run -p cnd-cli -- workspaces list --limit 20
cargo run -p cnd-cli -- sessions send --session session-id --message-file task.md
cargo run -p cnd-cli -- mcp
```

The runner supplies runtime context for each turn. See
[workspace tool calls](../../tools/calls.md) for options and access rules.

## Development

```sh
cargo test -p cnd-tools
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

Unit tests replace HTTP, file/stdin reads, UUIDs, polling, and output with
`unimock`. Worker route tests stay in `worker/tools/` and need no Rust build.

### Key Code

- [cli.rs](src/cli.rs) exposes the `Program` boundary and composes both adapters.
- [client.rs](src/client.rs) authenticates requests and validates typed replies.
- [input](src/input/mod.rs) validates untrusted fields without changing text.
- [request.rs](src/request.rs) maps typed calls to fixed HTTP routes.
- [mcp](src/mcp/mod.rs) runs concurrent protocol requests and drains them at EOF.
- [mcp-tools.json](src/mcp-tools.json) holds the MCP descriptors and input schemas.
- [ports.rs](src/ports.rs) defines replaceable runtime and transport effects.
- [environment.rs](src/environment.rs) keeps runtime values ahead of injected saved settings.
- [runtime.rs](src/runtime.rs) implements native HTTP, input, polling, and stdio.

### Related Docs

- [Architecture](../../docs/architecture.md)
- [Agent tools](../../docs/protocol/agent-tools.md)
- [Workspace commands](../../tools/README.md)
- [Runner registration](../../runner/agent-tools.md)
