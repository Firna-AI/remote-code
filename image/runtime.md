# The private Node runtime

This guide belongs to the [sandbox software](README.md).

The Rust runner starts the SDK helper with the release's private Node.
It never uses Node from `PATH`, because an org install script can replace it.
The Rust CLI, MCP server, Git credential helper, and preview relay need no Node.

[`image-runtime.ts`](../worker/lifecycle/image-runtime.ts) pins Node 24.22.2
for Linux x64. `IMAGE_NODE_RUNTIME` holds its official archive URL and
SHA-256 digest. The [Node release page](https://nodejs.org/en/blog/release/v24.22.2)
gives the digest.

The deploy embeds this archive as the `node` part. The updater verifies its
digest and removes the archive's top folder. It reuses a complete part with
the same digest. The active executable is
`/opt/conductive/current/node/bin/node`. Version folders link to the shared
content-addressed parts. Current and previous releases retain their own links.
[Release installation](install.md#release-installation) gives the layout.

## Update the Node release

1. Choose the new Node 24 release. Check its Linux x64 archive digest against
   both the release page and `https://nodejs.org/dist/v<version>/SHASUMS256.txt`.
2. Change `version` and `IMAGE_NODE_RUNTIME.sha256` in `image-runtime.ts`.
   Update the release and link on this page.
3. Package a release with that `node` part, as the
   [release crate](../crates/cnd-release/README.md#quick-start) describes.
4. Test the release in a separate sandbox. Do not run the production system
   installer on a development host. It writes fixed sandbox paths.

Each build and refresh installs the newest release. Existing workspaces
stage updates in the background and apply them before a later runner start.
