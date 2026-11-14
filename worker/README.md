# Worker backend

This Cloudflare Worker serves the browser API for Conductive.
It checks sign-in, app access, and org access before it dispatches protected app requests.
It forwards the browser chat routes of a workspace to the Durable Object of that workspace.
These requests keep the body limit of the Worker entry and the host and `Origin` checks.
The Worker runs the session and app access checks for them, without reading the body.
The Durable Object runs the complete request gate.
Durable Objects hold workspace state, and D1 holds shared records.
The [security area](security/README.md) owns the app request gate.
The [HTTP area](http/README.md) owns the request body limit at the Worker entry.
The [sandbox area](sandbox/README.md) owns the Boat adapter and the use of the app's one Boat key.
The Worker reads that key from the Worker secret `BOAT_API_KEY`.
The Worker variable `BOAT_ORG_ID` names the app's Boat organization.
The [chat backend](chat/README.md) owns the sessions, the messages, and the event history of each workspace.
The [lifecycle](lifecycle/README.md) records each image's runner version and copies it before each new computer allocation.
The chat backend accepts only runner protocol version 2, which the packaged runner sends and each full image build records.
It closes a runner of another version, or below that pin, before the welcome or any command.
A version below 2 also fails the waiting and running turns and a waiting start, as [Runner versions](../docs/protocol/version-pins.md#runner-versions) says.
The [operator area](operator/README.md) owns the operator's app-wide numbers,
suspensions, waitlist approvals, invite codes, sign-up pause, and waitlist switch.
New accounts wait for app access unless an operator identity, open sign-up,
or a valid join code grants it at sign-in. Open sign-up is on while the
waitlist switch is off and sign-ups are not paused. During open sign-up, the
[app access gate](security/README.md#app-access-gate) also grants access to a
waiting user at their next request. Otherwise the gate admits only session,
waitlist, sign-out, and personal invitation requests while the user waits.
It refuses other API requests and upgrades with 403 `access_required`,
including operator and org requests.

## Routes

On the root domain, the Worker serves Astro's built site through the assets
binding. Listed pages use paths such as `/terms`. Listed files other than
HTML and the file list load under `/_site/`. `/favicon.ico` also serves the
brand favicon. Other paths get the built unknown-address page with `404`.
The [marketing README](../src/marketing/README.md#how-the-worker-serves-it)
gives the methods, markers, headers, policy, and unavailable-build response.

The app host serves the built agreement page through GitHub sign-in.
It also serves listed site files under `/_site/`. Other site paths get the
app page, as unknown app paths do.

On the app hostname, the Worker serves these API routes:

- The health check, GitHub sign-in and its callback, and the sign-in exchange of the Mac app.
- The session, sign-out, the org list, a new org, and one org.
- The waitlist state and code use, through the [waitlist backend](waitlist/README.md).
- The account, its default model, its agent logins, the model list, and Get started.
- The start and poll of a Codex ChatGPT device code sign-in, through
  [Codex authentication](codex-auth/README.md).
- The sections, the repositories, the members, and the workspace list of an org.
- The list, read, create, update, and delete routes of an org's routines, Run now, and run history.
- Leave org, under the existing last-active-admin rule.
- The create, read, resume, and activity routes of a workspace.
- The view and the read mark of a workspace.
- The Mac device routes.
- `GET /api/feedback`, the reply address of feedback, and `POST /api/feedback`, the send of feedback, as [Feedback routes](app-api/feedback.md) says.
- `GET /api/operator/overview`, the app-wide numbers for operators.
- `GET /api/operator/orgs`, the org search and cursor pages for operators.
- `GET /api/operator/users`, the user search and cursor pages for operators.
- `GET /api/operator/orgs/<orgId>`, the org page for operators.
- `GET /api/operator/users/<githubId>`, the user page for operators.
- The operator's waitlist list and approval, invite code list, creation and
  disable, sign-up pause, and waitlist switch, as the [operator area](operator/README.md#waitlist-codes-and-sign-ups) says.
- The operator's suspension of users and orgs, as the [operator area](operator/README.md) says.
- `DELETE /api/operator/users/<githubId>/suspension`, the operator's lift of a user suspension.
- `DELETE /api/operator/orgs/<orgId>/suspension`, the operator's lift of an org suspension.
- The chat routes of a workspace: its sessions and their actions, the chat history, and the events socket.

On the app hostname, the Worker also serves `/github/install` and `/github/setup`, before the request gate, with no session.
[`github-setup.ts`](github-setup.ts) holds both.
A browser starts each install or change of the GitHub App at `/github/install?from=<screen>`.
The Worker keeps the screen in the return cookie, then sends the browser to the install page of the GitHub App.
GitHub sends the user to `/github/setup` after an install or a change.
That route sends a browser back to the screen of the return cookie, or to Home, and deletes the cookie.
It answers an install from the Mac app with a page that sends the user back to the Mac app.
[The GitHub App](../docs/protocol/github-banner.md#the-github-app) states the rules.

The [app API](app-api/README.md) serves the account, shell, workspace, and feedback routes after the request gate.
`CONDUCTIVE_FRAME_SOURCES` adds trusted HTTPS desktop stream origins to the asset policy.
Use the same configured sources in the web app and Mac app.
The model list and the default model come from Worker variables, as [Deployment inputs](../docs/deployment.md#models) says.
The optional Worker secret `FEEDBACK_EMAIL` names the team inbox of feedback.
[The email](app-api/feedback.md#the-email) of the feedback routes gives the local log, the 503 without that inbox, and the 502 of a failed send.

The Worker also serves org settings, repository choices, sections, member writes,
workspace metadata, Archive, and Restore, image builds and logs, account GitHub access,
and pending invitations with explicit acceptance.
The [feature shell](app-api/feature-shell.ts) implements the shared shell writes.
The [workspace features](features/workspace.ts) dispatch files, terminal,
previews, and desktop inside the real workspace object.
The [GitHub composition](features/github.ts) stores banner updates in the common chat stream.
The [routines area](routines/README.md) stores saved prompts and their triggers.
It validates schedules and resolves author-filter logins at save.
Its owner-only Run now starts a stored run as a new workspace.
The run starter joins repeated creates through a stable first-message ID and returns before the workspace start ends.
The runs list projects the current workspace state and retains failed-start and first-turn causes.
Three failed runs in a row turn the routine off.
The minute schedule scan calls the same starter.
Signed pull request webhooks store matching runs before the reply.
Their background tasks call the same starter.
The minute scan recovers a queued run if its background task did not start it.
Pull request runs keep their own branch and their workspace base branch.

On the machine hostname, the Worker serves the Mac command routes, the git
credential route, the image source credential route, the
[software image deploy route](software-image/README.md#deploy-route), the
[workspace tools](tools/README.md), GitHub webhooks, the model gateway, and the runner socket.
These handlers use their own machine credentials and skip the browser gate.
The [model gateway](model-gateway/README.md) accepts only a turn token.
It adds the starter's login to allowed Anthropic, OpenAI, or own endpoint requests.
Its request upload and model answer both stream.
The chat backend checks the login kinds of the runner before delivery.
Each `turn` command carries a turn token and never a real login.
ChatGPT sign-in requires declared support. Own endpoint turns use API-key mode.
The [tools composition](tools/composition.ts) reads the active stored turn.
It keeps the inherited owner separate from the sender of the first message.

The preview domain forwards each private preview to its workspace object.
Its authorizer redeems the one-use viewer grant before any sandbox request.
The object owns preview expiry and revocation beside its other alarm sources.
The `*/15 * * * *` Cron Trigger runs deleted-org maintenance and cleanup every 15 minutes.
It also removes expired Codex device sign-in records.
It also retries pending approval emails until delivery or 24 hours from
approval. [Approval delivery](operator/README.md#approval-email-delivery)
describes the saved messages and delivery keys.
It also repairs overdue workspace disk and archive alarms and org image refreshes after a 15-minute grace period.
It then advances unfinished software image builds and retries their cleanup
in the default provider account.
The repair checks at most 50 workspaces and 50 orgs per run.
It defers failed calls and logs counts when either limit leaves work pending.
The `* * * * *` Cron Trigger runs routine schedules and recovers old queued runs each minute.
The scheduled entry dispatches each trigger by its cron expression.
The [member composition](members/composition.ts) supplies the durable lifecycle hooks.

## Workspace object connections

One `Workspace` class serves each workspace object and each Mac broker object.
It accepts server sockets in three roles through the platform's [hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/): the events socket of a browser tab, the runner socket, and the Mac device socket.
These sockets keep their wire formats, so installed Mac apps and supported runners from older images need no change.

`WorkspaceSockets` in [native-sockets.ts](native-sockets.ts) is the only caller of `acceptWebSocket`.
It gives each socket a trusted role, and it sends each message, close, and error event to the owner of that role.
The constructor of `WorkspaceLifecycle` restores the open sockets inside `blockConcurrencyWhile`.
So no request, RPC call, alarm, or socket event runs before the restore ends.
A restore registers saved state only. It starts no model work, and it sends no second `welcome`, `device.connected`, or history.
A socket that its owner cannot restore closes.

Each attachment holds a format version, the role, a connection ID of at most 128 code units, and a generation.
A browser attachment also holds the app origin and the workspace number of its tab.
State that can grow and public metadata live in durable records: raw records under the `native:` key prefix, and the pending command and repair records of chat.
No attachment or native record holds a cookie, a workspace token, an agent login, a turn token, an env value, a transcript, or a growing ID list.

A wake keeps the original sockets and their state.
A real disconnect, a replacement, and a restart that closes the sockets still run their cleanup, such as the runner disconnect hook, the Mac drop, and the tab removal.
The runner and the Mac keep a durable generation and a retirement tombstone. So a closing older socket cannot take back the authority of a newer connection.
A close or an error can be the first event after a wake. Its owner then reads the saved state, and the cleanup runs once.
Production upgrades always pass a physical socket. Only a physical socket, accepted or restored, saves, arms, and retires native state.
A feature test can give a tab or runner owner an abstract peer inside the real object. That peer uses the same access logic.
Its access checks use the scheduler that the test injects. Production has no default timer for them.
[Open connections](chat/access.md#open-connections) and [Sleep and restore](devices/README.md#sleep-and-restore) give the state of each role.

### Alarms

`WorkspaceAlarms` in [features/alarms.ts](features/alarms.ts) keeps the due time of each source in its `alarm:<source>` marker, and it sets the one platform alarm.
The security sources are `browser`, `runner`, and `devices`. They use raw storage, so a member fence cannot refuse their writes.
The regular sources are the lifecycle tasks, `github`, `previews`, and `continue`. They use the guarded receiver storage, as [Lifecycle ownership](members/README.md#lifecycle-ownership) says.
[The object alarm scheduler](lifecycle/alarm-scheduler.md) gives the shared rules, such as the lifecycle run lease and the steps at the end of each run.

`Workspace.alarm` calls `WorkspaceAlarmRunner.alarm` in [features/workspace-alarm.ts](features/workspace-alarm.ts).
It takes the due security sources before any member fence or lifecycle check.
It runs the tab expiry at once. Runner, Mac, and regular work run as tracked tasks of `WorkspaceAlarmTasks`.
So the handler returns before a slow access read or provider call ends.
A due security source keeps a retry deadline until its owner replaces or clears it.
The regular task then checks the member fence and the org lifecycle generation. Then it calls `runWorkspaceAlarms` in [workspace-alarms.ts](workspace-alarms.ts).
While a fence pauses that work, a numeric deferral moves the platform alarm time of the regular sources. Each regular due time stays in its marker.
A member suspension clears the regular sources in two guarded stages, and both stages keep each security deadline, as [Lifecycle ownership](members/README.md#lifecycle-ownership) says.
Its final stage also cancels the lifecycle run lease and the deferral. So a suspended object keeps no regular retry. A Restore clears the deferral in its guarded transaction.
Provider and lifecycle writes stay fenced.

Tab and runner access checks run every 15 seconds. Tab grants last at most 30 seconds. Mac session checks run at least every 10 seconds.
The tab and runner owners save their next check before they read access.
Each owner closes a connection at its stored deadline, by the current clock.
A late alarm or a failed access read never extends a grant.

### The Mac heartbeat

The platform answers the exact Mac ping `{"type":"device.ping"}` with `{"type":"device.pong"}`, and the object does not wake.
That automatic response applies to every hibernation socket of one object.
So only a verified Mac broker object sets it, when it accepts or restores a Mac socket. The shared constructor never sets it.
So no browser or runner socket gets a Mac pong. The runner checks the token of each frame, also a Mac ping, before it reads the frame.
An automatic pong grants no command permission, and the session check still runs, as [Sleep and restore](devices/README.md#sleep-and-restore) says.

### Work that keeps the object active

An object whose open sockets all use these three roles can hibernate between its alarms and requests.
This work keeps the object active:

- An open terminal or preview socket. Its bridge holds an outbound socket to the sandbox, which cannot hibernate, as the [terminal](terminal/README.md) and [preview](previews/README.md) READMEs say.
- A request that waits, such as a Mac settings reply, a file read or diff, an attachment copy, an input activity write, a title model call, or a preview HTTP stream.
- A tracked alarm task, until it ends.

The code closes no terminal, drops no pending promise, and weakens no limit to make the object sleep.
So a workspace object stays active while a terminal socket is open, also while that socket is idle.
The Mac broker is a separate object, so it can sleep while a workspace object stays active.
No measurement of production sleep time, wake time, or cost saving exists.

### Wake tests

A wake test calls `unsafeEvictDurableObject(scriptName, 'Workspace', { name, webSockets: 'hibernate' })` of the pinned Miniflare.
The client sockets stay open while a new object instance restores.
Each fixture entry returns a random instance marker from a test-only route, and the test checks that the marker changed.
The marker never enters a product route or a wire frame.
An eviction without `webSockets` closes the sockets, so it tests the restart path, not a wake.
The native alarm handler returns before its tracked work ends. So a fixture that calls `alarm()` also awaits the protected `settledAlarms()`.
The native test harness and the lifecycle fixtures run only the stored alarms that are due, through `advanceScheduledAlarms`. They await `settledAlarms()` after each one.
An automatic pong does not show that queued socket work ended. So the device fixture reads its readiness route after each socket message.
A native fixture starts its client socket closes and `runtime.dispose()` together, and it awaits both.
[Chat backend tests](chat/tests.md) and the [device checks](devices/README.md#composition-and-checks) name the fixtures.

## Development

Run commands from the repository root with Node 24.
Run `npm run dev` to serve the app and local Worker.
Run `npm run typecheck` to generate Worker types and check the package.
Run `npm run test -- worker/security worker/http` to check the request gate and bounded reader.
Run `npm run test -- worker/chat/integration` to check the forwarding, the shell and workspace routes, and the create, Stop, resume, and send journey through the production Worker entry, with fake Boat and GitHub.
It also checks the runner start script.
Run `node worker/chat/integration/run-browser-harness.mjs` to serve a production app build through the local Worker, with fake Boat and GitHub.
[Outer Worker tests](chat/integration/outer-worker-tests.md#browser-harness) gives its settings.
Run `npm run test -- worker/operator` to check the overview and the suspension of users and orgs.
Run `npm run test -- worker/chat/adapter.test.ts worker/chat/browser-native-access.test.ts worker/chat/runner-native-access.test.ts worker/chat/runner-native-delivery.test.ts worker/features/security-alarms.test.ts worker/devices` to check the native sockets, their wake, and the shared alarm.
Run `npm run test -- worker/model-gateway worker/http/request-body.test.ts` to check turn token delivery, model forwarding, turn access, streamed answers, and upload limits.
The [test support area](test-support/README.md) supplies local D1 and fake providers.
[Deployment inputs](../docs/deployment.md) lists the bindings, variables, and secrets of a deployment.
`wrangler.jsonc` turns on the `global_fetch_strictly_public` compatibility flag.
So each global `fetch` takes the public Internet route, also to a hostname of this app.
Call other parts of the app through a binding or an RPC method, not a global `fetch`.

### Key Code

- [app.ts](app.ts) exports the Worker HTTP handler.
- [application.ts](application.ts) selects each host surface and dispatches the app and machine routes with their own access gates.
- [http.ts](http.ts): `privateResponse` adds private response headers. It preserves an explicit referrer policy and defaults to `no-referrer`.
  `previewResponse` adds the same security headers to each reply of the preview host. It keeps the cache rules that the preview code set. A reply without rules gets `no-store`, except a bare 304.
- [software-image/README.md](software-image/README.md) owns software image builds, the deploy token gate, and Cron cleanup.
- [lifecycle/repair.ts](lifecycle/repair.ts) repairs overdue disk, archive, and image alarms from the Cron Trigger.
- [marketing/site.ts](marketing/site.ts) serves the built root-domain site.
- [marketing/consent.ts](marketing/consent.ts) serves the built agreement page before GitHub.
- [routes.ts](routes.ts) dispatches protected app routes.
- [codex-auth/README.md](codex-auth/README.md) owns device authorization,
  encrypted ChatGPT sign-ins, and serialized refresh-token renewal.
- [http.ts](http.ts) serializes `HttpError` as the shared API error body, with optional structured details.
- [waitlist/route.ts](waitlist/route.ts) reads the signed-in user's waitlist state and uses invite or referral codes.
- [waitlist/grant.ts](waitlist/grant.ts) supplies the shared app access grant statements for D1 batches.
- [app-api/README.md](app-api/README.md) names the entry points of the account, shell, and workspace routes.
- [configuration.ts](configuration.ts): `appFrameSources` reads extra frame origins. Release admission reads validated newest-release metadata.
- [chat/router.ts](chat/router.ts) forwards the browser chat routes and the runner socket to the Durable Object of their workspace.
- [workspace.ts](workspace.ts) composes each workspace Durable Object. [workspace-lifecycle.ts](workspace-lifecycle.ts) exposes its lifecycle RPC methods and owns its [input activity](lifecycle/README.md#input-activity). Its constructor restores the native sockets, and it receives their message, close, and error events.
- [native-sockets.ts](native-sockets.ts): `WorkspaceSockets`, the trusted socket roles, the attachment check, the restore, and the dispatch of native socket events.
- [model-gateway/README.md](model-gateway/README.md): the machine model routes, credential replacement, header rules, stream cancellation, and turn-token checks.
  Each runner `turn` command carries one of these tokens.
- [warnings.ts](warnings.ts): `warnWorker`, the one console warning of the Worker. It writes one structured object with fixed text and selected safe fields. It copies no extra caller field, token, error message, request body, command output, or response body. `WarningRecord` names the logged object type. `CommandFailed` carries a failed command's state, exit code, and time-out.
- [warning-types.ts](warning-types.ts): `WorkerWarning`, the fixed warning kinds and their typed fields. Warning callbacks use this type too.
- [warning-values.ts](warning-values.ts): `WarningId.checked` accepts the canonical 43-character base64url IDs from `randomToken`. Other values become `unknown` in the log only. `warningCode` and `errorSummary` keep allowlisted codes and command states. A generic error has the fixed kind `error`, with no class name.
- [workspace-alarms.ts](workspace-alarms.ts): `runWorkspaceAlarms`, the dispatch of the regular owners of each alarm run: a running Continue, the lifecycle run, the previews, and GitHub. It runs the owners whose due time has come, then sets the alarm to the earliest stored due time.
- [features/alarms.ts](features/alarms.ts): `WorkspaceAlarms`, the one alarm scheduler of each workspace object. It keeps a durable due time for each owner: each lifecycle task, the previews, GitHub, Continue, and the `browser`, `runner`, and `devices` security sources. `scheduleWorkspaceAlarm` sets the one platform alarm. `suspendWorkspaceAlarms` is the alarm step of each member suspension stage. [The object alarm scheduler](lifecycle/alarm-scheduler.md) gives its rules.
- [features/workspace-alarm.ts](features/workspace-alarm.ts): `WorkspaceAlarmRunner`, the short native alarm handler, the security work before the fences, and the fenced regular work.
- [features/alarm-tasks.ts](features/alarm-tasks.ts): `WorkspaceAlarmTasks`, the tracked background work of an alarm.
- [members/workspace-receiver.ts](members/workspace-receiver.ts) fences suspension, Restore, and payload deletion.
- [operator/route.ts](operator/route.ts) serves the operator routes after the request gate.
- [routines/route.ts](routines/route.ts) serves routine records after the request gate.
- [routines/run-route.ts](routines/run-route.ts) serves Run now and paginated run history.
- [routines/run-starter.ts](routines/run-starter.ts) starts queued runs with the owner's logins.
- [routines/pull-request-dispatch.ts](routines/pull-request-dispatch.ts) applies author filters, trust, and loop guards before it stores pull request runs.
- [routines/schedule-scan.ts](routines/schedule-scan.ts) claims up to 50 due routines and retries up to 50 old queued runs each minute.
- [operator/approval-email.ts](operator/approval-email.ts) sends approval messages and retries pending deliveries from the scheduled entry.
- [mail-sender.ts](mail-sender.ts) shares Resend transport and local logging between the approval, invitation, and feedback emails.
  It writes the sender address, and the name and the media type of each attachment from a `CheckedImage`.
- [app-api/feedback.ts](app-api/feedback.ts): `feedbackRoute`, the feedback routes. [Feedback routes](app-api/feedback.md) gives their checks and their email.
- [security/gate.ts](security/gate.ts) checks access before it reads JSON request bodies.
- [http/request-body.ts](http/request-body.ts) applies the default and declared request body limits.
- [http/json-body.ts](http/json-body.ts) owns the shared JSON object parsing policy.
- [http/bounded-body.ts](http/bounded-body.ts) collects bounded body bytes and decodes and parses complete JSON bodies.
- [sandbox/transport.ts](sandbox/transport.ts) calls the fixed provider routes.

### Related Docs

- [Architecture](../docs/architecture.md)
- [Deployment inputs](../docs/deployment.md)
- [Access and security](../docs/protocol/access-and-security.md)
- [Waitlist](../docs/protocol/waitlist.md)
- [Sign-ups](../docs/protocol/sign-ups.md)
- [Feedback](../docs/protocol/feedback.md)
- [Chat and events](../docs/protocol/chat-and-events.md)
- [Agent runner](../docs/protocol/agent-runner.md)
- [Workspaces and sandboxes](../docs/protocol/workspaces-and-sandboxes.md)
- [Routines](../docs/protocol/routines.md)
