# Chat backend tests

The `attachment-*.test.ts` files use local R2 and D1 through the internal storage boundary.
They cover exact bytes, ownership, expiry races, the shared copy owner and proof, path extensions, and Stop during a held transfer.
`attachment-first-message.test.ts` admits a first-message file before a computer exists.
It also covers the first-message file of a removed workspace: a new attempt can claim it, and it expires at its upload deadline.
`attachment.test-support.ts` supplies the shared fixture and explicit fake preparation seams.
`delivery-order.test.ts` holds a copy during a running turn.
It checks that the later messages of that turn keep their order, and that Stop and another session do not wait.
It also checks that a failed copy fails only its own turn.
`attachmentOwnerCopy` in `attachment-owner.test-support.ts` runs the real copy helper against a fake provider.
The fake counts the writers of each computer and path at one time, and the writes after delivery.
So a test finds a second writer, and a late write over an agent edit.
`attachmentOwnerFixture` adds a workspace on one computer, an upload, a session, and a ready runner.
`attachment-continuation.test.ts` ends a running turn while the copy of a joined message waits, and also after that message went out.
It checks that the continuation gets a new command ID but shares the copy owner and the proof of its message, also after a reconnect and a restart.
It also checks that a failed shared copy fails the turn of the continuation, and that the earlier turn stays finished.
`attachment-destination.test.ts` moves the workspace to a new computer while the copy for the old computer waits.
The held owner writes to neither computer, the new computer gets its own copy, and the agent edit there stays.
After a restart on the old computer, which has no proof, the files copy there.
`attachment-proof-recovery.test.ts` fails or interrupts the save of the shared proof after a continuation.
It checks that the connection closes, and that the redelivery after a restart copies again only when no proof committed.
`attachment-cancellation.test.ts` checks the Worker command order after a copy failure.
It checks that cancellation precedes Try again without waiting for the old turn end.
Rust engine tests check helper close order and the next turn inputs.
It also checks that a restart sends the stored interrupts again, and that each late end removes only the interrupt of its turn.
`integration/attachment-raw.test.ts` checks native fixed-length R2 writes, raw metadata and ownership, interrupted transfers, and desktop admission.
`integration/attachment-cleanup.test.ts` runs the production scheduled handler through `/__test/scheduled`, with the native workspace object, D1, and R2.
An expired claim without an accepted message loses its record and its object. An accepted file keeps both.
`integration/failed-first-start-retry.test.ts` keeps the first-message file of a failed first start through the native `expireChatAttachment` RPC, a restart, and Try again in the same workspace.
Try again copies its exact bytes once, as [Outer Worker tests](integration/outer-worker-tests.md) says.
The HTTP and security raw-upload tests check shared route budgets and admission before body reads.
The 100 MB boundary case creates its unknown-length stream inside the native runtime.
It reads the stored byte count and exact byte samples from real R2 there.
This keeps large byte arrays out of the test bridge while retaining the exact maximum and first excess byte.

This guide belongs to the [chat backend](README.md). Run the tests from
the repository root:

```sh
npm run test -- worker/chat
npm run typecheck
```

- `createChatFixture` in `harness.test-support.ts` uses the production workspace object in Miniflare with native SQLite.
  It batches the owner, member, workspace, signed sessions, and agent logins into the shared local D1.
- Its helpers send HTTP requests, open native browser peers, and connect a `FakeRunner` to native runner peers.
  Its `restart` evicts the real object and reconstructs it from native storage.
- `createFirstMessageFixture` in `first-message.test-support.ts` assigns the first session and message of an untitled workspace.
  `first-message.test.ts`, `workspace-session-title.test.ts`, and `session-titles.test.ts` share this native fixture.
- `createTitleFixture` in `workspace-title.test-support.ts` supplies a fake title model and drains native background work.
  `workspace-titles.test.ts` and `workspace-title-configuration.test.ts` use it.
  The optional model callback is present or absent before the production constructor runs.
  Its warning checks observe actual native console calls.
  `setEnvironment` changes native model configuration through the test controls.
- `snapshot` reads committed product records, write keys, and the stored alarm.
  Test clock metadata is separate from these records and write keys.
- `setStorageHooks` observes the native transaction before or after its commit.
  A before-commit hook can read the live transaction through its `read` method, hold it, or throw to roll it back.
  An after-commit fault keeps the native records.
- `failNextCommit` injects one error before or after the next native commit.
  `clearFaults` removes these hooks.
  `checkCommitBoundaries` in [commit-boundary.test-support.ts](commit-boundary.test-support.ts) checks both boundaries and a real eviction.
