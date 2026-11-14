# Workspace lifecycle

This folder holds the Worker code that prepares the org image and runs the
life of each workspace. The org image is the saved snapshot that every new
sandbox of an org starts from. A workspace has its own Boat sandbox and one
branch at a time. [Continue](continue.md) moves it to a new branch after
its merge. The code reaches Boat only through the
`SandboxProvider` interface in [`provider.ts`](../sandbox/provider.ts),
with the client of the provider account that each record stores.
[Provider accounts](provider-accounts.md) and the
[sandbox area](../sandbox/README.md) say how.

`chatLifecycleRoute` in [`worker/app-api/lifecycle.ts`](../app-api/lifecycle.ts)
gives the create, read, resume, and activity routes of a workspace to
`handleLifecycleRequest`. The root Worker also serves the
[machine route](#machine-route), image builds, refreshes, and build log streams.

## Responsibilities

- Build and refresh the org image in a separate build sandbox, with a build
  history and a live build log.
- Create a workspace from the newest good org image.
- Keep the state of each workspace in its Durable Object: the starts, the
  activity, the idle stop, and the disk retention restart. That restart
  starts a stopped sandbox briefly, so that Boat keeps its disk.
- Stop and retain archived sandboxes, and delete them after the Restore window.
- Repair overdue disk, archive, and image alarms from the 15-minute Cron Trigger.
- Repair the running turns, the idle time, and the name of a workspace
  from its committed chat, when a hook or a restart lost an update.
- Give the git credential helper a fresh GitHub user token of the sender of
  the current turn, or of the member who pressed Continue during its fetch.
- Continue a workspace on a new branch after its merge, with the same
  sandbox and sessions.
- Give the GitHub CLI the workspace owner's token outside an agent turn.

## Integration points

### Browser routes

[Browser routes](routes.md#browser-routes) gives the routes that
`handleLifecycleRequest` serves, the options of its caller, and the rules
of a create.

The internal `createWorkspace` call can pass a base branch and a start commit separately from the browser request.
Its provider account argument selects the published org image independently of those branch fields.
The creation claim keeps them in its saved plan.
The fetch updates `refs/remotes/origin/<base branch>`.
The branch phase uses the event commit when it exists, or the fetched head otherwise.
It sets the branch's `gh-merge-base` Git setting to the workspace base.
Create, resume, and disk retention pass that base through `CONDUCTIVE_DEFAULT_BRANCH`.
A null stored base uses the repository default branch.

### Input activity

[Input activity](routes.md#input-activity) gives how one
`InputActivityOwner` in each workspace object takes the input of the
browser and of previews. Terminal frames report no activity.

### Machine route

[Machine route](routes.md#machine-route) gives `handleGitCredential`, the
git credential route on the machine hostname, the git credential sender,
and how `createApp` routes it.

### Workspace Durable Object

[Workspace Durable Object](workspace-object.md) describes the Durable
Object of each workspace and of each image coordinator. It gives their
names, the lifecycle steps, the alarm, the start logs, the event socket,
and the publication of the events. It also gives the creates and resumes.
[Turn recovery and the shown state](recovery-and-shown-state.md) gives the
turn repair from the committed chat and the one writer of the shown state.

### Continue

[Continue](continue.md) gives the admission and reservation of Continue,
its phases, the staged fetch and the branch move, the publication, and the
recovery. [Continue routes](continue-routes.md) gives its routes and errors.
[The git credential sender](git-credentials.md#continue) gives the grant
of its fetch.

### Builds and refreshes

[Image builds](image-builds.md) describes build sandboxes, the runner version of an image, suspension,
provider retries, logs, snapshot leases, and refresh timers.
The [software image area](../software-image/README.md) builds the shared
image that a build of an org without an org image starts from.

Org builds and refreshes install the newest sandbox release through `conductive`.
A first build from a software image runs this step too.
Refreshes then snapshot without running the org install script.
The Worker validates release metadata from `CONDUCTIVE_RELEASE_SERVER`,
which defaults to `https://runner.conductive.build`.
A failed build lookup fails the build. A failed startup lookup prints a warning.

A normal workspace startup bootstraps a missing program in a detached root job.
Downloads never hold the lock used by runner restarts.
Activation shares `/run/conductive/bootstrap-activate.lock` with the restart.
The first activation confirms its installation before it releases that lock.
The release program includes the workspace CLI and MCP server.
Its system installer links `/usr/local/bin/conductive` to the active program.
Disk retention starts do not bootstrap or restart the runner.
[Installation](../../image/install.md) gives the command sequence and release layout.

## Settings

[Lifecycle settings](settings.md) gives the environment inputs and captured secret values.

## Provider accounts

[Provider accounts](provider-accounts.md) gives the provider account that
each record and start job stores, the client that each call uses, and the
[org image of each account](provider-accounts.md#org-images).

## Development

Run `npm run test -- worker/lifecycle` from the repository root with Node 24.
The [lifecycle test guide](tests.md) describes the native fixture, clocks, alarms, and focused checks.

D1 holds the workspace, token, build, and log records. The storage of each
object holds the lifecycle state, the turn records, and the events.
The computer ledger keeps allocation keys, orgs, owners or starters, and provider IDs with their [provider accounts](provider-accounts.md#the-computer-ledger).
It keeps deleted computer IDs until their org is purged.
Assigned identity writes also retain older IDs, including imports and repairs.
Workspace owner changes update each live ledger entry of that workspace.
The retained owner survives removal of the workspace row.
Allocation recovery keeps that retained owner when it merges an imported computer.
Definite first create refusals stay as rejected allocation records.
A refused replay keeps an earlier uncertain request live.
Each failed computer has its own cleanup flag.
The native cleanup pointer can therefore change without losing an older failed computer.
Archive and Restore keep the ledger entry of a retained computer live.
At the end of Restore, the delete goes through the ledger-aware cleanup of [`cleanup.ts`](cleanup.ts).
`detachArchiveDisk` then marks the exact account and ID deleted in the same D1 batch that detaches the disk.
A confirmed missing archived disk uses that batch too.

### Key Code

- [software-release.ts](software-release.ts): reads and validates the newest release JSON.
- [software-bootstrap.ts](software-bootstrap.ts): verifies downloads and serializes first activation with runner restarts.

[Key code](key-code.md) lists the entry points of the lifecycle code, and
the guides that give the entry points of each part.

### Related Docs

- [Workspaces and sandboxes](../../docs/protocol/workspaces-and-sandboxes.md):
  the org image. [Life of a workspace](../../docs/protocol/workspace-life.md)
  gives the start steps, stop and resume, Archive, and Restore.
- [Access and security](../../docs/protocol/access-and-security.md): what a
  sandbox holds, the workspace token, and GitHub tokens.
- [Architecture](../../docs/architecture/components.md): the Worker, the workspace
  Durable Object, and Boat.
- [Sandbox software](../../image/README.md): the software that each build
  installs.
- [Shared contracts](../../src/shared/README.md): the browser and runner
  payloads.
- [Migrations](../../migrations/README.md): the D1 tables.
- [Operator actions](../operator/README.md#lifecycle-checks): the suspension checks.
