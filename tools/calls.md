# Workspace tool calls

This page belongs to the [workspace CLI and MCP server](README.md). It
gives the 24 calls of both tools, their options, and their replies.
[Agent tools](../docs/protocol/agent-tools.md#workspace-tools) and the
pages that it links state the requirements.

## The calls

The Rust CLI and stdio MCP server give each call. Each CLI command starts
with `conductive`.
`conductive --help` gives the same commands and options.

| MCP tool | CLI command and options | Kind |
| --- | --- | --- |
| `list_workspaces` | `workspaces list [--owner MEMBER_ID] [--state STATE] [--repository ID] [--query TEXT] [--updated-since MILLISECONDS] [--archived true\|false] [--limit NUMBER] [--offset NUMBER]` | Read |
| `get_workspace` | `workspaces get [--workspace ID]` | Read |
| `create_workspace` | `workspaces create --repository ID --message TEXT [--agent claude\|codex --model NAME] [--effort LEVEL] [--fast true\|false] [--section ID] [--name TEXT] [--first-session-title TEXT] [--request-id ID]` | Write |
| `rename_workspace` | `workspaces rename --name TEXT [--workspace ID]` | Write |
| `move_workspace` | `workspaces move --section ID [--workspace ID]` | Write |
| `archive_workspace` | `workspaces archive [--workspace ID]` | Write |
| `list_repositories` | `repositories list` | Read |
| `list_sections` | `sections list` | Read |
| `create_section` | `sections create --name TEXT` | Write |
| `delete_section` | `sections delete --section ID` | Write |
| `list_models` | `models list` | Read |
| `list_sessions` | `sessions list [--workspace ID] [--limit NUMBER] [--offset NUMBER]` | Read |
| `get_session` | `sessions get --session ID [--workspace ID]` | Read |
| `read_session` | `sessions read --session ID [--workspace ID] [--detail concise\|full] [--start-line NUMBER] [--start-offset NUMBER]` | Read |
| `create_session` | `sessions create [--workspace ID] [--title TEXT] [--message TEXT] [--agent claude\|codex --model NAME] [--effort LEVEL] [--fast true\|false] [--request-id ID]` | Write |
| `send_message` | `sessions send --session ID --message TEXT [--workspace ID] [--agent claude\|codex --model NAME] [--effort LEVEL] [--fast true\|false] [--request-id ID]` | Write |
| `rename_session` | `sessions rename --session ID --title TEXT [--workspace ID]` | Write |
| `close_session` | `sessions close --session ID [--workspace ID] [--stop-running-turn]` | Write |
| `stop_session` | `sessions stop --session ID [--workspace ID]` | Write |
| `get_message` | `messages get --session ID --message-id ID [--workspace ID]` | Read |
| `list_previews` | `previews list [--workspace ID]` | Read |
| `open_preview` | `previews open --port NUMBER [--workspace ID]` | Write |
| `close_preview` | `previews close --preview ID [--workspace ID]` | Write |
| `run_mac_command` | `mac run --command TEXT --folder PATH --reason TEXT [--timeout-seconds SECONDS] [--longer-timeout-reason TEXT] [--request-id ID]` | Mac command |

The MCP fields take the values of the CLI options, with these names:

- An option that takes an ID gives a field that ends with `Id`:
  `workspaceId`, `sessionId`, `messageId`, `sectionId`, `previewId`,
  `repositoryId`, and `ownerId`.
- `--message` gives `firstMessage` for the two create calls, and `text`
  for `send_message`.
- `--agent` and `--model` give one `model` field with `agent` and `model`.
- `--stop-running-turn` gives `stopRunningTurn: true`.
- `--archived` takes the text `true` or `false`. The `archived` field
  takes a boolean.
- Each other option gives its name in camel case, such as `updatedSince`,
  `firstSessionTitle`, `requestId`, `startLine`, and `timeoutSeconds`.
- `--message-file` has no MCP field, as [Message files](#message-files)
  says.

[Mac commands](README.md#mac-commands) gives the rules of
`run_mac_command`.

## Reach, turns, and rights

[Agent tool access](../docs/protocol/agent-tool-access.md) states these
rules.

- Each call reaches every workspace of the calling workspace's org.
- A call that takes a workspace and names none sends the reserved target
  `current`. The Worker resolves it to the calling workspace from the
  token.
- Each read needs only the workspace token. The reads are the lists, the
  get calls, and `read_session`.
- Each write needs an active calling turn. It acts for the member whose
  message started that turn, with that member's rights in the app. A
  message of another member during the turn does not change this.
- Every member can rename and move a workspace, rename, close, and stop a
  session, create and delete sections, and open and close previews.
- Only the workspace owner or an org admin can archive a workspace.
  Another sender gets HTTP 403 `archive_forbidden`, and nothing changes.
- The CLI help and the MCP descriptions give these rules. They ask the
  agent to use names and returned links in normal answers.

## Workspaces

Create inherits the calling workspace's org and owner.
An omitted model or effort uses the owner's default.
Create uses fast mode only with `--fast true`, for a marked model.
An omitted section uses the org's default section.
The first message runs as the sender of the calling turn.
`--name` gives an optional workspace name, and `--first-session-title` an optional title of the first session.
Their help says: "Use plain words separated by spaces. Avoid underscores unless the user tells you to add them."
The Worker keeps the first line with text, makes white space single, removes a final full stop, and cuts at 60 Unicode code points.
It keeps whole words when possible and keeps an ellipsis.
It keeps each underscore, as [Names from the workspace tools](../docs/protocol/tool-names.md#the-name-rule) says.
A blank result counts as no name, and the app shows "Untitled".
The name does not change the branch.
The create answer holds the stored name, the first session ID, and its absolute `sessionLink`.
Create gives the complete workspace record, with its number and canonical web link.
That record also gives `github`, the GitHub summary of the workspace, or null.
A repeat with the same `--request-id` returns the first workspace, session, and message.
An omitted ID makes a new ID for that call only.
So keep and pass the same ID to retry without a second workspace.

`workspaces list` without options returns every workspace in the org, including archived workspaces.
Each list item gives its number, canonical web link, name, branch, and state.
Its owner gives the member ID, GitHub login, and display name, with no avatar.
The filters combine, and each filter is optional:

- `--owner` takes an exact member ID, never a login. An unknown ID gives
  an empty list.
- `--state` takes one workspace state: `working`, `input`, `unread`,
  `ready`, `starting`, `stopped`, `error`, or `archived`.
- `--repository` takes a repository ID.
- `--query` matches part of the name, in any letter case.
- `--updated-since` takes a signed epoch time in milliseconds, as a safe
  integer. It selects newer activity.
- `--archived true` selects archived workspaces, and `--archived false`
  the others.

`--limit` takes 1 to 100, and `--offset` the number of entries to skip.
A reply to a call with a limit gives `hasMore`.
`sessions list` takes the same two options.

The tools have no mine filter and no login lookup.
For the workspaces of the member who sent a message, pass the member ID from the sender line of that message.
[Sender IDs](../runner/agent-tools.md#sender-ids) gives that line.
For another member, take the ID from the owner fields of a listed workspace.
Do not infer an owner from the workspace token or the active turn.

`workspaces get` gives the list fields with the repository, base branch, section, creation and newest activity times, and archive and restore times.
It also reads an archived workspace.
`workspaces rename`, `move`, and `archive` reply with the same details.
A rename uses the name rule, and no automatic name replaces it later.
A blank result gets HTTP 400 `invalid_input`.
A move puts the workspace at the top of the section.
An archive makes the same change as Archive in the app. A member can restore the workspace for 14 days.
Archiving the calling workspace ends the calling turn, so the caller can miss the reply.

A workspace link in a message names that workspace.
A workspace link in an answer shows as a chip.
The number is a display label. Links keep the workspace ID.
`repositories list` returns the repositories that a create accepts, with IDs and the current repository mark.
`sections list` returns the org's sections in sidebar order, with IDs and the default section mark.
`models list` returns the app's models, their agents, efforts, and boolean `fast` marks.
It gives the owner's default choice with fast mode off.
The default choice falls back to the app default, then to `null`.
[Repository, section, and model lists](../docs/protocol/workspace-calls.md#repository-section-and-model-lists) gives the list rules and errors.

## Sessions

The [session call contract](../docs/protocol/session-calls.md) and [Session management](../docs/protocol/session-management.md) give the session and message rules.
Each session command and `messages get` accept `--workspace ID`.
Its omission names the calling workspace.
Each of these commands except `sessions list` and `sessions create` requires `--session ID`.
A session link holds both IDs.
A session link in an answer shows as a session chip.

`sessions create` accepts an optional `--title`, message, choice, and `--request-id`.
The title follows the same Worker rule and underscore guidance as `--name`.
Omitted model or effort uses the calling turn sender's saved default, then the app default.
Session create uses fast mode only with `--fast true`, for a marked model.
Without a message, creation returns an empty session with null `message` and `turnId`.
`sessions send` requires nonblank message text and keeps its exact spacing.
An omitted choice keeps the session's model, effort, and fast mode.
`--fast true` turns fast mode on for a marked model.
`--fast false` turns it off.
The reply gives the actual receiving session with its link, the accepted message, and its turn ID.
A message can join a running turn or open a linked session on its sender's login.
Each tool message ends with `---` and `Sent by:` followed by the sending session link.
Do not answer such a message only to confirm it.

`sessions create` and `sessions send` accept `--request-id` for a stable retry. An omitted ID generates a new opaque ID.
An accepted write also gives `resume`, with state `not_needed`, `queued`, `waiting`, or `failed`.
A failed resume keeps the accepted message and gives its existing error code and message.
Retry the same request ID to check current resume state or retry a refused start without another message.

`sessions list` includes closed sessions and the workspace state.
`sessions read` defaults to concise and the newest transcript text. `--detail full` reads the full kind.
The JSON reply gives `markdown`, `startLine`, `endLine`, `totalLines`, `startOffset`, `endOffset`, and `next`.
Use `--start-line` and `--start-offset` to read from an earlier position.
Lines start at one. Offsets count UTF-16 code units within a line.
Use `next.line` and `next.offset` for the following read until `next` is null.
A long line can span several replies. Keep each fragment to recover all its text.

`sessions get` gives one session entry: its title, choice, starter, state, closed mark, and link.
`messages get` gives one message: its text, sender, state, turn ID, and acceptance time.
Its text is the stored text, so a tool message keeps its `Sent by:` line. No text holds a sender line.
Both reads also reach archived workspaces and closed sessions.
`sessions rename` uses the name rule. A blank result gets HTTP 400 `invalid_input`.
`sessions close` refuses a running turn with HTTP 409 `stop_confirmation_required`, unless `--stop-running-turn` is given.
With that flag, the running turn stops, and the session closes when the turn ends.
A turn that has not reached the agent yet needs no flag.
`sessions stop` stops the running turn, and its reply gives `turnId` and `state`.
Without a running turn, the stop succeeds with `state: "idle"` and a null `turnId`.
Otherwise `state` is `stopping` while the runner stops the turn, or `stopped`.
Stopping or closing the calling session can end the calling turn.
A rename, a close, or a stop starts no computer.
A stop through the tools, also through a close, records the calling session as its source, as [Stop source](../worker/tools/sessions.md#stop-source) says.

## Sections and previews

[Section and preview calls](../docs/protocol/section-and-preview-calls.md) states their requirements.

- `sections create` puts the new section last. Its reply gives the ID,
  the name, and the default mark.
- `sections delete` moves each workspace of the section, also an archived
  one, and each of its routines to the default section.
- A delete of the default section changes nothing and succeeds with
  `deleted: false`.
- `previews list` gives the active previews of a workspace, also the
  previews that a member opened.
- `previews open` opens a new preview of a port on a running computer. It
  starts no computer, and a stopped computer gets HTTP 409
  `sandbox_not_ready`. The reply gives the preview ID, port, link, and
  expiry time.
- Previews require sign-in. Each load of a preview link needs a member's
  sign-in, so the workspace token cannot load it.
- `previews close` closes a preview. A preview that is already closed,
  expired, unknown, or of another workspace gives success with
  `closed: false`.
- Each preview reply also gives the workspace with its link.

## Message files

`workspaces create`, `sessions create`, and `sessions send` take `--message-file PATH` in place of `--message TEXT`.
`--message-file -` reads raw stdin.
The CLI reads the text as UTF-8 and keeps all spaces, line endings, and final newlines.
A call takes one of the two options.
With both, the CLI fails with "Use --message or --message-file for one message."
A file that cannot be read gives "The message file could not be read. Check its path and try again."
Stdin that cannot be read gives "The message could not be read from stdin. Try again."
In each of these cases, the CLI sends no request.
The MCP server takes the message text only, and it reads no local file.