- `agent-receipt-boundaries.test.ts` checks that a rejected commit or a crash after commit sends no confirm or browser event.
  It checks the stored event and cursor together, then checks replay after eviction.
- `events.test.ts` holds one native history-page list while a concurrent write enters the chat queue.
  It releases the page after the queue signal and checks history before live events.
- `queue-turn.test.ts` holds an `outside` call of `ChatQueue` and records the order of the queue tasks.
  It checks the return to the back of the queue, the error after the return, and the waits of `idle()` and `settled()`.
- `queue-generation.test.ts` checks that a queue task in an `outside` call lends its receiver generation to no other task.
- Send and Retry can commit a login observation before acceptance.
  An acceptance crash test first makes `loginAvailable` current, then injects its commit fault.
- `createRunnerLimitsFixture` in `runner-limits.test-support.ts` uses the same production object and native runner channel.
  It seeds the session and turn without adding browser events.
  Its `connect` can evict the object before reconnecting the same stream.
  Its publication list and stored-callback list have separate sources.
  The callback list records actual `runnerEventStored` calls at production callback composition.
- `runner-fixtures.test-support.ts` holds the runner report samples and shared session and turn IDs.
- `createGrownReportsFixture` in `runner-grown-reports.test-support.ts` seeds an encrypted environment capture with the secret `a`.
  The production output filter reads that capture inside the native object.
  The native SQLite value limit checks the enlarged display labels.
  Native record readers load history and file projections inside the object after eviction.
  Each reader returns fresh stored data once through the bridge.
  `runner-grown-reports.test.ts` checks tree and changes parts.
  `history-grown-delta.test.ts` checks an enlarged tree delta.
- `native-store.test-support.ts` gives direct storage tests the native records of a production object.
  Pure storage owners can run locally over that native storage.
  `history-session-pages.test.ts` reads session pages of `HistoryPages` there with small limits, and checks where each limit ends a page.
- `outputFixture` in `runner-output.test-support.ts` seeds an encrypted environment capture in D1 and starts a turn.
  `runner-output-durability.test.ts` fails the native commit of held text.
  It retries on the live object, then checks eviction, replay, and a gap.
- Native peers keep synchronous send faults inside the runtime.
  `setSendRule` drops or throws for matching native sends.
  `observeOutgoing` observes copied sends in their native order.
  `drain` delivers those messages to the fake runner and browser observers.
- Native request controls hold the real JSON reader and expose `bodyUsed`.
  The queue observer signals after the production chat queue accepts its next task.
- `workspace-callbacks.ts` preserves each real callback and its result before it awaits a native test observer.
  Native observers record stored events, ready, disconnect, dispatch, `turnEnded`, and file-result calls at that composition point.
  They do not infer callbacks from saved events or lifecycle-controller methods.
- `login-queries.test-support.ts` captures login queries inside the native object.
  The metadata tests also observe actual native decrypt calls in explicit capture windows.
- `runner-output-context.test.ts` refuses a completion and ends the turn.
  After a restart, a new runner stream sends later text of that answer,
  split by a second restart. The filter masks only the part that completes
  a secret. Each stream keeps its own raw cursor.
- `runner-output-legacy.test.ts` starts from two older stream records, one
  with an answer end and one with held text, and no workspace record. The
  first receipt moves the answer end into the workspace record, and the
  older stream keeps no copy. The held text stays with its own stream. No
  record holds a raw secret prefix.
- `port-reports.test.ts` checks complete private labels, sorted unique ports,
  and the final display limits after filtering.
  `runner-ports.test.ts` checks stored and streamed masked labels, replay,
  and invalid-report repair. Its public scanner input includes marked values
  across the final name and folder cuts. The real workspace lifecycle test in
  `integration/workspace-lifecycle.test.ts` checks the stop clear with no
  previews, and unchanged activity when a port report arrives.
- `runner-repairs.test-support.ts` builds a full and an oversized report of
  each kind, and reads the requests and markers of the repair tests.
- `late-events.test.ts` and `never-started.test.ts` cover replay after a
  workspace stop and the queued-turn eligibility rules.
- `close-attribution.test.ts` checks that a browser close records the
  authenticated member, not a member that the body names, before the
  interrupt. It also checks that the first stopper stays, and that a turn
  without `stopRequest` reads its first stopper from history.
- `retry.test.ts`, `retry-queue.test.ts`, and `retry-crash.test.ts` cover
  the newest failed turn: stale tabs, refused ends, waiting work, rollback,
  and commit crashes. `retry.test-support.ts` sends retries and reads the
  session records.
