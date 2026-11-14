# Section and preview calls

This page belongs to the [agent workspace tools](README.md). It gives the
code paths of the section create and delete routes, and of the preview
list, open, and close routes.
[Section and preview calls](../../docs/protocol/section-and-preview-calls.md)
states their requirements.
[Agent tool access](../../docs/protocol/agent-tool-access.md) states the
reach, the turn rule, and the rights of the sender.
[Rust tool contracts](../../crates/cnd-runner-interface/src/tools/mod.rs) own the reply types and the preview contract.
[agent-sections.ts](../../src/shared/agent-sections.ts) and
[agent-previews.ts](../../src/shared/agent-previews.ts) hold the path builders.

The CLI and the MCP server offer these routes, as
[Workspace tool calls](../../tools/calls.md#sections-and-previews) says.

## Routes

| Call | Route | Reply |
| --- | --- | --- |
| Create a section | `POST /v1/tools/sections`, with `name` | HTTP 201, `AgentCreateSectionResponse` |
| Delete a section | `POST /v1/tools/sections/<sectionId>/delete` | `AgentDeleteSectionResponse` |
| List previews | `GET /v1/tools/workspaces/<workspaceId>/previews` | `AgentListPreviewsResponse` |
| Open a preview | `POST /v1/tools/workspaces/<workspaceId>/previews`, with `port` | HTTP 201, `AgentOpenPreviewResponse` |
| Close a preview | `POST /v1/tools/workspaces/<workspaceId>/previews/<previewId>/close` | `AgentClosePreviewResponse` |

- `section-routes.ts` and `preview-routes.ts` match these routes.
  `GET /v1/tools/sections` keeps giving the section list.
- A preview route's target `current` resolves to the calling workspace
  from its token. Each other target must be a workspace of the calling
  org, else HTTP 404 `workspace_not_found`.
- Each write calls `requireCallingToolTurn`. The stored active turn gives
  the sender. The request names no sender and no org.

## Sections

- `section-composition.ts` checks that the sender is a member who is not
  suspended, and that the org accepts writes. It then calls the app's
  `featureSectionWrite` with the sender as the user. So the app's name
  rule, positions, guarded SQL, and metadata publication apply.
- A create trims the ends of the name with `requiredString`. A blank name
  gives HTTP 400 `invalid_input`. The new section comes last. The reply
  gives its ID, its name, and its default mark, as the section list does.
- A delete runs the whole app delete. Each workspace of the section, also
  an archived one, and each routine of the section move to the default
  section in one transaction. The workspace metadata is published before
  the reply.
- A delete of the default section changes nothing and returns
  `deleted: false`. An unknown section, or a section of another org, gives
  HTTP 404 `section_not_found`. `deleted` is true when the section is gone
  after the action.

## Previews

- `WorkspaceFeatures.agentPreviews` in
  [features/workspace.ts](../features/workspace.ts) is the trusted preview
  boundary. `Workspace.agentPreviewCall(input, origin)` exposes it on the
  target's workspace object.
- It refuses a call that reaches another object with HTTP 404
  `workspace_not_found`. It reads the target in the calling org. The app's
  preview target lookup excludes archived workspaces.
- A list needs only the workspace token. An open and a close also check
  that the sender is still a member who is not suspended.
- It calls `PreviewActions` of the [preview backend](../previews/README.md).
  The app's preview API calls the same actions in the same live handler,
  so the private-port cache and the proxy registry stay shared.
- A list gives each active preview of the workspace, also each preview
  that a member opened.
- An open passes only the port. The app's running-computer, owner, org,
  relay, port, and provider checks apply. A stopped computer gives HTTP 409
  `sandbox_not_ready`, and the call starts no computer. A suspended owner
  gives HTTP 403 `user_suspended` before any provider call.
- Each open makes a new preview. Its `url` is the normal app launch
  address. Each load of it needs a member's sign-in, so the workspace token
  cannot launch it. No request field makes a preview public.
- A close revokes the preview and cancels its proxy connections. It waits
  for the stored `preview.revoked` event. `closed` is false for a preview
  that is already closed, expired, unknown, or of another workspace. A
  repeat publishes no second event.
- After each call, the boundary schedules the preview alarm for the next
  expiry.
- A provider failure gives the app's HTTP 502 `sandbox_unavailable`,
  through `toolFailure`.
- Each reply also gives the workspace summary with its link.

## Tests

The tests use the production Worker, real D1, native workspace objects,
and a stored calling turn. They call the HTTP routes directly.
The provider transport uses the existing fake.
The [Rust tools crate](../../crates/cnd-tools/README.md) tests CLI and MCP request construction.

- `sections.test.ts`: member rights, trimmed names, order, blank names,
  stale callers, the default section, foreign and unknown IDs, active and
  archived workspace moves, routines, metadata publication, and a sender
  who left.
- `previews.test.ts`, with `previews.test-support.ts`: agent and member
  opens, signed-in launch links, list facts, close publication, repeated
  and wrong-workspace closes, cross-org refusal, a suspended owner, and a
  stopped computer.
