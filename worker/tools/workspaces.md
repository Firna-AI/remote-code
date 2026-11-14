# Workspace calls

This page belongs to the [agent workspace tools](README.md). It gives the
code paths of the workspace get, rename, move, and archive routes, the
options of the workspace list, and the replay of a create.
[Workspace calls](../../docs/protocol/workspace-calls.md) states their
requirements. [Agent tool access](../../docs/protocol/agent-tool-access.md)
states the reach, the turn rule, and the rights of the sender.
[Rust tool contracts](../../crates/cnd-runner-interface/src/tools/mod.rs) own the request and reply types.
[agent-workspaces.ts](../../src/shared/agent-workspaces.ts) holds the path builders
`agentWorkspacePath` and `agentWorkspacePaths`.

The CLI and the MCP server offer each of these routes, the list options,
the first session title, and the create request ID, as
[Workspace tool calls](../../tools/calls.md#workspaces) says.

## Routes and access

| Call | Route | Reply |
| --- | --- | --- |
| Get | `GET /v1/tools/workspaces/<workspaceId>` | `AgentWorkspaceResponse` |
| Rename | `POST /v1/tools/workspaces/<workspaceId>/rename`, with `name` | `AgentWorkspaceResponse` |
| Move | `POST /v1/tools/workspaces/<workspaceId>/move`, with `sectionId` | `AgentWorkspaceResponse` |
| Archive | `POST /v1/tools/workspaces/<workspaceId>/archive` | `AgentWorkspaceResponse` |

- `workspace-routes.ts` matches these fixed routes. A read allows only GET,
  and a write allows only POST.
- The reserved target `current` resolves to the calling workspace from its
  token. Each other target must be a workspace of the calling org. An
  unknown target gives HTTP 404 `workspace_not_found`.
- A get needs only the workspace token. It also reads an archived
  workspace.
- A write calls `requireCallingToolTurn`. The stored active turn gives the
  sender. The sender must still be a member of the org who is not
  suspended. The request supplies no identity.
- A write reads the target before it acts. Its reply reads the target again,
  so it shows the stored result.

## Workspace details

`toolWorkspaceDetail` in `workspace-data.ts` builds `AgentWorkspaceDetail`:

- the fields of a list entry, with the owner as `id`, `githubLogin`, and
  `displayName`, and no avatar. A missing display name is `null`.
- the repository as `id`, `fullName`, and `defaultBranch`
- `baseBranch`: the stored base branch, else the repository default branch
- the section as `id` and `name`
- `createdAt`, and `lastActivityAt`, the row's `updated_at`, whose age the
  workspace list of the app shows
- `archivedAt`, and `restoreUntil` while a sandbox is kept

## Rename and move

- Both writes call `changeWorkspaceMetadata` in the
  [app API](../app-api/README.md#key-code). The browser route uses the same
  function. It keeps the app's member check, the refusal of an archived
  workspace with HTTP 409 `workspace_archived`, and the section check with
  HTTP 404 `section_not_found`. It also keeps the guarded D1 write and the
  publication of the workspace metadata.
- A rename cleans the name with `sessionTitleFrom`, as
  [Names from the workspace tools](../../docs/protocol/tool-names.md) says.
  A blank result gives HTTP 400 `invalid_input`. The branch stays.
- The stored name blocks later automatic titles, because the app names only
  a workspace without a name.
- A move puts the workspace first in its destination section. A move to
  the section that already holds the workspace changes nothing.

## Archive

- An archive calls the `archiveWorkspace` RPC of the workspace object, as
  the Archive of the app does. `workspace-write-composition.ts` makes this
  call with the sender as the user.
- Only the workspace owner or an org admin can archive. Any other sender
  gets HTTP 403 `archive_forbidden`, and nothing changes.
- An archive of an archived workspace changes nothing.
- An archive of the calling workspace stops its sandbox and revokes its
  token. So the calling turn ends, and the caller can miss the reply.

## Workspace lists

`workspace-input.ts` reads the query options of `GET /v1/tools/workspaces`.
`listToolWorkspaces` in `workspace-data.ts` applies them.

| Option | Value |
| --- | --- |
| `ownerId` | An exact member ID. An unknown ID gives an empty list. |
| `state` | One workspace state. |
| `repositoryId` | An exact repository ID. |
| `query` | Text after trimming. A blank value counts as no option. |
| `updatedSince` | Signed epoch milliseconds, a safe integer, with no lower bound. |
| `archived` | `true` or `false`. |
| `limit` | 1 to 100. |
| `offset` | A nonnegative safe integer. |

- The options combine with AND.
- `query` is a literal substring of the name. Both sides compare in
  Unicode lower case. A workspace without a name matches no text.
- `updatedSince` compares with the row's `updated_at`.
- `archived` uses the archive time and the archived state of the row.
- The list keeps creation order, with the ID as the tie breaker.
- `hasMore` is in the reply only when the call gives a limit.
- A malformed option gives HTTP 400 `invalid_input`.
- A call without options gives every workspace of the org, also the
  archived ones.
- The owner filter reads no login and has no mine form.

## Creation replay and first title

- `createFromTool` in `create.ts` hashes the operation, the calling
  workspace, the calling session, the sender, and the request ID. The hash
  is the ID of the first message.
- A create without `requestId` hashes a new random value, so it never
  replays. The current CLI and MCP server send a new request ID when the
  agent gives none. Tools from an older org image send none.
- `replayWorkspaceCreation` runs before the current defaults, the
  repository check, the section choice, and the name cleaning. It calls
  `replayCreation` in the [lifecycle](../lifecycle/key-code.md), which
  joins the saved claim, plan, and admission of that message ID.
- So overlapping retries join one workspace and one provider allocation.
  After a restart or a lost reply, a retry keeps the workspace, its number,
  its session, its message, its choice, and its first message. The reply
  shows the current workspace metadata.
- A retry of an accepted create whose first start failed returns the same
  HTTP 502 `workspace_start_failed`. It allocates no second computer and
  does not retry the start.
- `firstSessionTitle` travels in the creation plan, in its
  `first_session_title` column, and in the start job, to the
  [chat first-message admission](../chat/key-code.md). Admission cleans the
  title once with `sessionTitleFrom`. It saves the title in the same
  transaction as the session, before the message.
- A blank title leaves the session without a title. A stored title blocks
  the workspace title from replacing it.
- `workspace-create-composition.ts` accepts the first message, records the
  calling workspace as the parent, and waits for the creation.

## Tests

[handler.management.test.ts](handler.management.test.ts) checks the management route inputs and replies.
The [Rust tools crate](../../crates/cnd-tools/README.md) tests CLI and MCP request construction.

- `workspace-reads.test.ts`: token-only reads of archived workspace facts,
  and the refusal of another org.
- `workspace-actions.test.ts`: a rename that automatic naming keeps, stale
  and archived writes, moves to a section top, unchanged same-section moves,
  stored-sender archive rights, and a self-archive that stops its turn and
  revokes its token.
- `workspace-lists.test.ts`: each filter alone and together, paging edges
  and `hasMore`, and malformed options.
- `workspace-creation.test.ts`, with `workspace-creation.test-support.ts`:
  overlapping creates, a lost reply after a restart or changed defaults, a
  titled first session, and the replay of a failed first start.
