# Preview relay

This guide belongs to the [runner README](README.md#preview-relay). It
gives the preview relay of the sandbox: what it does, how it starts, and
how an image installs it.

The preview relay connects preview requests to servers in the sandbox.
It gives each server `Host: localhost:<port>`.
It streams HTTP bodies and WebSocket traffic.
It adds `X-Conductive-Relay: 1` to every response, including errors and upgrade handshakes.
It replaces any value for this header that the previewed server sends.
The Worker uses the mark to distinguish relay answers from provider answers.
The Worker removes the mark before it sends the answer to the browser.
The [preview requirements](../docs/protocol/terminal-previews-and-desktop.md#port-previews)
state its access rules.

`conductive relay` starts the Rust relay from
[cnd-relay](../crates/cnd-relay/README.md).
With one systemd descriptor for its own process ID, it listens on descriptor 3.
Without those activation variables, it listens on `127.0.0.1:7682`.
The relay uses Hyper and Tokio and ships inside the static `conductive` program.
It tries IPv4 loopback, IPv6 loopback, then the sandbox's other local addresses.
It connects before it reads the upload body, so a refused address loses no body.

Run `cargo test -p cnd-relay` for the real local HTTP and WebSocket tests.
Run `cargo test -p cnd-cli --test relay_activation_tests` for the shipped
command with `systemd-socket-activate`. That test needs no running systemd manager.

The [image installer](../image/install.md) installs a separate relay service.
It also installs and enables `conductive-preview-relay.socket`.
The socket holds port 7682 while the relay service restarts.
Both units stay enabled, so the service starts without waiting for a preview request.
A runner restart does not restart the relay.
The release system part installs its start script and units.
The script executes `/opt/conductive/current/conductive relay`.
A workspace downloads newer software in the background and applies it at a
later start, as [Release updates](../image/README.md#release-updates) describes.