- `session-logins.test.ts`, `linked-sessions.test.ts`, `linked-retry.test.ts`,
  and `legacy-sessions.test.ts` test starters, linked sessions, and old data.
  `login-observation.test.ts` tests that an observed change stays after a
  refused Send, and that a repeated message ID observes nothing.
  `linked-retry.test.ts` also restarts after a crash at the acceptance of a
  linked Retry. It checks each stored record, and a stale Retry gets 409.
- `login-reuse.test.ts` tests a starter who does not share the login.
  Another member gets an empty linked session, and the first session keeps
  `loginAvailable: true` with `loginShared: false`. A queued message of
  another member fails with the cause before the runner gets it, and its
  Retry opens a linked session.
- `login-availability.test.ts` tests the metadata path. One query serves one
  or four sessions and reads no credential. `loginShared` follows the share
  setting, and an open tab gets the changed value. Reads check no login and
  flush no runner. The list and a new tab still work with a damaged starter
  ciphertext. Closed sessions and archived workspaces stay unchanged.
  `login-queries.test-support.ts` records its D1 login queries.
- `turn-dispatch.test.ts` checks that a runner disconnect during the
  registration of a turn undoes that registration before any send.
- [Gateway tests](../model-gateway/README.md) cover stable turn tokens, login changes, Stop, late events, and retry through chat.
  [runtime.test.ts](../model-gateway/runtime.test.ts) evicts the production SQLite object after a saved gateway Stop.
  It checks the retained interrupt, one failure with its cause after duplicate runner ends, late changed files, and the Retry message.
  `integration/gateway-entry.test-support.ts` adds test-only token issuance and a fetch wrapper for the production workspace RPC.
  The fetch wrapper releases each RPC before eviction.
- `integration/workspace-lifecycle-recovery.test.ts` checks a gateway login change with the production lifecycle fixture.
  The workspace stays `working` until the runner end is stored, then becomes `ready` on the same connection without an alarm repair.
  `integration/workspace-recovery-entry.test-support.ts` adds test-only turn token issuance to that fixture.
- `device-cleanup.test.ts` checks Mac command cleanup after a refused turn
  end. It also checks that late ends preserve the next turn and its commands.
- `adapter.test.ts` runs `Workspace` in Miniflare, with SQLite storage,
  D1, and real WebSockets. `createAdapterRuntime` sets up that runtime, and
  the test bundles `browser-entry.test-support.ts`.
- It closes every socket before `verifyAdapterRestart` in
  `adapter-restart.test-support.ts` evicts the real object without
  `webSockets`. Restart keeps SQLite history, queued messages, and the
  runner cursor. Event numbers continue. The resumed queued turn fails. Its
  message can retry after a second eviction.
- `verifyBrowserWake` in `browser-wake.test-support.ts` then keeps two
  original tab sockets, with a production and a local origin, through a
  wake. Both tabs then get each new event in order, with the link of their
  own origin.
