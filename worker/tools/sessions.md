# Session management calls

This page belongs to the [agent workspace tools](README.md). It gives the
code paths of the session get, rename, close, and stop routes, the get of
a message, and the paging of the session list.
[Session management](../../docs/protocol/session-management.md) and
[Session calls](../../docs/protocol/session-calls.md) state their
requirements. [Agent tool access](../../docs/protocol/agent-tool-access.md)
states the reach, the turn rule, and the rights of the sender.
[Rust tool contracts](../../crates/cnd-runner-interface/src/tools/mod.rs) own the request and reply types.
[agent-session-paths.ts](../../src/shared/agent-session-paths.ts) holds the path builders.

The CLI and the MCP server offer these routes and the paging options, as
[Workspace tool calls](../../tools/calls.md#sessions) says. The chat shows
a tool stop with "Stopped from" and the session chip of the stopping
session, as [Sends and Stop](../../src/chat/loads-and-sends.md#sends-and-stop)
says. The copy of a transcript gives that session's link.

## Routes

| Call | Route | Reply |
| --- | --- | --- |
| Get a session | `GET .../sessions/<sessionId>` | `AgentSessionResponse` |
| Get a message | `GET .../sessions/<sessionId>/messages/<messageId>` | `AgentGetMessageResponse` |
| Rename | `POST .../sessions/<sessionId>/rename`, with `title` | `AgentSessionResponse` |
| Close | `POST .../sessions/<sessionId>/close`, with an optional `stopRunningTurn` | `AgentSessionResponse` |
| Stop | `POST .../sessions/<sessionId>/stop` | `AgentStopSessionResponse` |

- Each route starts with `/v1/tools/workspaces/<workspaceId>`. The target
  `current` resolves to the calling workspace from its token.
- `session-routes.ts` matches the routes. A read allows only GET, and a
  write allows only POST. The session list keeps GET and POST.

## Reads

- A read needs only the workspace token. `toolSessionWorkspace` reads the
  target inside the calling org, also an archived target.
- `session-read-workspace.ts` holds the trusted read RPCs of the workspace
  object: `listAgentSessions`, `getAgentSession`, `getAgentMessage`, and
  `readAgentSession`. Each reads chat storage of its exact workspace.
- `toolSessionSummary` in `session-summary.ts` builds each session entry:
  its ID, link, title, choice, starter, state, and closed mark.
- `getAgentMessage` finds the session first, so an unknown session gives
  HTTP 404 `session_not_found`. A message that the store does not hold, or
  that belongs to another session, gives HTTP 404 `message_not_found`.
- A message reply gives the stored ID, session, sender, text, state, and
  acceptance time. Its `turnId` comes from the stored message-turn record,
  else it is `null`.

## Session list paging

- `sessionPageInput` in `session-page.ts` reads `limit` and `offset`.
  A limit is 1 to 100. An offset is a nonnegative safe integer.
- A malformed value gives HTTP 400 `invalid_input`.
- `listAgentSessions` keeps creation order with the ID as the tie breaker,
  and it keeps closed sessions.
- `hasMore` is in the reply only when the call gives a limit.
- A call without options gives every session.

## Queued management

- A write calls `requireCallingToolTurn`. The stored active turn gives the
  sender and the calling session. The request names neither.
- The production composition calls `manageAgentSession(input, origin)` in
  `workspace.ts` on the target's workspace object, with the app origin.
- That RPC calls `WorkspaceChat.manageToolSession`. The chat queue first
  runs `writeAccess`. It reads the target in the calling org, and refuses
  an archived workspace with HTTP 409 `workspace_archived`. It then checks
  that the sender is still a member who is not suspended, else HTTP 403
  `membership_required`.
- [manageToolSession](../chat/key-code.md) then makes the change in one
  chat transaction. The queue flushes pending runner commands afterwards,
  so an interrupt reaches the runner after its commit.
- Management uses no message admission and no resume. So a rename, a
  close, or a stop starts no computer.
- A rename cleans the title once with `sessionTitleFrom`. A blank result
  gives HTTP 400 `invalid_input`. The shared `renameSession` saves it, as
  the browser rename does. No automatic title replaces it.
- A close takes an optional boolean `stopRunningTurn`. Another type gives
  HTTP 400 `invalid_input`. `closeSession` refuses a running turn without
  the choice with HTTP 409 `stop_confirmation_required`. A queued turn
  needs no choice. A close with a stop closes the session when that turn
  ends.
- A stop of a session without an active turn returns `turnId: null` and
  `state: 'idle'`. Otherwise the stop returns `stopped` for a queued or
  ended turn, and `stopping` while the runner stops the turn.
- Each reply gives the target workspace and the session entry. A stop
  reply also gives `turnId` and `state`.

## Stop source

- A tool stop, and a tool close that stops a turn, pass
  `{ requestedBySession: { workspaceId, sessionId } }` to the chat. The IDs
  come from the stored calling turn, never from the request body.
- The reference holds IDs only, and no origin. The app origin joins it only
  when a copy or a reply presents it.
- [Stop requests](../chat/README.md#stop-requests) in the chat keep the
  first requester of each turn and emit its event before the interrupt.

## Tests

The tests use the production Worker, real D1, native workspace storage,
and a real stored calling turn. `session-management.test-support.ts`
builds their HTTP requests.
The [Rust tools crate](../../crates/cnd-tools/README.md) tests CLI parsing and MCP calls.

- `sessions.test.ts`: session creation, exact message text, request replay, transcripts, defaults, and Worker refusals.
- `session-management-reads.test.ts`: exact session and message facts
  across workspaces, archived reads, and session list paging edges.
- `session-management-writes.test.ts`: a rename of another workspace's
  session as the stored sender, and closes of running and queued sessions
  with no computer start.
- `session-management-stop.test.ts`: the first tool stopper across a later
  browser stop, a restart, and the copy, an idle stop, and a stop of the
  calling session.
