# Image builds

This page belongs to the [workspace lifecycle README](README.md). It says
how the lifecycle code builds and refreshes the org image. The org image is
the saved snapshot that every new sandbox of an org starts from. It also
gives the provider retry policy that builds, refreshes, and workspace
starts share. [Build sandboxes](#build-sandboxes) describes their starting
image and the clone token of each copy. [Key code](#key-code) names the
files of the image code.

## Build sandboxes

- A build sandbox starts from the current org image. A first build uses a
  matching ready software image, or a new default sandbox without one.
  Its env holds only the folder variables.
- Risk: a program with root access that an earlier install left in that
  image can read the clone token of a later copy. That token can only read
  its own repository, which the image already holds. The Worker revokes it
  when the copy ends, as
  [GitHub tokens](../../docs/protocol/tokens-and-secrets.md#github-tokens)
  says.
- Repository copies use the [shared GitHub App credential flow](../github/app-credentials.ts).
  The [source loader](repository-layout.md#the-source-loader) gives the token and revocation steps.

The [operator backend](../operator/README.md#suspend-an-org) can suspend an org.
Every start and build phase checks this with user suspension.
Guarded admission, publication, token replacement, source grants, and refresh claims also check stored org state.
Cleanup can still recover uncertain allocations and remove resources.
A pending start, outcome publication, or failed-computer cleanup keeps suspension pending and its native alarm armed.
Suspended orgs get no disk retention restart, including after an owner change.

## Runner version

- Each full build and refresh records the Worker's runner protocol version.
  Both install the newest sandbox release.
- Each new computer allocation stores the runner version of its image snapshot before the provider call.
  This includes a first start, Try again, and a restored allocation.
  A missing image version counts as version 1.
  The chat backend still accepts only the supported runner version, whatever this pin, as [Runner versions](../../docs/protocol/version-pins.md#runner-versions) says.

## Build jobs

`startImageBuild` in [`image-builds.ts`](image-builds.ts) records a build or
refresh for an org admin and returns its ID. A request during a job gets
its ID and schedules it again. Each alarm advances the job one step with
`advanceBuildStep` in [`image-build-steps.ts`](image-build-steps.ts).
Software and install commands run detached and stream their output.
The software release includes the workspace CLI and MCP server.
Builds need no separate tool source installation.
D1 stores the step, output offsets, and log. Each row holds at most
256 KiB of UTF-8 text, split between complete characters.

`createShellOrg` in [`feature-org.ts`](../app-api/feature-org.ts) starts the
first build after it saves the org and its repositories. A new build whose
first alarm cannot schedule fails at once with a saved message. A build
that has not allocated a sandbox ends without cleanup. An allocation
already in progress keeps its cleanup ownership. A failed reschedule of
an existing running build keeps that build running.

`changeShellRepository` in
[`feature-repositories.ts`](../app-api/feature-repositories.ts) starts a
build after a save adds a repository. It uses the admin who added it,
also after a failed build. A repeated save and a removal start no build.
A failed start keeps the saved choice and writes one fixed warning.

`publishBuild` in [`build-admission-data.ts`](build-admission-data.ts)
records whether the first good build needs an added build for changed
settings. A successful build or refresh also gets an added build when its
repositories lack a chosen repository and the newest build succeeded.
Its `cleanup-build` phase keeps that work through coordinator
reconstruction. `cleanupBuild` in [`build-execution.ts`](build-execution.ts)
finishes resource cleanup before `startAddedImageBuild` in
[`first-image-build.ts`](first-image-build.ts) starts the added build.
The added build uses the first admin who is not suspended. A failed start
keeps the published image and writes one fixed warning. A failed build
starts no added build. A refresh after a failed build gets none either.

`readBuildHistory` in [`build-data.ts`](build-data.ts) returns
`BuildsResponse.changes` with the build history. `readBuildChanges` in
[`build-changes-data.ts`](build-changes-data.ts) compares the raw saved
install script with the newest successful build's script in the requested
provider account. Before that account's first image, it uses the newest
build in the same account, in any state. A refresh never becomes this
script reference. The added and removed repository lists compare the
chosen repositories with that account's published image. Both lists stay
empty before the first image.

D1 keeps at most 4 MiB of each build log: the first and the last output.
A write that passes that budget removes whole rows from the middle.
The line `[N output bytes omitted]` takes their place in the event order.

- A build loads the chosen repositories, installs the image software, runs
  the install script with Bash, and saves a snapshot. A first build that
  pins a matching ready software image starts from it and still installs
  the newest release. Admission records the pin in the job insert. The pin stays
  until the job reaches `done`, including its cleanup. The
  [software image backend](../software-image/README.md) owns these images.
  A refresh loads the repositories of the current image again, installs
  the newest release, clears its command journal, and saves a snapshot.
  It does not run the org install script.
- The org image changes only when the new snapshot is ready. Each job
  deletes every live ledger computer of that org and build, and keeps its history and log.
  A failed Delete keeps cleanup scheduled until each computer is removed.
  Cleanup attempts every live computer even when another Delete fails.
  It reports that failure after the independent Deletes finish.
  Missing computers count as removed.
  Confirmed ledger deletions keep later retries from repeating finished work.
- A creation claim captures a published image and its repository's default
  branch. One D1 transaction stores its start plan, env vars, and startup
  script, and leases the snapshot, before the workspace row exists.
- Cleanup waits for a lease before it deletes an old snapshot. D1 keeps
  deferred cleanup. A ready sandbox, a workspace delete, or a claim that
  leaves the pending state releases the lease.
- The composition root must pass the Members lifecycle hooks through
  `withImageSourceCleanup(env, fetch, hooks)` from `image-sources/members.ts`,
  as the [source loader](repository-layout.md#the-source-loader) says.

## Provider retries

Builds, refreshes, and workspace starts share one saved policy for a
transient Boat error. `transientProviderError` in
[`provider-retry.ts`](provider-retry.ts) decides which errors are
transient. Other errors keep their existing handling.

- The first transient error in an unfinished step opens a retry window of
  10 minutes, `PROVIDER_RETRY_WINDOW_MS`. A completed step resets it. A
  successful sandbox read or deadline update does not reset it.
- The first retry waits 1 second. Each later retry waits twice as long, up
  to 60 seconds. A retry never comes before the `Retry-After` of the error,
  and never after the end of the window. The next alarm comes at that time.
- When no retry fits in the rest of the window, or the window ends before
  a pending retry runs, the existing failure and cleanup handling runs. For
  an image job, that cleanup also revokes any source token, as the
  [source loader](repository-layout.md#the-source-loader) says.
- When a step runs without an error but does not finish, it clears only
  the pending wait. The next alarm then comes after 1 second. So a healthy
  command can run past the age of the window. A later fault in the same
  step still uses the first window.
- The window does not limit a whole job or a healthy command.
- The whole-job deadline takes precedence over a retry wait. The limits
  are in [Time limits of builds and starts](../../docs/protocol/workspace-life.md#time-limits-of-builds-and-starts).
- Cancellation and terminal cleanup do not wait for a pending retry.
- A source command start never retries. It fails closed, as the source
  loader says.
- Workspace allocation uses the retry handling in [`start-allocation.ts`](start-allocation.ts).

An image job keeps this state in the nullable
`image_builds.provider_retry_json` column of migration
`202611070007_lifecycle_provider_retry.sql`. A start
keeps the same state in its saved start job. So the window survives a
restart of the object. Each completed build or source phase clears the
state in the same D1 batch as the phase change. A start changes only its
retry state in a storage transaction, so a cancellation and the saved
output offsets stay.

`nextProviderRetry` computes each wait.
[`image-retry-data.ts`](image-retry-data.ts) reads and writes the state of
an image job, and `completeBuildPhase` in
[`build-phase-data.ts`](build-phase-data.ts) completes a build phase.
`retryStartError` in [`start-provider-retry.ts`](start-provider-retry.ts)
and `retry` in [`start-storage.ts`](start-storage.ts) do the same for a
start.

[`job-time-limit.ts`](job-time-limit.ts) supplies the job limits. An image
job uses its saved `started_at` value. A start saves one absolute deadline
beside its retry state. A phase change clears retry state and keeps the
job deadline. The image and workspace alarm schedulers cap their next
retry at that deadline. Terminal cleanup keeps its own retries after the
job fails.

A failed image job keeps the `allocating` phase when a dispatched request
has no confirmed sandbox ID. The existing build row owns that cleanup.
[`cleanupBuild`](build-execution.ts) replays the saved request through
[`recoverImageBuildAllocation`](image-allocation.ts), then saves the ID
before it deletes the sandbox. Only finished cleanup writes `done`.
A definite refusal of the first dispatch needs no allocation recovery.
A refused replay after an uncertain dispatch keeps the saved ownership.

An old start without a saved deadline uses its saved creation time or
lifecycle start time. The start coordinator saves the restored deadline
before it advances the job. A timed-out start with an unresolved
allocation moves its encrypted request to a separate cleanup job, as
[`retryAllocationCleanup`](start-allocation-cleanup.ts) handles.

## Refresh timers

`refreshImagesForPush` in [`image-timers.ts`](image-timers.ts) starts a
refresh for each org whose current image holds the pushed repository, and
that has an admin who is not suspended. It
acts on a push to the default branch, at most once in 30 minutes for each
org. A push during a running job waits for a later refresh. Only the
verified GitHub webhook receiver may call it. The
[GitHub backend](../github/README.md) owns that receiver. The image
coordinator starts the daily refresh by itself.
A daily refresh sets the saved daily deadline 24 hours after its start.

Both refreshes start with the first admin who is not suspended, from
`firstActiveOrgAdmin` in [`settings-data.ts`](settings-data.ts). An org
without such an admin gets neither refresh. Its push uses no part of the
30-minute limit, a recorded push refresh stays pending, and the image
coordinator sets no new alarm.
[Operator actions](../../docs/protocol/operator-actions.md#starts-stops-and-builds)
states the rule.

## Key code

- [`build-admission-data.ts`](build-admission-data.ts): guarded image build admission and publication, with the installed runner version.
- [`build-changes-data.ts`](build-changes-data.ts): `readBuildChanges`, the
  saved install script change and the added and removed repositories in
  `BuildsResponse.changes`. It reads the script reference and the published
  image's repositories for one provider account. The repository read uses
  the same source as creation admission.
- [`image-builds.ts`](image-builds.ts): `startImageBuild` and
  `advanceImageBuild`, which removes the command journals before a snapshot.
- [`first-image-build.ts`](first-image-build.ts): `startAddedImageBuild`,
  which starts changed settings after the first good build finishes cleanup.
  It also builds waiting repositories after a successful build or refresh,
  when the newest build succeeded.
- [`image-build-failure.ts`](image-build-failure.ts): image failure classification, retry, warning, and allocation cleanup.
- [`build-execution.ts`](build-execution.ts): build commands and cleanup of every live ledger computer for the exact org and build.
- [`image-allocation.ts`](image-allocation.ts): `recoverImageBuildAllocation`
  replays a saved allocation request and saves the recovered sandbox ID.
  Failed image jobs retain their unresolved allocation phase until cleanup
  recovers and deletes the sandbox.
- [`build-log-statements.ts`](build-log-statements.ts): `buildLogStatements`,
  which splits output into rows and adds the budget statements of
  [`build-log-retention.ts`](build-log-retention.ts) to the same D1 batch.
- [`build-log-reader.ts`](build-log-reader.ts): `readBuildSnapshot`, which
  reads the build state and its log in one D1 batch.
- [`image-timers.ts`](image-timers.ts): `refreshImagesForPush` and
  `runImageAlarm`.
- [`image-coordinator.ts`](image-coordinator.ts): `ImageCoordinator`.
- [Software images](../software-image/README.md): the shared software builds and their cleanup.
- [`image-software.ts`](image-software.ts): the release install and workspace startup commands.
- [`software-release.ts`](software-release.ts): release metadata lookup and validation.
- [`software-bootstrap.ts`](software-bootstrap.ts): verified downloads and startup activation locking.
- [`image-runtime.ts`](image-runtime.ts): `IMAGE_NODE_RUNTIME`, the pinned
  private Node of the org image, and its paths. The
  [runtime guide](../../image/runtime.md#update-the-node-release) says how to
  update it.
