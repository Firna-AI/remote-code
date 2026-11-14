# Runner service

The [agent runner](../README.md) runs as an unprivileged systemd service.
The [release installer](../../image/install.md#release-installation) installs
its unit. Installation enables services and starts none.

The unit is [conductive-runner.service](../../image/release/conductive-runner.service).
It runs as `user`, after the network and the local update-apply unit.
Its launcher is [runner-start.sh](../../image/runner-start.sh).
The launcher loads `/run/ascii-secrets/env.sh` and checks the workspace-ready
marker, workspace identity, and disk-retention setting.
It maps sandbox settings to the [runner configuration](../configuration.md).
It then runs `/opt/conductive/current/conductive runner` in the repository folder.

The Rust executable selects its private Node and SDK helper from its own
resolved release folder. Agent children cannot mix parts after `current` changes.
The state file stays at `~/.conductive/runner-state.json` across release changes.
The Rust reader accepts the Node state format.

The runner requests a background update check after each start.
The check timer also runs after boot and every hour.
A start never waits for its download.
The next start applies a complete newer release before the runner works.

A new runner confirms its release only after its first valid `welcome`.
Its startup hook calls the resolved executable's `update started` through
noninteractive sudo. A process start alone clears no pending marker.
A later apply restores the previous executable and system files when a
new release remains unconfirmed. That previous release can still run Node.

The service restarts after failure, with a two-second delay.
SIGTERM closes helper processes and ends running turns before the connection closes.
`KillMode=control-group` keeps its child processes in the service group.
[Workspace startup](../../image/start.md) gives the build and retention gates.
