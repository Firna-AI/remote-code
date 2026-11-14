# Install in a build

This guide belongs to the [sandbox software](README.md). It describes the
software step of each image build and the release installer interface.

Before this step, Git in the build sandbox copies each chosen repository
into its folder, as the
[source loader](../worker/lifecycle/repository-layout.md#the-source-loader)
says. That Git comes from the image that the build sandbox starts from.
A first build starts from a ready software image of the app software
version in its provider account. It installs the newest release after the copy.
Without that image, it starts from the provider's base image and runs the
full software step. Each later build or refresh starts from the last org
image, which holds everything that earlier builds installed. The copy uses no part of this folder's software.

In a later build or refresh, a program with root access that an earlier
install left in the org image can read the clone token of a later copy. That token can only read
its own repository, which the image already holds. The Worker revokes it
when the copy ends, as
[GitHub tokens](../docs/protocol/github-tokens.md)
says.

The [software image build](../worker/software-image/README.md) runs the same
release install command as an org build. It has no
repository or environment variable.

The software step calls `installImageSoftware`. The Worker reads the newest
release JSON before it composes that command. `CONDUCTIVE_RELEASE_SERVER`
sets its base URL. The default is `https://runner.conductive.build`.
The Worker checks the binary, target, version, HTTPS URL, and SHA-256 digest.
A failed read fails the build with a software-release error.

The release program includes the workspace CLI and MCP server.
The Worker installs no separate tool source files or launcher.

The command installs `gh`, `ttyd`, and `tmux` with apt.
It disables and masks the package's own ttyd service.
It downloads the program archive with curl, checks its digest with
`sha256sum`, and extracts `conductive` into a temporary folder.
The root command uses `umask 022`, so services that run as `user` can read the release files.
It then runs the root commands in [Release installation](#release-installation).
A failure stops the build. The temporary folder is removed on exit.
The release owns the terminal scripts and units. The build never overwrites
them with the legacy terminal installer.

Every org build and refresh installs the newest release.
A first build still uses a matching software image when one is ready.
That build also runs the release install, so a newer release can apply.
A refresh then snapshots the result without running the org install script.

A workspace without `/opt/conductive/current/conductive` bootstraps at its
next normal start. The Worker reads the release JSON when it composes the
startup command. A failed read prints a warning and leaves startup running.
The command launches a root `nohup setsid` job. Its output goes to
`/run/conductive/bootstrap.log`. Neither startup nor the runner restart waits
for its download. Disk retention starts do not bootstrap software.

The background job checks the program again under a download lock.
It verifies and extracts the bootstrap archive, then runs `update check --bootstrap`.
Activation takes `/run/conductive/bootstrap-activate.lock`.
The runner restart takes the same lock. The download never holds this lock.
Activation checks again that the program is missing, applies the release,
and confirms the initial installation with `update started`.
This confirmation clears the first pending marker, which has no previous release.
The new units take effect at the next runner start. Bootstrap starts no unit.

## Disk flushes

[Disk flushes](../docs/protocol/workspaces-and-sandboxes.md#disk-flushes) gives
the requirement. The udev rule `60-conductive-disk-cache.rules` sets
`queue/write_cache` to `write through` on each whole virtio disk, at each
boot. The kernel then sends no flush to the host, and `fsync` returns once
the host has the data. Installation changes no disk setting, so the build
sandbox keeps its flushes. The updater installs the rule from the system part.
A workspace without the updater receives it through the background bootstrap.

To check a sandbox, read `/sys/block/vda/queue/write_cache`. It reads
`write through` with the rule and `write back` without it.

## Release installation

The Worker installs releases through `conductive`. It runs these commands
as root with a verified bootstrap executable:

```sh
/path/to/bootstrap/conductive update check --bootstrap
/path/to/bootstrap/conductive update apply
/opt/conductive/current/conductive update started
```

The check command logs a warning and returns failure after a failed
download. The installation check waits for a running background check.
Background checks still return a busy error when the download lock is held.
Downloads have a one-hour total timeout and a ten-second connect timeout.
A build must stop when any command fails. A build must verify that `current/conductive` and
`current/complete` exist after apply. A build confirms the initial
installation with `update started`, because it starts no runner.
The image build still installs `gh`, `ttyd`, and `tmux` through apt.

The program uses this layout under `/opt/conductive`:

```text
current -> versions/<active-version>
previous -> versions/<previous-version>
pending                         # JSON start journal, absent after confirmation
update.lock                     # exclusive background-check lock
update-apply.lock               # exclusive apply/confirmation lock
versions/<version>/conductive
versions/<version>/parts.json
versions/<version>/sdk-helper -> /opt/conductive/parts/<sdk-helper-sha256>
versions/<version>/node -> /opt/conductive/parts/<node-sha256>
versions/<version>/system -> /opt/conductive/parts/<system-sha256>
versions/<version>/complete
rejected/<failed-version>       # persistent rejection record
parts/<sha256>/complete
parts/<sdk-helper-sha256>/sdk-helper.mjs
parts/<node-sha256>/bin/node
parts/<system-sha256>/install-system.sh
parts/<system-sha256>/*          # scripts, units, wrapper, and udev rule
```

The links use absolute targets under the configured root. The Node part
removes the archive's top folder. The SDK helper archive has its entry
point at the part root. The complete marker is written last. An interrupted check can
leave incomplete version folders and `.partial` part folders. Those
folders never qualify for apply. A later check replaces them.

Apply calls `current/system/install-system.sh`. That script installs all
release units into `/etc/systemd/system`, copies the udev rule, sets the
system Git credential helper, and links the `gh` wrapper. It also links
`/usr/local/bin/conductive` to `/opt/conductive/current/conductive`.
That program serves workspace commands, MCP, previews, Git credentials, and release updates.
The credential alias `/usr/local/bin/conductive-git-credential` links to the
same program and selects `git-credential`.
It runs
`systemctl daemon-reload` and enables the runner, relay, terminal, and
check timer. It starts no service and changes no package.

The release units are:

- `conductive-update-check.service`: root background download.
- `conductive-update-check.timer`: boot and hourly checks.
- `conductive-runner.service`: root activation in pre-start, then the Rust runner as `user`.
- `conductive-preview-relay.service` and `.socket`: Rust relay as `user`.
- `conductive-terminal.service` and `conductive-terminal-sessions.service`: terminal services as `user`.

The runner pre-start step runs apply only when `/run/conductive/workspace-ready` exists.
Relay and terminal restarts do not change the selected release.
The runner, relay, and terminal entry points use `current/system/`.
The runner executes `/opt/conductive/current/conductive runner`. It resolves
its private Node and SDK helper beside that executable. The relay executes
the active Rust program too. The system installer removes a stale process-start
confirmation unit. The Rust runner confirms the release only after its first
valid Worker `welcome`. Confirmation changes nothing unless the executable's
version matches current and pending. It reads the saved Node state file without conversion.
The next apply restores `previous` when a new release still has its pending
marker. That fallback runs the previous system installer, which restores its
units and starts the previous Rust runner on the next service attempt.
The first published Rust release uses this pre-start layout too, so its
fallback never pulls in a second activation unit. Collection after confirmation
retains current, previous, and the release that the next apply selects.
It reads the retained set under the download lock and removes other
version payloads and unused parts. Rejection records survive collection,
so a failed version cannot download or apply again.
A running download defers collection without delaying the runner.

For a separate install root or a local release server, use:

```sh
conductive update check --bootstrap --root /tmp/conductive --server http://127.0.0.1:8080
conductive update apply --root /tmp/conductive
conductive update started --root /tmp/conductive
```

`--root` changes the release store. The production system installer still
writes fixed sandbox paths. Local integration tests use a system archive
whose installer writes only inside their temporary folder.
