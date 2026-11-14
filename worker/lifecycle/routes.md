# Routes and input activity

This page is part of the [workspace lifecycle](README.md) guide. It gives the browser
routes, the input activity, and the machine route of this folder, and their
entry points.

## Browser routes

`handleLifecycleRequest` in [`browser.ts`](browser.ts) serves these routes
of the shared contracts:

- create, read, resume, and activity of a workspace, from
  `src/shared/workspaces.ts`
- the build list, a new build, a refresh, one build, and its log stream,
  from `src/shared/org-settings.ts`

Run the browser gate first, and pass its `RequestContext`. The handler
returns `null` for every other route. `env` is a `LifecycleEnvironment`
from [`runtime.ts`](runtime.ts). The caller gives these options:

- `acceptFirstMessage`: the hook of the chat backend. After the admission
  and for each repeat, it stores the queued first message of that admission
  and returns it. So it must be idempotent for the message and session IDs.
  In production, the admission has already stored that message in chat, so
  the hook adds no history.
- `projectWorkspace`: optional. It changes each reply, such as the state
  of the workspace for the reader.
- `waitUntil`: the `waitUntil` of the Worker's execution context. A create
  gives it its work, so the work continues when the browser closes.

`chatLifecycleRoute` makes the runtime with `workspaceRuntime` and
`imageRuntime`. A build or refresh reads the newest release through
`latestSoftwareRelease`, as [release files](../../image/README.md#conductive-release-files) describes. It gives `acceptFirstMessage` to
`acceptLifecycleFirstMessage` of the workspace object.

For a read or a resume, the `projectWorkspace` of `chatLifecycleRoute`
takes the reply from `readChatWorkspaceResponse` of the workspace object.
That read runs in one task of the chat queue. That reply has the event
number of its state. Its name comes from the latest committed agent title,
when there is one. The state for the reader uses the chat summary of the
same read.

[Creates and resumes](workspace-object.md#creates-and-resumes) says how the
workspace object runs the start of each create and resume. It gives the
waits, the replies, the branch, the terminal setup, the runner readiness,
and the stop cleanup of a failed resume.

- A create needs a published org image and a repository that its build
  loaded. A change to the chosen repositories takes effect after the next
  successful build. A repeat of the same first message ID from the same
  sender returns the same admitted workspace, including after a failed start.
- A failed admitted create keeps its workspace, chat, first message, and
  queued messages. Each current member can read the saved cause and history.
  Failure revokes the token and detaches the failed sandbox after saving cleanup ownership.
  Lifecycle cleanup leaves the attachments to their owner.
- Try again uses the Resume route. It queues a replacement create in the
  same workspace, with the same branch and first-message identities.
  The replacement pins the current published image for its repository.
  It gets a fresh allocation key, token, command journal, and start deadline.
  Known and uncertain cleanup finish before the replacement allocates.
  A failure before first-message acceptance can remove provisional records.
- The [member checkpoint adapter](../members/creation-checkpoint.ts) retains a create that Delete interrupted, before or after allocation.
  The production resume route continues that create when the workspace opens after Restore.
  It keeps the allocation attempt, the first message, and the sender. It renews a revoked workspace token.
  The requeue gives the create a fresh `deadlineAt`, `WORKSPACE_START_TIME_LIMIT_MS` after that open.
  `creation.createdAt` keeps the original creation date.
  A create without a sandbox continues from its pinned image.
  A create with a retained sandbox resumes that sandbox through the same readiness step as a resume, with the current env vars of the org.
  It then continues at the saved creation step in `afterReadyPhase`. Its commands use a fresh journal key, `commandAttempt`, and the allocation keeps `attempt`.
  A create saves `startup` in `afterReadyPhase` when it moves into the terminal setup.
  So a checkpoint in the terminal setup, the password read, or the runner readiness wait repeats the startup step after sandbox readiness.
  That repeat rebuilds the runtime files.
  The terminal setup and the password read then run again.
  Its finished fetch and branch steps stay complete.
  The branch step uses the branch when it already exists.
- Browser input and preview requests reset the idle time, as
  [Input activity](#input-activity) says. Browser input includes the keys
  and the taps in the terminal.
- The build log is a stream of server-sent events. It continues after the
  `Last-Event-ID` header or the `after` value, and it ends with a `build`
  event when the job ends. One D1 batch reads the build state and its log,
  so the stream sends all log events before the final `build` event.

`createWorkspace` in [`workspaces.ts`](workspaces.ts) also takes an optional
trusted `sender` as its last argument. The agent tools need it for a
workspace that an agent creates. The `user` stays the owner, and the first
turn and the branch step use the sender.

## Input activity

[Stop and resume](../../docs/protocol/workspace-life.md#stop-and-resume)
says which input counts as activity. One `InputActivityOwner` in each
workspace object receives the input times of the browser `activity` route
and of previews. The preview handler reports each request through
`ToolDependencies.onActivity(workspaceId, at)`. That call returns at once.

- The input listener of the app page hears the keys, the taps, and the
  scrolls in the terminal too, as the
  [web app](../../src/app/README.md#rules-for-this-code) says. An open
  workspace posts that input to the `activity` route.
- Terminal frames report no activity, because an automatic reply of
  xterm.js can have the same bytes as a key, as the
  [terminal backend](../terminal/README.md) says.
- The owner saves the newest input time in the durable lifecycle state,
  fenced by the member generation. The shared deadline hook checks the org
  before this queued local write. The write publishes no shown state and
  waits for no provider call.
- The idle stop still comes 30 minutes after `lastActivityAt`.
- The owner updates D1 and the provider at most once a minute. The first
  input after a quiet minute starts an update. One more update follows for
  the newest input of that minute.
- An update moves `last_activity_at` forward only, while the workspace, its
  sandbox, and the org generation stay active. It then sets the provider's
  auto-stop to 1,860 seconds, which covers the minute of collection.
- When the provider reports a stopped or failed sandbox, the update
  reconciles the durable lifecycle state.
- A failed update keeps its input time for the next minute, also without
  newer input. It writes one fixed warning through `warnWorker`.
- The deadline hook owns the same org check for the provider update and
  for queued activity, capture, reconciliation, and turn writes.
  A refused update preserves the activity time, provider deadline, and stop-retry alarm.
  Browser activity carries a plain refusal through RPC for the route's 403 reply.
  Stop, reconciliation, and disk cleanup keep their separate hooks.
- After its org check, the deadline hook skips each provider deadline
  extension of a workspace whose owner is suspended. This covers the input
  update, the turn update, and the turn heartbeat. Its check still passes,
  so browser activity on that workspace still gets HTTP 200. The stop of
  that workspace goes on, as
  [The stop of one workspace](../operator/README.md#the-stop-of-one-workspace)
  says.
- Each update runs through `waitUntil`. Input producers do not wait for the
  provider. Browser admission waits for its org check. No update holds the chat queue or the durable queue during a
  network call.

## Machine route

`handleGitCredential` in [`machine.ts`](machine.ts) serves
`MACHINE_PATHS.gitCredential` on the machine hostname. The
[git credential helper](../../image/README.md#git-credentials) sends the
workspace token as a bearer token, and the current turn ID in the
`X-Conductive-Turn-Id` header. The handler reads no request body and needs
no content type. `Workspace.credentialSender` maps that turn to a sender,
in the chat queue, as
[The git credential sender](#the-git-credential-sender)
says, with its tests.

For the GitHub CLI outside an agent turn, the helper omits the turn header.
The handler then selects the workspace owner in its authorized D1 read.
A present but invalid turn header still fails, without an owner fallback.
The fetch of a Continue job sends the fetch ID of the job in the same
header, so the handler gives the token of the member who pressed Continue,
as [Continue](git-credentials.md#continue) says.

The handler returns a fresh GitHub App user token of the sender, from
`freshGitHubUserToken` in [`github-tokens.ts`](../security/github-tokens.ts).
It stores no token. A user without a stored GitHub token must sign in again.
One response helper runs the same authorization before token resolution and after its last wait.
Each authorization reads the trusted turn sender through `credentialSender`,
or the workspace owner for a request without a turn header.
Its final D1 read in [`machine-credential-data.ts`](machine-credential-data.ts) checks the shared workspace token rule, sender membership, and sender suspension together.
The handler does no asynchronous work between that final read and the reply.
It also checks that both authorizations selected the same person.
Each failed request logs the warning `git_credential_failed`. The warning
holds the workspace ID when the token names one, whether a turn header came,
and the error kind, with the HTTP status and an allowlisted code for a
refusal. The helper in the sandbox keeps no record, so this warning is the
trace of a failed Git push in Workers Logs.

`createApp` in [`worker/application.ts`](../application.ts) routes
`MACHINE_PATHS.gitCredential` to this handler, and
`IMAGE_SOURCE_CREDENTIAL_PATH` to `handleImageSourceCredential` in
[`image-sources/credential.ts`](image-sources/credential.ts). It does this
on the machine hostname only, after the Mac command route and before the
runner socket, with the private error response wrapper.

### The git credential sender

[The git credential sender](git-credentials.md) gives how
`Workspace.credentialSender` maps the turn ID of a git credential request
to a sender: the grant of a create, the grant of a Continue fetch, and the
running chat turn. It also names the tests of the route.

## Key code

- [`browser.ts`](browser.ts): `handleLifecycleRequest`, the browser routes.
- [`machine.ts`](machine.ts): `handleGitCredential`, the git credential
  route.
- [`input-activity-owner.ts`](input-activity-owner.ts): `InputActivityOwner`,
  the one input owner of a workspace object, with its minute updates and
  retries. [`create-input-activity.ts`](create-input-activity.ts) connects
  it to the lifecycle hooks, the member fence, and `warnWorker`.
- [`input-activity-local.ts`](input-activity-local.ts): `LifecycleInputState`,
  the fenced input time in the durable lifecycle state, with its capture
  and its reconciliation.
- [`input-activity-update.ts`](input-activity-update.ts) and
  [`input-activity-data.ts`](input-activity-data.ts): one D1 and provider
  update. `writeWorkspaceActivity` moves `last_activity_at` forward with
  `MAX`.
