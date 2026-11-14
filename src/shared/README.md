# Shared contracts

These modules define the browser API, the runner protocol, and the pure
transcript fold that the browser and the Worker share.
They use JSON values and TypeScript types.
The [runner interface crate](../../crates/cnd-runner-interface/README.md)
owns runner messages, agent chat events, workspace tool requests and replies,
and each type they use.
`ts-rs` writes those types into `generated/`. Import each generated file
directly. Keep the runtime readers, constants, and helpers in TypeScript.
Browser-only event unions and API types stay in their area modules.
The [repository commands](../../AGENTS.md#commands) give the regenerate command.
Do not edit generated files.
They import no Cloudflare types, provider SDKs, or test fixtures.
Dates use Unix milliseconds. IDs and model names are opaque strings.
`Workspace.name` and `Session.title` are null until a name is set.
`Workspace.number` is the immutable number in its org.
`Workspace.link` is its absolute web link, with org and workspace IDs.
`AgentWorkspaceSummary` gives the same number and link.
`Workspace.github` is the GitHub summary of its pull request, or null.
`GitHubSummary` comes from `generated/`. `githubSummary` in `github.ts` gives
it from a banner: the state of the bar, or null without a pull request and
for a closed pull request.
`checksSummary` gives the checks of a pull request as one value, for the bar.
[The GitHub state](../../docs/protocol/github-banner.md#the-github-state) states their order.
`readGitHubSummary` in `github-read.ts` keeps a known summary and reads an absent or unknown value as null.
The browser readers and the sandbox tools use it, so an older reply still reads.
Its imports carry types only.
`AgentCreateWorkspaceResponse.sessionLink` gives the first session's absolute app link.
`AgentSessionWriteResponse` keeps the accepted session, message, and turn while reporting current workspace and resume state.
`nameLabel` in `name-label.ts` gives the display label "Untitled" for null.

Each area owns its paths and payloads. Import from that area directly.
`OrgSettings.envVars` in `org-settings.ts` returns only names and secret marks.
Its `set` change carries a value and an optional mark. An omitted mark
keeps the stored mark inside each compare-and-swap attempt. A missing or
deleted name starts secret. An explicit mark changes it with the value.
Its `classify` change carries only a name and a mark, so it keeps the value.
`api.ts` keeps the existing sign-in and org paths and common records.
`API_PATHS.orgOrder` names `PUT /api/org-order`, outside the paths of one org.
`MoveOrgRequest` in `orgs.ts` carries `orgId` and the zero-based `index` among the other visible orgs.
`readMoveOrgRequest` validates its fields. A move returns 204 without a body.
The org list uses each person's saved order. A new membership goes at the end.
[Org rail order](../../docs/protocol/org-rail-order.md) states the requirements.
Its `ApiErrorBody` carries the error code and message.
The optional `error.details` identifies an unknown routine author login.
It carries `login`, `triggerIndex`, and `list`.
`triggerIndex` is zero-based in the routine's complete trigger list.
`list` uses the author-filter request key, `is` or `isNot`.
Errors without details keep the code and message only.
`EmptyRequest` means an empty JSON object, including DELETE requests.
`repositoryPath` names one repository of an org. PUT adds it and DELETE
removes it. Each request sends `EmptyRequest` and returns the current list.

[Runner contracts](runner-contracts.md) gives the handshake, commands, events,
confirmations, reports, and credentials.

`generated/` contains `Attachment`, `MessageSender`, and `UserMessage`.
`messages.ts` owns attachment upload targets, paths, and browser requests.
`AttachmentUploadTarget` names a workspace or stable first-message ID.
`attachmentUploadPath` selects the workspace or org-scoped draft base path.
`ATTACHMENT_MAX_BYTES` is the decoded file limit.
`attachmentUploadUrl` appends the filename, media type, and first-message target as URL data.
The browser posts one raw file as `application/octet-stream` with its known byte length.
`Attachment.path` is the copy path of the file, relative to the workspace repository.
The upload reply gives it, so each upload has its path before Send.
Each file of an accepted message gives it too, and the browser builds no path.
A file of a message stored before this field has no path.
The browser and runner readers give null for it, and no mention matches it.

`endpoint-address.ts` owns `readEndpointAddress`, the shared endpoint
address builder for forms, saves, dispatch, and the model gateway.
It takes the agent and an options object with an optional model route, request query, and extra refused domains.
It returns the normalized endpoint, origin, host, exact upstream address, and `secretForms`, or null for a refused address.
`secretForms` owns the address patterns that both gateway output filters use.
It includes whole addresses and the host name without its port.
Relative and built request paths join the set only for a saved query or a path beyond the agent's base.
The base path is empty for Claude. For Codex, it can be empty or `/v1`.
It also includes saved path segments and query values with at least 12 characters.
Each form has plain, percent-encoded, and JSON-escaped variants, including escaped slashes.
Shorter parts match only inside a whole address form.
`endpoint-host.ts` owns its public host check.
It accepts only public host names and refuses every IPv4 and IPv6 address.
It reads the product domain from `productDomain` in `docs/mockups/src/brand.ts`.
Worker callers also pass `env.PREVIEW_DOMAIN` as an extra refused domain.
The form and fake API use the same builder without preview configuration.
The builder preserves queries, removes fragments and trailing slashes, and removes a final `/v1` for Claude.
It can build model-list addresses without exposing a model-list gateway route.
`ENDPOINT_ADDRESS_ERROR` gives the one refusal code and field message.
Own endpoint logins stay outside the runner protocol.
`feedback.ts` owns `FEEDBACK_PATH`, the request and reply types of the
feedback routes, and their byte limits. `FEEDBACK_BODY_MAX_BYTES` is the
JSON body limit of a send. `FEEDBACK_SCREENSHOTS_MAX_BYTES` is the limit of
the decoded screenshots of one message. `SendFeedbackRequest` carries each
screenshot as base64 `content` only, with no name and no media type.
`FeedbackResponse.replyEmail` is the reply address, or null.
`images.ts` holds the one image signature reader of the browser and the
Worker. `readImage(bytes)` returns a `CheckedImage` of one `ImageKind`:
PNG, JPEG, GIF, or WebP. It returns null for other bytes. A symbol that the
module does not export brands `CheckedImage`, so other code gets one only
from `readImage`. The [mail sender](../../worker/mail-sender.ts) takes
attachments only as checked images. It writes each file name and media
type from the kind. [Feedback](../../docs/protocol/feedback.md) states the
rules.

`generated/` contains full trees, tree updates, and branch changes.
`files.ts` owns file paths, limits, and browser-only event types.
A full tree contains real paths relative to the repository root.
Real `path`, `previousPath`, and `baseBranch` fields stay unchanged for
keys, joins, reads, and diffs. Their optional `displayPath`,
`previousDisplayPath`, and `displayBaseBranch` fields carry masked labels
when those labels differ. `FileEntry.name` stays the basename label.
Content and diff replies carry the same optional labels for direct opens.
The field policy in `output-fields.ts` fills these labels on both runtimes.
A move names its old path and its new entry.
A directory move includes updates for its descendants.
`FileEvent` contains complete browser reports and unavailable-tree marks.
`RunnerFileEvent` sends full reports as numbered parts of one revision.
Each part has a 256 KiB event payload budget.
Tree deltas have the same byte budget and at most 512 changes.
Tree and changes revisions have independent sequences within each runner stream.
A new stream starts with full reports. A reconnect keeps its revisions and parts.
The workspace joins all parts before it publishes a full browser report.
Branch changes include committed, staged, unstaged, and untracked work.
`ChangesResponse.unpushedCommits` counts the current branch's commits that
no remote branch holds. `ChangesResponse.uncommittedFileCount` counts the
raw Git status records of uncommitted work, also untracked files, and
counts a rename once. It also counts a file whose edit brings back its base
content, which Changes lists in no row. So it can differ from the number
of rows. Each changes part repeats both complete counts.
The current runner always sends both. Reports from older workspace images
can omit either, and readers preserve that absence instead of assuming zero.
`generated/` contains file read and diff commands and their matching results.
The backend sets the read limit. The sample limit in the fixtures is not product policy.
Read and diff results do not enter the stored chat event stream.

`output-sanitizer.ts` holds possible secret suffixes across answer events.
A completion or a turn end releases the held text of its answer.
The filter then keeps an answer context: the shown answer end that can still start a secret.
After a completion, it keeps the context of the earlier text and of the completion text.
A refused completion leaves the earlier text on the screen.
Later text of the same answer masks the part that completes a secret from a context.

The filter does not cap the number of answer contexts.
Its snapshot holds the held text, the answer contexts, and the secret values that still apply to them.
A snapshot without answer contexts also stays valid.
The Worker keeps the held text in the encrypted state of its runner stream.
It keeps the answer contexts in one encrypted state of the workspace, which each runner stream uses.
It saves both before it confirms the corresponding raw event.

`event-limits.ts` applies the same chat excerpt caps after either filter.
Its UTF-8 byte count works in the Worker and Node.
The workspace's [port report owner](../../worker/chat/port-reports.ts)
shortens port labels only after its final filter.

`chat-events.ts` caps serialized tool detail at 64 KiB.
Its omission count measures normalized source UTF-8 bytes before JSON escaping.
Turn summaries keep at most 200 files and 256 KiB of serialized file-list data.
They count omitted files. The complete Changes response has no summary cap.
A `turn.completed` event can carry `endReason`, of the type `TurnEndReason`.
The runner, the Worker, and the browser use that one type.
Its one value is `background_work_limit`.
The end of a fast turn can carry `speed`, of the type `TurnSpeed`, which
`readTurnSpeed` reads: fast, or standard with a cause code.
`runner.event-refused` belongs only to workspace chat events.
It identifies the lost runner event without copying its data.
Its `repairFailed: true` flag marks a refused replacement of a lost workspace update.
Only the workspace sets that flag.
[Lost workspace updates](../../docs/protocol/agent-runner.md#lost-workspace-updates)
states the rules of the request and of a failed repair.
`workspace.continued` is the note of Continue in one session. It belongs to
`ChatEvent`, so it reaches the browser stream, but not to `AgentChatEvent`
or to the runner events. Only the Worker writes it. It names its
`sessionId`, the `member` who pressed Continue, the new `branch`, and its
`baseBranch`.

`events.ts` defines the browser stream. Its event numbers span all sessions
and runner connections of one workspace. A reconnect uses the last stored number.
The history response gives the point after which live events continue.
The optional `error` of `workspace.updated` carries only the saved public
code and message. A null error clears the previous error. An older event
without this field keeps the previous error.

`sessions.ts` defines the browser session paths and their requests and replies.
`Session` and `TranscriptDetail` come from `generated/`.
`Session.retryMessageId` names the one message that `retryMessagePath` accepts.
It is the retry message of the newest turn when that turn failed, and null otherwise.
A message or a retry that opens a linked session sets it to null on the source.
Each other message of the session gets HTTP 409 with the code `retry_not_available`.
[Messages](../../docs/protocol/messages-and-attachments.md#messages) states the rule.
`Session.startedBy` names the member who started the session.
It is null only for an older record whose starter is not known.
`Session.sourceSessionId` names the session where a message opened this linked session, and null otherwise.
`Session.loginAvailable` is the result of the last server check of the starter's login.
It stays true when the starter does not share that login.
`Session.loginShared` says whether the starter lets other members use that login, from the same check.
Each member reads the same values. None of these fields holds a login.
[Messages](../../docs/protocol/messages-and-attachments.md#messages) states how the composer uses both values.
`SendMessageResponse.session` in `messages.ts` is the record of the session that took the message.
It can differ from the session of the request.
[Agents](../../docs/protocol/agents-and-sessions.md#agents) states the starter rule.

`terms.ts` names the current revision of the Terms, `TERMS_VERSION`.
`acceptedTermsSignInPath(inviteCode?)` gives the sign-in path that carries that revision and an optional join code.
[Terms consent](../../worker/security/README.md#terms-consent) gives the rules of sign-in.
`operator.ts` defines the operator overview, directories, and user and org
suspensions. Its user records include `OperatorUserAccess` from
`operator-waitlist.ts`. That module also defines waitlist, approval, code,
pause, and waitlist switch paths and replies. `operatorWaitlistSwitchPath`
names the switch. `OperatorWaitlistSwitch` gives `waitlistOn`,
`updatedAt`, the operator of the last change, and `waiting`, the count of
people who wait, as the Waitlist tab counts them. The operator sees email
states and verified email flags, never email addresses. GitHub creation
times let the app show account age. Access sources carry the operator,
code label, referral owner, or org and inviting admin. The `open_signup`
source carries the operator who last turned the waitlist off. Referral
records include recipients with their GitHub names, or null.
`OrgSummary.suspension` in `orgs.ts` exposes only the org suspension time to its members.
[Operator actions](../../worker/operator/README.md) gives the access and the reply codes.

`device.ts` defines Mac command paths, socket messages, and local settings relays.
Mac command input, result, record, and pairing types come from `generated/`.
Its imports carry types only and also serve the Mac app's NodeNext build.
`device-read.ts` validates its wire values and preserves command text, timeouts, and truncation.
Command records return `requestKey` for URLs and retain `requestId` for retries and device frames.
Settings results distinguish applied and saved changes, applied but unsaved changes, and failed changes.
The small settings failure frame identifies an oversized reply without closing the connection.
The combined Mac output cap is 65,536 UTF-8 bytes.

`MACHINE_PATHS` in `agent-tools.ts` and `DEVICE_COMMAND_PATH` in `device.ts` put their machine routes under `/v1/`.
`agent-tools.ts` also owns `TOOL_ENV`, `TOOL_TURN_HEADER`, and the workspace
MCP registration. Tool paths stay in the `agent-*.ts` modules. Their payloads
come from `generated/`. `agent-sessions.ts` owns the transcript byte budget.
The machine origin and the preview domain stay Worker settings.
`Preview.url` is the absolute launch address of a preview on the app origin.
It holds no secret. The browser loads it as it is, in the frame and in a new tab.
In the Mac app, a new tab opens in the default browser through `PreviewLaunchResponse` instead.
That JSON reply of `Preview.url` holds an authorizer `url` and the `expiresAt` of its grant.
The `url` carries the preview hostname and a 60-second grant only in its fragment.
[Port previews](../../docs/protocol/terminal-previews-and-desktop.md#port-previews) states its access rules.
Each open of a port preview gets a new preview ID, and the API never gives out
a revoked ID again. The Preview tool hides revoked previews by their ID.
The git credential payload is not defined yet.
[GitHub tokens](../../docs/protocol/tokens-and-secrets.md#github-tokens) states its rule.

### Key Code

- [Workspace views](workspace-view.ts) define the saved view and its
  `temporaryTab` field. The field names one file or diff by kind and path,
  without a display mode, or is null. The Worker and browser readers use
  null for an absent or invalid mark, or one that names no open tab.
  [The saved view](../../docs/protocol/temporary-tabs.md#the-saved-view)
  gives the requirements.
- [Shortcut commands](shortcut-commands.ts) define the stable command IDs.
  The app and Worker share this list, including Copy link, pull request
  actions, and both transcript copies. Account reads and saves accept
  these commands through `isShortcutCommandId`.
- [Shortcut keys](shortcut-key.ts) parse canonical key text from unknown
  values. Only keypad digits have keypad names.
  [Fixed keys](shortcut-fixed.ts) and [text keys](shortcut-text-keys.ts)
  supply the same rules to the recorder and the Worker.
  Enter with any modifiers and plain Space are fixed on both keyboards.
- [Shortcut contracts](shortcuts.ts) define account overrides and batch
  saves. Empty keys remove all bindings. Null in a save restores defaults.
  [Shortcut readers](shortcut-read.ts) check each save as a complete batch.
  Reply readers drop unreadable or fixed keys and keep the other keys in order.
  A change that loses every key falls back to defaults. An empty stored list
  still removes every key.
  `AccountResponse.shortcuts` carries both keyboards.
  `ACCOUNT_PATHS.shortcuts` names the batch save route.

[Shared contracts key code](key-code.md) names the files, the types, and
the functions of the shared contracts that a reader opens first. It covers
the session addresses, the Markdown transcripts, and the shared words and
parts of a transcript. It also covers the mentions, the attachment paths,
and the session titles. Then it gives the contracts of the other areas,
such as ports, orgs, members, the waitlist, workspaces, GitHub, feedback,
and routines. It ends with links to the browser fakes, the runner fakes,
and the migrations.
