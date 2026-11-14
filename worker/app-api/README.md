# App API

This folder holds the browser routes of the app shell, of the workspace
lifecycle, and of feedback. `route` in [`routes.ts`](../routes.ts) tries them after the app
request gate, so each handler gets the parsed body and the signed-in user.
Each handler returns `null` for a path that it does not own. The
[Worker routes](../README.md#routes) list every route of the Worker.

## Routes

| Handler | Routes |
| --- | --- |
| `bootRoute` in [`boot.ts`](boot.ts) | `GET /api/account`, `GET /api/models`, `GET /api/get-started`, `PUT /api/account/default-model`, `PUT /api/account/new-workspace-view`, `PUT /api/account/shortcuts`, and `PUT`, `PATCH`, and `DELETE` of `/api/account/agent-logins/:agent` |
| `endpointModelsRoute` in [`endpoint-models.ts`](endpoint-models.ts) | `POST /api/account/agent-logins/:agent/models/refresh` |
| `codexDeviceRoute` in [`codex-device.ts`](codex-device.ts) | `POST /api/account/agent-logins/codex/device` starts a ChatGPT sign-in. `POST` of its `/:handle` polls and exchanges it |
| `shellRoute` in [`shell.ts`](shell.ts) | `GET` of the sections, the repositories, the members, and the workspace list of an org. `GET` and `PUT` of the view of a workspace, and `PUT` of its read mark |
| `featureShellRoute` in [`feature-shell.ts`](feature-shell.ts) | GitHub installations and available repositories of the account; Create org with initials and repositories; settings reads and writes; repository choices; section writes; workspace names and moves |
| `archiveRoute` in [`archive.ts`](archive.ts) | `POST` of a workspace’s `archive` and `restore` |
| `chatLifecycleRoute` in [`lifecycle.ts`](lifecycle.ts) | `POST` of the workspace list, which creates a workspace. `GET` of a workspace, `POST` of its `resume` and `activity`, and image build, refresh, and log routes |
| `feedbackRoute` in [`feedback.ts`](feedback.ts) | `GET` and `POST` of `/api/feedback`. [Feedback routes](feedback.md) gives their checks, their errors, and the email |

`featureShellRoute` in [feature-shell.ts](feature-shell.ts) serves account GitHub
access, org creation with initials and repository choices, shared settings,
repository selection, sections, and workspace metadata.
The [invitation route](invitations.ts) serves the signed-in pending list and explicit acceptance.
The [archive route](archive.ts) archives and restores a workspace through its workspace object, as [Archive](../../docs/protocol/workspace-life.md#archive) says.
The [Continue route](continue.ts) starts a Continue job and reads its result in the real workspace object, as [Continue routes](../lifecycle/continue-routes.md) says.
`membersRoute` alone serves the org list and one org.
It also serves Leave, org recovery, roles, invitations, and workspace ownership.
Leave keeps the existing last-active-admin rule and native owner-change maintenance.
The [routine routes](../routines/README.md) serve routine records after the same app gate.
Section deletion moves routines to General in its workspace-move batch.
Repository deselection turns matching routines off in its repository-write batch.
Run now and run history use the same app gate.
Workspace view replies include `routine`, the run's routine ID and name, or null.
A join from the run record supplies the routine without a new lifecycle field.
Deleting the routine removes that link and keeps its normal run workspaces.
Workspace view replies also include the resolved `baseBranch`.
View writes cannot change this branch.

## Rules

- [Model configuration dependencies](../../docs/deployment/models.md#configuration-failures)
  states which operations need `CONDUCTIVE_MODELS` and
  `CONDUCTIVE_DEFAULT_CHOICE`, and their failures.
- Each model of the list can carry the `fast` mark.
  `PUT /api/account/default-model` saves fast mode with the model and the
  effort. It stores fast mode as off for a model without the mark, and a
  saved default without fast mode reads as off.
  [Fast mode](../../docs/protocol/fast-mode.md#the-models-with-fast-mode)
  states the rules.
- An account reply reads `user_preferences`, `user_shortcuts`, and the records of the agent
  logins. It also gives the page of the GitHub App from `GITHUB_APP_SLUG`,
  so a screen links to that page without a GitHub read. A login write
  encrypts the secret with `agentLoginContext(userId, agent)` and
  `BOAT_KEY_ENCRYPTION_KEY`. No reply holds a stored secret.
- An own endpoint save uses `readEndpointAddress` from
  [`endpoint-address.ts`](../../src/shared/endpoint-address.ts). It encrypts
  one JSON value with the normalized endpoint and the whitespace-free key,
  under the same context. Only the endpoint origin stays in plain text.
  Save and preference replies give the host, kind, share setting, and last
  secret-save time. They never give the full address.
  `accountLogins` requires the app model getter for account reads and share replies.
  Both replies keep the saved `modelList`, including its missing app IDs and read time.
  Save reads the endpoint model list without making a failed read fail the save.
  Each replacement drops the old model list and its attempt time.
  [`account-models.ts`](account-models.ts) adds the optional `modelList` to
  an own endpoint login in the signed-in user's account reply.
  Its `missing` array holds app model IDs absent from the last successful list.
  Its `checkedAt` holds that successful read's Unix millisecond time.
  No successful read means no `modelList`.
  A list with no matching app model reports all of that agent's app IDs as missing.
  The browser uses that case to keep every model available.
  An unavailable model configuration leaves discovery metadata out of the account reply.
  The model-list route keeps its existing configuration error.
  Refresh reads only the signed-in user's login and answers 204, also after a failed read.
  A removed or native login makes Refresh do nothing.
  Read the account again after Refresh to obtain the last successful result.
  The builder accepts public HTTPS addresses with host names.
  It refuses every IPv4 and IPv6 address, credentials, and non-public names.
  It reads the product domain from the shared brand source.
  The save also passes `env.PREVIEW_DOMAIN` to refuse that deployment's preview domain and its subdomains.
  It preserves the query and drops the fragment and trailing slash.
  For Claude, it also drops a final `/v1`.
  A valid own endpoint runs through the model gateway.
  An invalid saved address makes it unavailable in chat.
- `PUT /api/account/shortcuts` takes `SaveShortcutsRequest` and returns
  `SaveShortcutsResponse` from the shared shortcut contracts. The shared
  reader checks the whole request before any write. A contract error
  returns HTTP 400 with `invalid_input` and the reader's message.
  Enter with any modifiers and plain Space are fixed keys on both keyboards.
  Only keypad digits can use keypad names in a saved key.
  `shortcuts-data.ts` batches the changes and the reply's read in one D1
  transaction. Null keys delete a row. Empty keys keep an empty override.
  The account's `shortcuts` field carries both keyboards and skips retired
  commands. The shared reply reader drops unreadable or fixed stored keys.
  It preserves valid keys in order and keeps empty overrides. A change
  that loses every key falls back to defaults. Each unreadable stored row,
  including bad JSON, is skipped without blocking the account or save reply.
  The Worker logs fixed warning text when it skips unreadable data.
  The foreign key deletes these rows
  with their user. [Storage](../../docs/protocol/keyboard-shortcuts.md#storage)
  gives the requirements.
- A new login or a change of kind sets `noReuse` to true for a Claude
  subscription token or a Codex ChatGPT sign-in, and false for an API key or an own endpoint.
  The Worker and the dev backend use `defaultAgentLoginNoReuse` in the
  [account contract](../../src/shared/account.ts) for these defaults.
  Replacing a secret of the same kind keeps its preference. A `PATCH`
  changes only that login's preference for the signed-in account. It needs
  no secret and keeps `updatedAt` as the last secret-save time. It returns
  the current metadata, including a
  disconnected status when the login was removed.
- Codex connects to ChatGPT through the [device sign-in service](../codex-auth/README.md).
  Its start reply holds the code, verification link, expiry, and poll interval.
  Its poll reply reports waiting, connected, expired, or failed.
  An unfinished sign-in compares the saved login date with the current login
  before each OpenAI request and in its final conditional login write.
  A change ends the sign-in with a cause that asks for a new code.
  After completion, each poll reads the current Codex login through `accountLogins`.
  A removed login returns a disconnected status while the sign-in state stays connected until expiry.
  The required credential task owner retains the poll's exchange and save through `execution.waitUntil`.
  Both routes use the signed-in account. A handle from another account returns 404.
  The ordinary login save accepts only an API key for Codex.
  A connected Codex login can carry `unusableCause` after a refused renewal.
  Reconnect clears the failure and its refresh claim.
- Get started has only the steps `github-app`, `org`, and `agent-login`.
- Create org requires at least one repository. `createShellOrg` starts its
  first image build after it saves the org, its admin, and its repositories.
  A failed build start writes one fixed warning through `warnWorker`.
  The org stays, and the request still answers 201.
- A save that adds a repository starts an image build for the admin who
  added it, also after a failed build. A repeated save and a removal start
  no build. A running job takes the request without starting another job.
  A failed start writes one fixed warning through `warnWorker`. The saved
  choice stays, and the reply keeps the repository list and HTTP 200.
- The build history reply also gives `BuildsResponse.changes`: the saved
  install script change and the added and removed repositories. The
  [image build reader](../lifecycle/image-builds.md#build-jobs) owns the
  comparison.
- `getStartedGitHubComplete` owns the `github-app` step in every org state.
  The step is complete when an org of the user that is not deleted has a
  repository through an installation that is not suspended.
- Otherwise the step reads only `/user/installations`, page by page, with
  the fresh GitHub user token. A suspended installation does not count.
- A failed GitHub read leaves the step incomplete and writes one fixed
  warning through `warnWorker`. The account and Get started still load. The
  installation list of the account shows its own error.
- A repository without a GitHub installation is not in the list.
- Each member has a view of their own. A read mark only moves forward, and
  it stops at the last event number of the workspace.
- The list and the lifecycle replies give each reader one state.
  Archived, starting, stopped, error, and input come from the workspace
  record. Otherwise, the chat summary of the workspace object and the
  reader's read mark give working, unread, or ready. The list and a create
  reply read it with `readChatWorkspaceSummary`. A read or a Resume reply
  takes it from the same read as its record, as
  [Browser routes](../lifecycle/README.md#browser-routes) says.
- Each full workspace record also gives `github`, the GitHub summary of
  its pull request, or null. The list and lifecycle readers select it from
  the D1 workspace row. So the summary adds no GitHub request and no
  Durable Object read. The chat summary reads above stay as they are.
- A change of the summary keeps the activity time and the order of the
  row. The [GitHub banner backend](../github/README.md#the-summary-copy)
  writes it, and
  [The GitHub state](../../docs/protocol/github-banner.md#the-github-state)
  states its values.
- A workspace path decodes its workspace ID once.
- An archived workspace keeps its view readable. A view write, a read mark,
  and a lifecycle action other than Restore get `409 workspace_archived`.
- The lifecycle handler reads validated release metadata only for a build or
  refresh. `chatLifecycleRoute` gives the first message
  of a create to `acceptLifecycleFirstMessage` of the workspace object.

Org suspension keeps shell reads available.
The common browser gate refuses every org write except Leave.
The view, read-mark, shared-shell, settings, repository, Archive, and Restore SQL writes also check stored org state, so an earlier permission read cannot admit a later write.

The workspace responses give an org-local number and a canonical web link.
They give `restoreUntil` while the archived cloud computer exists, including while an expired delete retries.
Restore refuses an expired window even when the cloud computer remains.
The request's effective app origin reaches each response constructor explicitly.
Durable Object reads, Archive, and Restore receive that origin through their RPC arguments.
The machine tools use the configured app origin instead.

### List order

- The list read orders the sections by `position`, then ID. In each
  section, it orders the workspaces by `position`, then creation time,
  then ID.
- Each insert and each move computes its positions from the current rows,
  inside the D1 write transaction that saves them. No route computes a
  saved position from an earlier list read. So two overlapping moves give
  the same order as the two moves one after the other.
- `insertWorkspace` in [`workspace-data.ts`](../lifecycle/workspace-data.ts)
  gives a new workspace the lowest `position` of the active workspaces in
  its section, minus 1. In a section without active workspaces, the new
  workspace takes 0. So it lists first, as the
  [mockups](../../docs/mockups/src/components/workspaces/sections.ts)
  show. A position can be negative.
- The [app](../../src/app/list-changes.ts) and its
  [dev fake](../../src/app/dev/create-routes.ts) also show a new workspace
  first.
- A workspace move request holds `sectionId` and `position`, the index in
  that section. It can omit `sectionId`. Then the move uses the stored
  section of the workspace, inside the transaction. Without `position`,
  the index is 0.
- A section move request holds `position`, the index in the section list.
  Each index counts the rows without the moved row.
- A move ranks the current rows of its target from an `AS MATERIALIZED`
  snapshot, then puts the moved row at the index. That keyword makes
  SQLite compute the snapshot once, before the update changes a row.

## Development

Run `npm run test -- worker/app-api worker/chat/integration` from the
repository root. The integration tests use the production Worker entry,
local D1, Durable Objects, and WebSockets, with fake Boat and GitHub.

[App API tests](tests.md) lists the cases and their test helpers.

### Key code

- [`boot.ts`](boot.ts), [`account-data.ts`](account-data.ts),
  [`get-started-data.ts`](get-started-data.ts), and
  [`models.ts`](models.ts): the account, its logins, Get started, and the
  model variables.
- [`shortcuts-data.ts`](shortcuts-data.ts): account shortcut reads and
  atomic batch saves, checked with the shared shortcut readers.
- [`codex-device.ts`](codex-device.ts): the account routes for ChatGPT
  device sign-in, over the [Codex auth service](../codex-auth/README.md).
- [`get-started-github.ts`](get-started-github.ts):
  `getStartedGitHubComplete`, the one owner of the `github-app` step.
- [`shell.ts`](shell.ts) and [`shell-data.ts`](shell-data.ts): the lists of
  an org and the read marks.
- [`workspace-view.ts`](workspace-view.ts): the saved view of each member.
- [`workspace-state.ts`](workspace-state.ts): the state of a workspace for
  its reader, and the refusal of archived writes.
- [`workspace-path.ts`](workspace-path.ts): the workspace ID of a path.
- [`lifecycle.ts`](lifecycle.ts): the lifecycle routes and their options.
- [`continue.ts`](continue.ts): `continueRoute`, which checks the Continue
  request body and gives the start and each poll to the workspace object.
- [`feature-shell.ts`](feature-shell.ts): shell write dispatch after the
  request gate. [`feature-settings.ts`](feature-settings.ts) encrypts env
  values and their secret marks. Replies return names and marks only.
  [`feature-sections.ts`](feature-sections.ts)
  and [`feature-workspaces.ts`](feature-workspaces.ts) save list changes and
  publish workspace metadata through the workspace object.
  `featureSectionWrite` takes only the request method and the user, org,
  and body of its context. So the
  [agent section calls](../tools/sections-and-previews.md#sections) reuse
  it with the sender as the user.
- [`workspace-metadata.ts`](workspace-metadata.ts):
  `changeWorkspaceMetadata`, the rename and the move of one workspace. It
  checks the member and the archive state, runs `updateShellWorkspace`, and
  publishes the metadata. `feature-workspaces.ts` and the
  [agent workspace tools](../tools/workspaces.md#rename-and-move) both call
  it. A tool move to the current section of a workspace changes nothing.
- [`feature-workspaces-data.ts`](feature-workspaces-data.ts):
  `updateShellWorkspace`, the rename and the move of a workspace in one D1
  batch. [`feature-sections-data.ts`](feature-sections-data.ts): the
  section writes `insertShellSection`, `updateShellSection`, and
  `deleteShellSection`. [List order](#list-order) gives their rules.
- [`feature-github.ts`](feature-github.ts): account installations and
  repositories read with the fresh GitHub user token.
  [`feature-org.ts`](feature-org.ts) creates an org with its chosen
  repositories and starts its first build with `startImageBuild` of the
  [image lifecycle](../lifecycle/image-builds.md).
  [`feature-repositories.ts`](feature-repositories.ts) merges
  the org's saved choices with repositories that its reader can access,
  and starts a build after an add.
  Their `*-data.ts` files keep queries and guarded writes.
- [`feedback.ts`](feedback.ts), [`feedback-input.ts`](feedback-input.ts),
  [`feedback-data.ts`](feedback-data.ts), and
  [`feedback-mail.ts`](feedback-mail.ts): the feedback routes, the checked
  body, the reply email and reachable IDs, and the email.
  [Feedback routes](feedback.md#key-code) gives each entry point.

### Related docs

- [Worker backend](../README.md)
- [Workspace lifecycle](../lifecycle/README.md#browser-routes)
- [Deployment inputs](../../docs/deployment.md)
- [Workspaces and sandboxes](../../docs/protocol/workspaces-and-sandboxes.md)
- [Feedback](../../docs/protocol/feedback.md)
- [Shared contracts](../../src/shared/README.md)
