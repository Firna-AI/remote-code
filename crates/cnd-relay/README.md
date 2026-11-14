# cnd-relay

This crate provides the local preview relay for Conductive cloud computers.
Depend on it to serve HTTP and WebSocket previews through the private relay
socket. The `cnd-cli` crate composes it as `conductive relay`.

## Responsibilities

- Accept only local connections and the private hostname of the relay port.
- Connect only to addresses assigned to this sandbox.
- Stream request bodies, responses, and upgraded connections.
- Remove provider credentials and proxy headers before forwarding.
- Mark every relay reply, including failures and upgrade replies.

## What This Crate Does

The native listener consumes systemd descriptor 3 when `LISTEN_FDS=1` and
`LISTEN_PID` names this process. Otherwise, it binds `127.0.0.1:7682`.
Inherited TCP listeners must use a loopback address. Unix activation is also
supported for local integration environments.
An accept error logs a warning and waits briefly before accepting again.
The listening service and existing connections keep running.

A request must name the private provider hostname of the listening port.
Exactly one `X-Conductive-Preview-Port` header selects a decimal port from
1 to 65535. The relay refuses its own port and reserved port 7682.
The connector tries IPv4 loopback, IPv6 loopback, then local interfaces.
It establishes the connection before it consumes the request body.

The target receives `Host: localhost:<port>`. Hop headers, the target-port
header, `_port_auth`, `Forwarded`, and `X-Forwarded-*` never reach it.
Other application cookies and headers pass through. The Worker owns its
browser-facing header allowlist and origin rewrite.

Hyper and Tokio stream HTTP/1 bodies without a request timeout or a full-body
buffer. An upgraded connection forwards bytes in both directions, including
bytes already read with the handshake. Disconnects close the related
connection. `X-Conductive-Relay: 1` replaces any upstream mark.

## Quick Start

```sh
cargo run -p cnd-cli -- relay
```

The command needs no workspace settings. The release installs and enables
its separate service and socket. A runner restart does not restart it.

## Development

```sh
cargo test -p cnd-relay
cargo test -p cnd-cli --test relay_activation_tests
cargo clippy -p cnd-relay --all-targets -- -D warnings
```

Tests use real local servers on free ports. The address fallback test needs
an assigned nonloopback IPv4 address. The activation test needs
`systemd-socket-activate`, but no running systemd manager.
The accept-error regression test uses a mocked listener and a paused clock.
The relay start script accepts an optional executable path for isolated checks.
The installed service uses the default executable path.

### Key Code

- [server.rs](src/server.rs): `Server` and `RelayServer` accept and cancel connections.
- [proxy.rs](src/proxy.rs): `Proxy` and `RelayProxy` stream HTTP and tunnel upgrades.
- [listener.rs](src/listener.rs): `Listener` and `NativeListener` own private sockets.
- [connect.rs](src/connect.rs): `Connector` and `LocalConnector` restrict targets to this sandbox.
- [headers.rs](src/headers.rs): request validation and header filtering.
- [body.rs](src/body.rs): response ownership closes unfinished upstream work.

### Related Docs

- [Preview relay](../../runner/preview-relay.md) describes service installation.
- [Preview security](../../docs/protocol/terminal-previews-and-desktop.md#port-previews) states the proxy rules.
- [Port previews](../../docs/protocol/port-previews.md) states the product requirements.
- [Architecture](../../docs/architecture.md) describes the system.
