# Backend and runner fakes

`createHarness` creates one Miniflare runtime with local D1 and R2.
The runtime also constructs the production workspace object with native SQLite.
`harness.native.actor(name)` supplies HTTP, lifecycle RPC, storage controls, and real eviction.
`native-runtime.ts` owns these objects and their fake outbound fetch path.
`native-workspace-entry.ts` adds test controls around the production constructor.
Initial actor options reach that constructor before it captures optional dependencies.
The registered object still extends the production `Workspace`.
`native-warnings.ts` observes native warnings without replacing product warning rules.
The reverse callback bridge keeps transaction reads on native storage.
Native peers keep synchronous send faults inside the runtime.
These peers have no physical socket. So they save no native socket state, and their access checks use the scheduler that the fixture injects.
The shared scheduled-alarm helper runs only stored due alarms.
Reset removes the native records, aborts the real object context, and evicts its fresh idle instance.
Restart saves clock metadata and keeps committed native SQLite records through the same context reset.
Instance identity checks prove that reconstruction creates a fresh object.
Production request timeouts stay unchanged.

The root Vitest setup builds one current Worker bundle for each run and watch rerun.
Native fixtures read that bundle from the provided test context.
Standalone callers build on demand and reuse that bundle only within their process.

The same setup prepares one folder for each run and watch rerun, and deletes it at the end:

- It splits each migration once, so test processes do not import Wrangler.
- It applies all migrations once to a template D1 database.
  Each test runtime starts from a copy of that template and does not apply the migrations again.
  Every runtime names its database `TEST_D1_ID`, because Miniflare names the database file after that id.
  A runtime with `migrationsBefore` and the migration tests still apply the migrations themselves.
- It holds the other test Worker bundles.
  `workerLibraryBundle` in [test-bundles.ts](test-bundles.ts) saves each bundle in that folder.
  A process that needs a bundle before its file exists builds it. Later processes read the file.

Without the global setup, `migratedStorage` builds one template for its process, and each bundle helper builds its bundle itself.

`createChatFixture` in [`harness.test-support.ts`](../chat/harness.test-support.ts) connects its fake runner and browser tabs through `nativeChatTransport` in [`native-transport.test-support.ts`](../chat/native-transport.test-support.ts).
Its `drain` waits for batched runner input, connection closes, queued chat work, and sends to the fake runner or a browser tab.

In the lifecycle fixture, the `advance` of each `backendActor` in [`backend-test-platform.ts`](../lifecycle/backend-test-platform.ts) first waits for the work in the chat queue of its native object.
Its endpoint and its entry in the fixture's `starts` use the same `advance`.
The call then moves the clock and runs the due alarms of that object.
So a manual advance after `nextQueued()` reads the last alarm that the start admission saved.
`run` in [`backend-pump.test-support.ts`](../lifecycle/backend-pump.test-support.ts) moves the clock only to an alarm of an object that holds a saved start job.
Advance the alarms that follow a finished start with `advance` or `advanceTo`.

`createHarness` also supplies the private local R2 attachment bucket.
Reset removes its file records and objects between tests.
`attachment-r2.ts` wraps local R2 deletion for controlled cleanup failures.
It supplies fake GitHub and Boat servers, a fixed clock, sign-in, org creation, and cleanup.
`login()` runs GitHub sign-in and then grants fixture app access through
the real shared grant step. `login({ appAccess: false })` runs sign-in
without that fixture grant. Use it to test a new or waiting account.
Raw callback and Mac handoff helpers also add no fixture grant.
`seedAppAccess(db, userIds, now)` grants access to directly seeded app users.
Backend tests use it without an external account or cloud computer.
`FakeGitHub.profile` accepts GitHub's `created_at`. Its email pages accept
the `primary` flag beside `verified`.

`FakeAnthropic` and `FakeOpenAI` supply in-memory model upstreams.
They accept only the fixed model POST routes on their provider origins.
Tests inject their `fetch` methods through the Worker's fetch dependency.
They open no external connection and need no provider account.
The gateway HTTP fixture also configures `FakeModelUpstream` for an own endpoint.
It keeps the same request capture and response factories on that origin.
`FakeModelUpstream` accepts an optional `GET` method for endpoint discovery tests.
Its default stays `POST` for model requests.
Each fake records requests without cloning or teeing their bodies.
Its default reply reads the upload once and records its text in `bodies`.
Set `response` to supply a fresh response after that read.
Queue `responseFactories` to control upload reads, early replies, failures, or open answer streams.
Each factory owns the request body read and returns a fresh response.
The gateway tests use these factories to observe cancellation on the original stream.

