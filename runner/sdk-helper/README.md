# SDK helper

The SDK helper runs Conductive's agents powered by Claude and Codex.
It is a Node 24 package below the [agent runner](../README.md).
The runner starts one helper child for each agent start.
The helper owns the SDK, agent process, and temporary credential cleanup.

## Interface

The runner writes JSON lines to stdin. The helper writes JSON lines to stdout.
Rust defines these messages in [cnd-runner-interface](../../crates/cnd-runner-interface/README.md).
Its export command writes their TypeScript into `src/generated/`.
Import each generated type directly. Never edit generated files.

Requests start an agent, send input, change model, interrupt, close, or warm the Claude binary.
Request IDs match response or error messages.
Agent events stream while a request waits. Result message lists retain their exact IDs and order.
Background note updates carry the work IDs that the active turn already named.

Close cancels pending setup. It sends SIGTERM to each agent process.
After five seconds, a process that still runs gets SIGKILL.
The close response follows agent exit and temporary credential cleanup.
The runner then waits for helper exit. Stdin EOF and termination signals use the same cleanup path.

The helper writes no state file and logs no request bytes.
Agent events reach the runner's output filter before event storage or transmission.
That filter keeps tokens and partial text across helper starts.
Malformed or incomplete lines close the transport without reporting their contents.

The [login guide](../agent-logins.md), [Codex guide](../codex-logins.md),
[agent tools guide](../agent-tools.md), and [background work guide](../background-work.md)
give the adapter behavior and its limits.

## Development

Run from the repository root with Node 24:

```sh
npm ci --prefix runner/sdk-helper
npm --prefix runner/sdk-helper run typecheck
npm --prefix runner/sdk-helper test
npm --prefix runner/sdk-helper run build
cargo run -p cnd-runner-interface --example export_bindings
```

The build writes `sdk-helper.mjs`, `measure.mjs`, and `compare.mjs` into `dist/sdk-helper/`.
A local package link lets each bundle find the SDK packages.
The parent install command installs the helper. Root `runner:typecheck` and
`runner:test` scripts check only this package.
The root lint and format commands cover both packages.
Session tests call the shipped `HelperSession` with fake providers.
They control setup, process exit, and credential cleanup with explicit signals.

The [measurement guide](scripts/README.md) describes the first-start tools.
They start adapters directly with developer credentials. They do not measure the runner or the gateway.

## Release

`node runner/sdk-helper/scripts/package.mjs OUTPUT` builds a Linux x64 archive.
It prints the SHA-256 digest and writes `sdk-helper-<sha256>.tar.gz` into `OUTPUT`.
The archive holds the helper and measurement bundles, npm runtime packages, and their pinned agent programs.
The deploy publishes it as the `sdk-helper` release part.
The separate `node` part supplies Node.

The runner selects the helper from its pinned release folder at startup.
Development builds select `dist/sdk-helper/sdk-helper.mjs`.
The Rust runner drives the helper directly. The release contains no separate runner archive.

## Key code

- [main.ts](src/main.ts) connects private stdin and stdout and handles process shutdown.
- [session.ts](src/session.ts) orders requests and cancels agent setup.
- [json-lines.ts](src/json-lines.ts) frames complete UTF-8 JSON lines.
- [read-request.ts](src/read-request.ts) and [read-output.ts](src/read-output.ts) validate boundary data.
- [claude.ts](src/providers/claude.ts) and [codex.ts](src/providers/codex.ts) start the two adapters.
- [lifetime.ts](src/providers/lifetime.ts) waits for agent exit and removes credentials.
- [test-support](test-support/) holds the fake SDK query, App Server, and provider fixtures.
- [Rust driver](../../crates/cnd-runner/src/helper/driver.rs) drives helper processes.
