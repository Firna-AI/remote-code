# Workspace startup

This page belongs to the [sandbox software guide](README.md).
It describes the workspace environment and startup command.

## Start in a workspace

The Worker gives each workspace sandbox these variables at create and at
each resume, together with the org's env vars:

| Name | Value |
| --- | --- |
| `WORKSPACE_TOKEN` | The workspace token. |
| `CONDUCTIVE_WORKSPACE_ID` | The workspace ID. |
| `CONDUCTIVE_MACHINE_ORIGIN` | The origin of the machine hostname. |
| `CONDUCTIVE_DEFAULT_BRANCH` | The workspace base branch, with the repository default as a fallback. |
| `CONDUCTIVE_WORKSPACE_BRANCH` | The workspace branch that the app tracks, from the Worker's record of the workspace. |
| `CONDUCTIVE_REPOSITORY_DIR` | The folder of the workspace's repository, from the folder map that the workspace captured. |
| `CONDUCTIVE_REPOSITORY_<FOLDER>_DIR` | The folder of each repository of the image, with one variable for each repository. |
| `CONDUCTIVE_DISK_KEEPALIVE` | `1` in a disk retention restart, and `0` otherwise. |

The sandbox variables hold no value of an agent turn. The runner gives each
agent process the turn ID, `CONDUCTIVE_TURN_ID`, and the commit author of
the turn sender. A shell can load the sandbox variables again, as a login
shell does, and it then keeps these values. The Worker leaves out an org
env var with the name of one of these values. The
[commit author](github.md#commit-author) section says where Git gets the
owner's author outside a turn.

[Repository folders](../docs/protocol/repository-folders.md) gives the
folder names and the variable names. The
[repository layout](../worker/lifecycle/repository-layout.md) says how the
Worker makes and keeps the folder map.

The runner, the terminal launcher, and the terminal's shell server read the
variables from `/run/ascii-secrets/env.sh`, where Boat puts them. A systemd
service does not get them in another way. A Boat command process does not
get them either. So the install command of a build loads the same file,
with automatic export, before Bash runs the org's install script. The
install script then gets the folder variables.

At a create, the Worker fetches the workspace base branch into its remote-tracking ref.
It creates the workspace branch at the event commit of an opened or pushed pull request run.
A missing event commit uses the fetched head.
Other creates start at the fetched head.
The branch's `gh-merge-base` Git setting names the workspace base. When the GitHub repository has no refs, the fetch step
first pushes an empty first commit to the default branch. That push gets
its token from the [git credential helper](github.md#git-credential-helper), as every
other git operation does. At each create and each resume, the Worker then
runs the command of `workspaceStartupCommand`:

1. It writes the workspace owner's commit author to the Git system
   settings, as [Commit author](github.md#commit-author) says.
2. It writes the org's startup script to `/run/conductive/startup.sh`, with
   mode 600.
3. It runs the script with Bash in the repository folder, with the
   variables.
4. When the script succeeds, it starts a background bootstrap if the program is missing.
5. It writes `/run/conductive/workspace-ready` and restarts the runner service under the activation lock.

After that command succeeds, the Worker calls the terminal backend's start
hook. That hook starts the terminal service and its shell server. It caches
the locally generated password in encrypted form before the workspace
becomes ready.

The runner start script exits with success, and starts nothing, in these
cases:

- `CONDUCTIVE_DISK_KEEPALIVE` is `1`.
- `WORKSPACE_TOKEN` or `CONDUCTIVE_WORKSPACE_ID` is empty.
- The marker `/run/conductive/workspace-ready` does not exist.

So a build sandbox and a disk retention restart start no runner. The
terminal backend needs its own marker under `/run`, which only its
workspace start hook creates. Builds and disk retention restarts do not
call that hook, so they start no terminal and no terminal shell. A disk
retention restart runs `workspaceStartupCommand` in its `retention` mode.
That mode writes the owner's commit author and runs the startup script,
but it writes no ready marker and does not restart the runner service.

Otherwise, `runner-start.sh` runs `/opt/conductive/current/conductive runner`
in the repository folder. The Rust runner starts the SDK helper through
the private Node part. It confirms a pending release only after its first
valid Worker `welcome`. The runner unit restarts its service after
a failure. The terminal backend describes its launcher, its shell server,
its password, and its automatic restart in its
[README](../worker/terminal/README.md). That README also says how the
workspace shell keeps running when a terminal connection drops.

The preview relay runs in `conductive-preview-relay.service` as `user`.
Boat starts its enabled socket and service after each resume and fork.
The service requires `conductive-preview-relay.socket` to start first.
The socket holds `127.0.0.1:7682` while the service restarts.
Both units stay enabled, so the relay starts without waiting for a preview request.
The [preview relay guide](../runner/preview-relay.md) gives its start command.
It reads no workspace variable or workspace marker.
Its service restarts it after each exit.
A restart of the runner service does not restart the relay service.

Before it runs the runner, `runner-start.sh` sets three variables of the
runner's [configuration](../runner/README.md#configuration) from the table.
Each value replaces a saved variable of the same name.

| Runner variable | Value |
| --- | --- |
| `CONDUCTIVE_WORKSPACE_TOKEN` | `WORKSPACE_TOKEN` |
| `CONDUCTIVE_REPOSITORY` | `CONDUCTIVE_REPOSITORY_DIR` |
| `CONDUCTIVE_RUNNER_URL` | `CONDUCTIVE_MACHINE_ORIGIN` without a trailing slash, then the path of `MACHINE_PATHS.runner` |

The Worker gives no setting for the computer tools. Boat writes the entry
of the `computer` server into each sandbox at its start, and the runner
reads it, as [What it does](../runner/README.md#what-it-does) says.

## Secrets

- A build sandbox starts with no org env vars and no workspace token. It
  gets only the folder variables, which hold no secret. So no saved
  snapshot holds a secret of a workspace.
- The Worker gives each read token only to the Git command that copies its
  repository. The Worker revokes it before the build goes on, as
  [GitHub tokens](../docs/protocol/tokens-and-secrets.md#github-tokens)
  says. The software step and the install script run only after that.
- The workspace object keeps the env values and output chunks of a start
  only in encrypted form. Before it returns a start log, it masks the
  complete joined stdout and stderr with the marked env values and workspace
  token. This hides a value across chunks and across the stdout and stderr boundary.
- The workspace object filters runner events with the marked env values
  from the actual start capture before it checks their meaning, stores
  them, or sends them. This applies to older installed runners too.
  The runner masks workspace tokens and turn tokens. It receives no separate
  org-value list, so its local state can keep raw org values. Real paths
  and base refs stay available for operations. Separate labels are masked.
- The terminal password stays in `/run/conductive-terminal/password`, with
  mode 600. The terminal backend checks that it has 64 lowercase
  hexadecimal characters.
  The readiness command writes no password to output or command history.
- The helper never writes a token to its error output. From a Worker
  response, it writes only a safe error message, as
  [GitHub access](github.md#git-credential-helper) says.