A harness that does not start from the template uses `applyMigrations(db)` from [migrations.ts](migrations.ts).
It applies migrations in filename order with Wrangler's SQL splitter.
The splitter keeps each trigger body in one statement.
The optional `before` filename stops before that migration.
The optional `from` filename starts with that migration.
`createHarness({ migrationsBefore })` creates a database at an earlier schema
for a migration test.

Each members test file creates one harness in `beforeAll` and disposes it in `afterAll`.
Its `beforeEach` calls `reset` to delete all application rows in a fixed child-first order.
The reset deletes account shortcut rows before users.
The reset also restores the clock, token sequence, and fake services.
It deletes code uses, approval emails, app access, and codes before users.
It resets the sign-up pause and the waitlist switch, each with its change
record, so the waitlist is on again. Tests can make waiting users through
sign-in or directly in D1.
The [operator waitlist fixture](../operator/waitlist.test-support.ts) adds
fake Resend replies and a scheduled-entry client. Its clock controls
approval retries without real waits. Captured provider requests show
delivery keys and message content.
Each test creates its own members client and lifecycle hooks.
The harness gives the Worker a test `BOAT_API_KEY` and `BOAT_ORG_ID`.
`FakeBoat` serves requests for its `orgId`, and for each organization that
`addAccount({ orgId, apiKey })` adds with its own key. A request for any
other organization gets 404. A request without `X-Boat-Org` goes to
`activeOrgId`, another organization, and gets 404.
`FakeBoat` also refuses each request without the `apiKey` of its
organization. `reset` keeps the added organizations.
To test a second provider account, add its organization to the fake. Then
configure the matching account in the trusted `SANDBOX_PROVIDER_ACCOUNTS`
map of the Worker environment, as the
[sandbox area](../sandbox/README.md#provider-accounts) says.
Native actor options accept that map in `environment`.
The lifecycle fixture passes its configured accounts to each native actor.
The Boat driver of the
[provider contract suite](../sandbox/README.md#provider-contract-suite)
makes a new `FakeBoat` for each case, and sets its replies from each
normalized scenario.

`memberFixture` prepares three users, signed sessions, an org, memberships, and settings in one D1 batch.
It then grants each user app access. The waitlist fixture omits those
grants and gives access only to its admin.
Signed sessions use the real signer and the seven-day expiry.
The `signIn` helper still runs the real OAuth flow when a scenario calls it.
Scenario requests still use the real request gate.

`FakeBoat.responseFactories` queues one response factory for each request.
Use a factory to return a fresh streaming body when a test observes cancellation.
These replies are not cloned or teed.
Clear unused factories in the test's cleanup hook.
The harness reset clears factories.

The runner boundary uses plain TypeScript types.
Tests need no Cloudflare Durable Object or real WebSocket.

[connectFilesRunner](../files/test-support/runner.ts) connects `FakeRunner` to a backend handler.
`FakeRunnerConnection` adapts the handler to the connector. Its constructor
receives runner messages. Its `reply` method sends workspace messages.

`runner.commands` records turns, messages, interrupts, model changes, file
reads, and diffs. `runner.emit` sends numbered events. `runner.reply` sends
file replies. Reconnect the same fake runner to keep its outbox.
`runner.sendEnvelope` injects duplicates and gaps. Tests of the production
workspace object check validation, ordering, storage, replay, and masking.
Rust tests own the runner's transport, saved state, and report assembly.

Use [recorded file events and replies](../../src/test-support/recorded-files.ts)
for the runner's file reports.
`recordedRunnerFileEvents` has four complete reports, with full reports as part 1 of 1.
It keeps the current file tests' order and ends the tree at revision 2.
`recordedMultipartRunnerFileEvents` has eight events for multipart assembly checks.
It includes two-part trees and changes and consecutive tree deltas at revisions 2 and 3.
Both samples include file creation, a rename, a removal, and dirty branch work.
Read replies also cover file content, a diff, and a size error.

A test that starts a Node child process builds its environment with
`isolatedProcessEnvironment` from [process-environment.ts](process-environment.ts).
The child gets only the values that the test gives, and no value of the test process.
The generated Worker types add the `vars` of `wrangler.jsonc` to `NodeJS.ProcessEnv`.
So a plain object does not type-check as the environment of a child process.

## Native close probe

`NativeCloseProbe` in [native-close.test-support.ts](native-close.test-support.ts) makes a close the first event after a wake, with no restored peer.
A native fixture entry builds it before the production constructor runs. It also wraps the `webSocketClose` of that entry.
Before the eviction, `prepare()` saves a one-time flag.
The next constructor then gets an empty result from its first `getWebSockets()` call, the restore listing.
The probe records the count and the attachment IDs of the sockets that it left out of that listing.
The real sockets, their attachments, the storage, and the native close delivery stay.
So the close reaches the role owner, which must recover the connection from its saved state.

The pinned runtime can list an open socket during construction, also when the close of that socket causes the wake.
The control models the documented rule that the listing leaves out a disconnected socket. So the missing-peer path runs every time.
It does not claim that every close-first wake leaves its socket out.
`snapshot()` gives the first event, a fetch or a close, and the omitted count and IDs.
It also counts the completed close callbacks and their errors.
A callback counts as complete only after the `waitUntil` work that it starts ends.
`wait()` resolves when a close callback completes.

## Key code

- [Shared session log](../../src/shared/transcript/session-log.ts) folds
  history in the Worker chat tests. Its
  [session events](../../src/shared/transcript/session-events.ts) accept
  stored Worker envelopes and parsed browser envelopes.

- `harness.ts` owns D1 setup and the HTTP test app.
  Its HTTP requests provide a fake execution context for credential task ownership.
- [native-close.test-support.ts](native-close.test-support.ts): `NativeCloseProbe`, the close-first control of the native browser, runner, and Mac fixture entries.
- [app-access.ts](app-access.ts) grants fixture access for users created directly in D1.
- `native-global-setup.ts` builds and provides the current native bundle, the split migrations, the migrated template, and the bundle folder before tests and watch reruns.
- `native-chat-record-controls.ts` reads history and file projections inside the native object and calls its real chat writer.
- `native-attachment-controls.ts` runs streaming attachment storage and reads real R2 byte samples inside the runtime.
- `migrations.ts` splits the migrations and applies them for a harness without the template.
- [migrated-storage.ts](migrated-storage.ts) builds the migrated template database and copies it into the storage folder of a new runtime.
- [test-bundles.ts](test-bundles.ts) builds every test Worker bundle with one Vite configuration and saves it for the run. Its `buildWorkerLibrary` also builds the native bundle.
- `fake-boat.ts` supplies provider replies, fresh streaming response factories, and added organizations with their own keys.
- `fake-github.ts` supplies sign-in replies and an empty installation list for an account without the GitHub App.
- Its `accounts` map supplies GitHub user lookups for routine author filters, with 404 for an unknown login.
- `fake-anthropic.ts` supplies the Messages and token-count upstream.
- `fake-openai.ts` supplies the Responses upstream.
- `fake-model-upstream.ts` records model requests and supplies fresh response factories.
- `fake-site.ts` supplies built site files, the sign-in agreement, and the GitHub install return pages.
- `fake-runner.ts` supplies the runner without an agent SDK.
- `fake-durable-object.ts` supplies the workspace endpoint without Cloudflare.
- `fake-runner-files.ts` joins valid file report parts for the endpoint.
- `runner-connection.ts` supplies the in-memory socket.
- `process-environment.ts` builds an isolated environment for a Node child process in a test.
- `attachments.ts`: `fakeAttachments(ids)`, the attachment metadata of the lifecycle fixtures. Each file gets the `path` of the shared builder in `src/shared/attachment-paths.ts`, as an upload reply and an admitted message give it.

See [the browser fakes](../../src/test-support/README.md),
[the shared contracts](../../src/shared/README.md), and
[migration ranges](../../migrations/README.md).
