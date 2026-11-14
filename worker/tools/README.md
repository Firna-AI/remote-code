# Agent workspace tools

This area handles workspace, session, section, and preview calls from agents inside a Conductive workspace.
It implements the [agent-tool requirements](../../docs/protocol/agent-tools.md).
It uses the existing [shared contracts](../../src/shared/README.md) and D1 tables.
The [workspace name migration](../../migrations/202611081300_workspace_creation_name.sql) keeps an agent's chosen name through creation retries.
The [first session title migration](../../migrations/202611111230_workspace_first_session_title.sql) keeps a requested first session title in the same way.
[Workspace calls](workspaces.md) gives the get, rename, move, and archive routes, the list options, and the replay of a create.
[Session management calls](sessions.md) gives the session get, rename, close, and stop routes, the message get, and the session list paging.
[Section and preview calls](sections-and-previews.md) gives the section create and delete routes, and the preview list, open, and close routes.

The [Mac command feature](../devices/README.md) also uses this area's machine entry point.
`mac-command.ts` forwards only its fixed paths to the token's exact workspace object.
The real application dispatches those paths before the machine stub.
The object resolves the stored active sender and selects that sender's connected Mac.
Command reads use the returned `requestKey` in the URL.
The raw request ID stays in retry input and device messages.
The create handler, the session writes, the workspace rename and move routes, and the Mac command handler use `readJsonObject` from the [shared request reader](../http/README.md#json-request-objects).
The entry owns the 1,000,000-byte cap, and the reader owns the media type policy.
The entry preserves HTTP 413, and the handler preserves HTTP 415.
Direct handler tests also use the shared entry policy before dispatch.

## Handler

`createAgentToolsHandler` takes the database, the machine origin, the app origin, and `AgentToolServices`.
It accepts GET and POST at `MACHINE_PATHS.workspaces`, which is `/v1/tools/workspaces`, on that origin only.
It also accepts GET at `/v1/tools/repositories`, `/v1/tools/sections`, and `/v1/tools/models`.
It accepts the section writes and the preview routes, as [Routes](sections-and-previews.md#routes) says.
It accepts session list, transcript read, create, and send routes under `/v1/tools/workspaces/<workspaceId>/sessions`.
It also accepts session get, message get, rename, close, and stop routes there, as [Routes](sessions.md#routes) says.
It accepts GET at `/v1/tools/workspaces/<workspaceId>`, and POST at its `rename`, `move`, and `archive` paths, as [Routes and access](workspaces.md#routes-and-access) says.
It uses workspace bearer authentication instead of browser sessions.
It returns private responses with caching disabled.

The token must name a workspace that is not archived.
Its org must not be deleted.
Its current owner must still belong to that org.
The token must not be revoked.
The handler grants no access to other routes, methods, hosts, or sockets.

GET returns the number, web link, name, branch, state, and owner of every workspace in the calling org.
The owner gives `id`, `githubLogin`, and `displayName`, with no avatar.
The link uses the configured app origin, not the machine request origin.
It includes other owners' workspaces and archived workspaces.
Its optional filters and paging follow [Workspace lists](workspaces.md#workspace-lists).
The repository list reads the calling org's newest good image, in GitHub name order.
`current` marks the calling workspace's repository.
Without a good image, it returns HTTP 409 `image_required`.
The section list reads every section of that org in sidebar order.
`default` marks the default section.
The model list reads the configured models in their configured order.
Each model includes a boolean `fast` mark.
`defaultChoice` holds the owner's saved model and effort, else the app default, else `null`.
Its fast mode is always off.
An unavailable model list returns HTTP 503 `models_unavailable`.
All four lists need only the workspace token. They need no active turn.

## Session reads

The [session call contract](../../docs/protocol/session-calls.md) gives the access and replies.
`agentSessionsPath` and `agentSessionTranscriptPath` in [agent-session-paths.ts](../../src/shared/agent-session-paths.ts) build the machine paths.
The reserved workspace path value `current` resolves to the calling workspace from its token.
No new sandbox credential supplies that ID.
The handler and the real target object both check the target's org and the org's active state.
The object also checks its exact workspace identity before it reads chat storage.
An archived target remains readable. The caller's own token still needs its normal live-workspace access.

The session list includes closed sessions, in creation order with ID as the tie breaker.
Its optional `limit` and `offset` follow [Session list paging](sessions.md#session-list-paging).
It gives the choice, starter, title, closed mark, state, and session link.
Queued, running, and stopping work counts as `running`.
Without active work, a newest failed turn gives `failed`, and other cases give `idle`.
The reply also gives the target workspace summary and state.

The transcript route defaults to `detail=concise` and also accepts `detail=full`.
It uses the [chat copy builder](../chat/README.md#session-transcripts) without a browser session.
The serialized JSON reply stays within `AGENT_TRANSCRIPT_MAX_BYTES`, 32,000 UTF-8 bytes.
That leaves space below the published 10,000-token guidance for ordinary text and for the MCP wrapper.
A byte count does not promise a token count for every language or agent setting.

The default window contains the newest whole lines that fit.
`startLine` reads forward from a one-based line. `startOffset` counts UTF-16 code units in that line.
Offsets and fragments never divide a surrogate pair.
The reply gives `startLine`, `endLine`, `totalLines`, `startOffset`, and the exclusive `endOffset` within the last line.
Line offsets include a line's newline character. A final newline adds no empty line to `totalLines`.
`next` gives the next `{ line, offset }`, or null at the end.
A line larger than the budget returns a bounded fragment. Its continuation recovers the rest.
An out-of-range line or offset clamps to the last available content, so the reply remains useful.

## Session writes

Session create and send require an active stored calling turn and its current org member.
The stored turn gives the sender and the sending session. Input supplies neither identity.
The real object repeats the target org, active org, archived-workspace, member, and exact-object checks inside the chat queue.
`create_session` uses the sender's saved model choice, then the configured app choice.
Workspace creation keeps its owner's default model and effort.
Workspace and session creates run fast only with explicit `fast: true`, for a marked model.
A session send without `fast` keeps the session's fast mode.
[Fast mode](../../docs/protocol/fast-mode.md#agent-tools) gives the rules.
Rename, close, and stop use the same stored turn and queue checks, without admission or resume, as [Queued management](sessions.md#queued-management) says.

`ToolSessionWrite` carries the trusted caller and typed request to the object's `writeAgentSession` RPC.
Chat commits a request fingerprint and its acceptance in the same transaction as the session and message.
The key hashes the operation, calling workspace, calling session, sender, and request ID.
Retries reuse accepted IDs and choices before resolving defaults or checking logins again.
A repeated send can name its original or linked receiving session.
A changed request with an occupied ID gets the existing session or message conflict error.

Send uses the normal chat login, linked-session, model, and turn-selection rules.
A message that joins a turn keeps that turn's original sender.
An empty create starts no turn or computer. A create with a first message commits both together.
The shared footer builder preserves the task text and adds the sending-session link to both calls and workspace creation.
The title request excludes only an exact canonical final footer. Other task text stays intact.

`AgentSessionWriteResponse` gives the accepted session with its link, message, turn, and event number.
Its workspace summary and `resume` describe the current request.
`resume.state` is `not_needed`, `queued`, `waiting`, or `failed`.
`waiting` means no new start was queued, including a failed first start that still needs Try again.
A failed resume check keeps the acceptance and returns its existing code and message in `resume.error`.
A retry can attempt the normal resume again without another message.
The production composition queues a permitted resume after durable admission and waits only for that enqueue.
Provider startup remains with the lifecycle alarm.

## Workspace creation

POST binds the repository and section to the calling org.
It inherits the calling workspace's current owner.
It preserves the first message text.
It cleans an optional name with `sessionTitleFrom` in the [shared title helper](../../src/shared/session-title.ts).
It keeps the first line with text, makes white space single, and removes one final full stop while keeping an ellipsis.
It cuts at 60 Unicode code points, at a whole word when possible.
It keeps each underscore, and it does not use `modelTitleFrom`, the title model rule that changes underscores to spaces.
The tool description and the CLI help ask the agent to avoid underscores unless the user asks for them, as [Names from the workspace tools](../../docs/protocol/tool-names.md) says.
A blank result counts as no name, and the app shows "Untitled".
The create answer gives the stored name and the first session's absolute `sessionLink`. The branch and stored city keep the city.
The tools preserve string names, including blank names, and ignore names of other types.
An optional `firstSessionTitle` and an optional `requestId` follow [Creation replay and first title](workspaces.md#creation-replay-and-first-title).
A repeat with the same request ID resolves before the default lookup below.
It reads saved owner preferences when the request omits model or effort.
The injected account policy supplies defaults when no preference exists.
Production returns HTTP 503 `default_model_unavailable` when no required default choice exists.
Only a test service gives `owner_defaults_unavailable` for a missing default integration.
It does not set a new product default.
A fully specified model and effort need no default lookup.

POST also requires `X-Conductive-Turn-Id`.
The `callingTurn` service must read the active turn from the calling workspace's turn store.
It must return the matching workspace ID, turn ID, session ID, and sender user ID.
The handler checks these IDs and the sender's current org membership.
It never uses the workspace owner as a substitute sender.

`createWorkspace` receives one `ToolWorkspaceCreation` value.
The value keeps the inherited owner separate from the first message sender.
It also carries the stable first-message ID and the optional first session title.
The lifecycle service must keep the first message durably and start it at once.
It must use the latest good org image.
It must use the sender's agent login.
After admission, a failed first start keeps the accepted workspace, its number, and its first message.
The create call reports that failure, as
[A failed first start](../../docs/protocol/create-a-workspace.md#a-failed-first-start) says.

An org suspension refuses the shared workspace token rule before agent tool calls.
The same rule prevents Mac commands and their later approvals and results.

## Release tools

The [Rust tools crate](../../crates/cnd-tools/README.md) supplies the CLI and MCP server.
The sandbox release includes both in its `conductive` program.
The [system installer](../../image/install-system.sh) links
`/usr/local/bin/conductive` to `/opt/conductive/current/conductive`.
Image builds install this release through the normal software step.
They write no separate tool source files or launcher.
`WORKSPACE_TOOLS_MCP` supplies the executable and arguments for agent registration.
The runner supplies credentials and active turn context at runtime.

## Production composition

The production machine route calls `productionAgentTools` in [composition.ts](composition.ts).
It resolves the calling turn through `Workspace.callingToolTurn` and the real chat store.
It reads the configured account default model when the owner has no saved preference.
[workspace-create-composition.ts](workspace-create-composition.ts) calls the normal workspace lifecycle with a separate owner and sender.
It also replays a saved creation.
It waits for creation to finish before it returns the workspace and session.
[workspace-write-composition.ts](workspace-write-composition.ts) sends a rename or a move to the app's metadata write, and an archive to the workspace object.
Session gets, message gets, and session management call the target object's RPCs with the app origin.
[section-composition.ts](section-composition.ts) runs the app's section action as the sender.
Preview calls reach the target object's `agentPreviewCall` with the app origin.

Each org build installs the newest sandbox release through the software step.
The two runner providers register [`WORKSPACE_TOOLS_MCP`](../../src/shared/agent-tools.ts) beside `computer`.
The [runner](../../runner/README.md) supplies the machine origin, workspace token,
and active turn ID at runtime. The image stores no such credential.

No git credential endpoint is implemented here.
[GitHub tokens](../../docs/protocol/github-tokens.md) states its rule.

## Checks

Run `npm run test -- worker/tools` from the repository root.
The handler tests use the existing real local D1 harness.
The tests call the HTTP routes directly and need no Rust toolchain.
[handler.command-inputs.test.ts](handler.command-inputs.test.ts) checks workspace creation and resource replies.
[handler.resource-reads.test.ts](handler.resource-reads.test.ts) checks token-only resource lists.
[handler.management.test.ts](handler.management.test.ts) checks management route inputs and replies.
Workspace handler tests inject the lifecycle and active-turn services.
[sessions.test.ts](sessions.test.ts) uses production composition, native chat storage, and a stored calling turn.
CLI parsing, reply validation, and MCP protocol tests live in the Rust tools crate.
The production services live in [composition.ts](composition.ts).
The real-object route tests live in [worker/features](../features/).
[Tests](workspaces.md#tests) lists the tests of the workspace calls, and [Tests](sessions.md#tests) those of session management.
[Tests](sections-and-previews.md#tests) lists those of the section and preview calls.

## Key code

- [handler.ts](handler.ts) owns the public machine handler and token gate.
- [input.ts](input.ts) narrows workspace creation inputs and stored model choices.
- [workspace-replies.ts](workspace-replies.ts) narrows the created workspace reply and stored sender fields.
- [create.ts](create.ts) builds the stable first-message ID and tries a replay. It then resolves the owner, sender, section, and model choice.
- [lists.ts](lists.ts) reads the four lists and resolves the listed default choice.
- [store.ts](store.ts) reads the token's workspace, members, owner defaults, sections, and repository admission in D1.
- [workspace-routes.ts](workspace-routes.ts) matches the workspace routes and runs their reads and writes.
- [workspace-input.ts](workspace-input.ts) reads the options of the workspace list.
- [workspace-data.ts](workspace-data.ts) queries the workspace list and the details of one workspace.
- [workspace-write-composition.ts](workspace-write-composition.ts) runs a rename, a move, or an archive as the sender.
- [workspace-create-composition.ts](workspace-create-composition.ts) completes a create and its replay.
- [agent-workspaces.ts](../../src/shared/agent-workspaces.ts) holds the workspace path builders.
- [services.ts](services.ts) defines the lifecycle and active-turn integration boundary.
- [session-routes.ts](session-routes.ts) parses the machine session routes and read query options, and sends management to `manageSession`.
- [session-page.ts](session-page.ts) reads the session list `limit` and `offset`.
- [session-summary.ts](session-summary.ts) builds one session entry and its state.
- [session-read-workspace.ts](session-read-workspace.ts) holds the trusted session list, get, message, and transcript read RPCs.
- [agent-sessions.ts](../../src/shared/agent-sessions.ts) holds the transcript byte budget.
- [session-input.ts](session-input.ts) narrows session create and send inputs while preserving message text.
- [session-write-composition.ts](session-write-composition.ts) preserves admission while applying the normal open/resume policy.
- [message-text.ts](message-text.ts) builds the canonical sending-session footer and selects title input.
- [workspace.ts](workspace.ts) exposes the trusted calling-turn, session write, and session management RPCs, with their queued access check.
- [session-access.ts](session-access.ts) reads a target workspace inside the calling org, including archives.
- [section-routes.ts](section-routes.ts) and [preview-routes.ts](preview-routes.ts) match the section and preview routes and read their inputs.
- [section-composition.ts](section-composition.ts) calls the app's `featureSectionWrite` as the sender and shapes its reply.
- [agent-sections.ts](../../src/shared/agent-sections.ts) and [agent-previews.ts](../../src/shared/agent-previews.ts) hold the section and preview paths.
- [Rust tool contracts](../../crates/cnd-runner-interface/src/tools/mod.rs) own the request and reply types. The generator writes their TypeScript under `src/shared/generated/`.
- [Sandbox tools](../../tools/README.md) describe the commands and runtime environment.