- `createAdapterRuntime` can bundle another Durable Object entry, also for
  another workspace ID. The [GitHub store tests](../github/README.md#verification)
  use it to run `WorkspaceChat` with the GitHub state on SQLite.
- `browser-entry.test-support.ts` and `runner-entry.test-support.ts` extend
  the production `Workspace`. Each adds a stored fixture clock, controls
  that fail an access read or a lifecycle read or write, a random instance
  marker, and a test-only control route. `browserControls` in
  `browser-native.test-support.ts` and `runnerControls` in
  `runner-native.test-support.ts` drive them. Their
  `hibernate` helpers evict with `webSockets: 'hibernate'`, and they check
  the instance marker, as [Wake tests](../README.md#wake-tests) says.
- `browser-native-access.test.ts` checks the tab access clocks through
  member fences and a wake, expiry while access and lifecycle work wait,
  and expiry with failed lifecycle reads and writes. `closeBrowserPeers`
  waits until the object handled each tab close.
- `browser-native-suspension.test.ts` holds the first grant of a second tab
  after its real D1 read, then calls the real `suspendMemberLifecycle`
  RPC. `BrowserSuspensionProbe` in `browser-suspension.test-support.ts`
  records the committed first stage when the suspension closes the current
  tab. The `hold`, `entered`, `release`, and `suspension-entered` controls
  fix the order of these steps.
- The case checks that the first stage cleared the regular alarm keys and
  kept the lifecycle run lease `alarm:lifecycle:run`, the deferral, and the
  `browser` deadline. The platform alarm stays at that deadline. The held
  tab then registers after the close, and the final stage leaves no run
  lease or deferral.
- After a sign-out, the late tab stays open until its stored 15-second
  check. The `arm-due` control fires the platform alarm only when it is
  due on the fixture clock. The check then closes the tab. No alarm stays
  set, and the fence stays. After its history, the late tab gets only the
  `ports.updated` frame with a null list that the suspension's workspace
  stop sends. The current tab gets no frame after its history.
- `runner-native-access.test.ts` checks the token deadline through a wake
  and the fences, the token check of a Mac ping, and a native alarm that
  returns while a token read waits. `runner-native-delivery.test.ts` checks
  that a wake resends no command or repair, keeps file ownership, and
  revives no replaced runner. The stored state holds no login after the
  wake. A `message` command then carries no credential, and each `turn`
  command carries a turn token and no login.
- `runner-version.test.ts` checks the version refusal of a `hello`. A
  version below `RUNNER_PROTOCOL_VERSION` closes before any command and
  fails each waiting turn once with `runner_protocol_unsupported`, with an
  old, a current, or a missing pin. A higher version, and a runner below
  the pin, close and change no turn. A supported runner gets gateway
  turns with a pin of 1, 2, or none. `runner-native-version.test.ts`
  retires a saved runner record of an unsupported version, or with no
  version, through a wake. The object stays usable, and a lower or missing
  version fails the turns once.
- `browser-native-close.test.ts` and `runner-native-close.test.ts` make a
  close the first event after a wake, with no restored peer. Their entries
  give the `prepare-close` and `close-handled` controls of
  `NativeCloseProbe`, as
  [Native close probe](../test-support/README.md#native-close-probe) says.
  Each case checks the new instance, a close as the first event, the
  omitted socket ID, and one completed close callback with no error.
- The tab case then checks that the saved registration is gone and that no
  alarm stays set. It also checks one close count, no access read, the
  server close reply, and no frame after the history.
- The runner case checks that the saved current runner is gone and that no
  alarm stays set. It also checks one disconnect hook, the file detach of
  the same connection ID, and no second `welcome`, hello hook, or ready
  hook.
- In both cases, a later settle or close changes nothing. So the cleanup
  runs once.
- `tab-access.test.ts`, `tab-deadlines.test.ts`, and `security.test.ts`
  check the tab grants on the native browser peers of `createChatFixture`.
  `runner-access.test.ts` and `runner-current-access.test.ts` check the
  runner token rule on its native runner peers. These peers have no
  physical socket, so their access checks use the injected scheduler of
  the fixture clock.
- `write-access.test.ts` holds a rename at its body read or in the queue.
  Then one access fact ends, such as a sign-out, a removal from the org, or
  an archive. The rename gets the refusal that a new request would get, and
  saves nothing. A new refused request leaves its body unread.
- `integration/runner-output-durability.test.ts` bundles
  `runner-entry.test-support.ts`. That entry also answers a test-only
  `/inspect` fetch with the stored records. The test seeds an encrypted env
  capture in D1, and finds no raw held text in the records. After a wake,
  the hidden continuation shows once, and a skipped event number gets a
  `resend`.
- `runner-files-durable.test.ts` keeps its original sockets through a wake
  between report parts. A later eviction that closes the sockets still
  keeps the complete stored report.
- Read stored records through a fetch path before an eviction, as the
  GitHub store tests do. A direct RPC read of the records can keep the
  eviction waiting.
- Most tests in `integration/` run the production Worker entry in
  Miniflare. They check the forwarding, the runner socket, the workspace
  lifecycle, and the app API. `integration/run-browser-harness.mjs` serves
  a production app build through that entry.
  [Outer Worker tests](integration/outer-worker-tests.md) describes them.
- `integration/workspace-title-recovery.test.ts` checks title-write
  recovery. Its first-session case uses `recoveryWorkspaceFixture` to
  restart the real workspace object before both tabs open. It checks
  titles through the sessions route, ordered events for both tabs,
  duplicate receipts, and a member name after another restart.
- `integration/workspace-title-request.test.ts` uses
  `workspace-title-entry.test-support.ts` to capture model inputs. It checks
  the title source after a native restart, null API names, the D1 name, and
  the first session.
- `workspace-title.test.ts` checks the empty-name rule, including member
  names that match old defaults.
- `workspace-title-policy.test.ts` checks the name before the first model
  call and each retry. It also checks that a skipped runner title ends its
  repair without a title event.
- `integration/workspace-title-guards.test.ts` checks a workspace route name,
  a confirmed runner title that changes nothing, and detail and repair
  reads after a restart. It also checks a pending model title after Archive,
  org suspension, and org deletion.
- `first-message.test.ts` checks that a sender who is not the assigned
  sender of a first message gets a refusal, and that no session is stored.
  It also checks the initial null title and unchanged repeated admission.
- `workspace-summary.test.ts` checks the stored summary: the event cursor,
  the visible output, and the dispatched work. Queued input and metadata
  are not output.
