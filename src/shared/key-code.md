# Shared contracts key code

This page is part of [the shared contracts](README.md). It names the
files, the types, and the functions of the shared contracts that a reader
opens first. Each path is relative to `src/shared/`, the folder of this
page.

- [Session addresses](session-link.ts) builds app session paths and absolute session links for the Worker and the app.
- [Session Markdown](transcript/session-markdown.ts) folds session pages and
  builds concise or full transcripts. [Markdown items](transcript/markdown-items.ts)
  format the shared chat words, paths, and commands. In a member's message,
  they put the escaped name of each attached file in place of its mention.
  The attachments line then lists only the other files. A Continue note
  copies as one note with the words of the chat, the name of the member,
  and both branches as code, under no heading.
  [Markdown code](transcript/markdown-code.ts)
  keeps inline and block fences longer than their content's backticks.
- [Lost data](transcript/lost-data.ts) maps refusal event types to the same
  product names for the browser line and the copied transcript.
- [Workspace tool types](../../crates/cnd-runner-interface/src/tools/mod.rs) own the Rust requests, replies, workspace and session records, and Mac command records. `generated/` contains their TypeScript.
- [Agent tool runtime](agent-tools.ts) owns the machine paths, turn environment names, turn header, and workspace MCP registration.
- [Agent words](agents.ts) supply the effort labels, model lookup, and model
  labels for the chat, the new-workspace picker, and the mockups.
- [Duration](transcript/duration.ts) formats elapsed chat and command times.
  [Tool words](transcript/tool-words.ts) supply tool verbs, fold counts,
  and the rule that starts a run open.
- [Turn words](transcript/turn-words.ts) supply running, stopped, and failed
  lines, the end reason of a turn, omitted-file and unavailable-file data,
  and the member of a Continue note: "You" to that member, its name to
  others and in a copy.
- [Command words](transcript/command-words.ts) supply Mac names, command
  states, notes, and output text. Browser code supplies icons and colours.
- [Session events](transcript/session-events.ts) take stored Worker envelopes
  or parsed browser envelopes and select one session's events, with its
  Continue note.
- [Session log](transcript/session-log.ts) folds those events and session
  records in event order. It keeps the transcript and each item's first time.
- [Transcript](transcript/transcript.ts) defines the items and folds each
  session event with its [turn helpers](transcript/turn-events.ts).
- [Item placement](transcript/item-placement.ts) keeps late items in their
  turn. [Command placement](transcript/command-placement.ts) puts each Mac
  command after the items that began before it.
- [Turn work](transcript/turn-work.ts) finds each ended turn's folded work.
  [Transcript entries](transcript/transcript-entries.ts) group the items and
  generic inserts, and give each run of tool calls its default open state.
  The browser and the concise copy share that state. Browser callers use
  React nodes as the insert content.

- [Mention text](mention-text.ts) reads and writes the mention of a file or
  a folder, for the chat field, sent messages, and the attachment mentions.
- [Attachment paths](attachment-paths.ts): `attachmentPath` builds the copy
  path of a file: `ATTACHMENTS_DIRECTORY`, a digest of the file ID alone,
  and the safe file name. The Worker and the development and test fakes
  call it.
- [Attachment mentions](attachment-mentions.ts): `attachmentForMention`
  finds the attached file that a file mention of the message names.
  `textWithAttachmentNames` puts the original name of each such file in
  place of its mention. `hasOwnWords` says whether the text holds more than
  spaces and those mentions.
- [Session title](session-title.ts): `sessionTitleFrom` puts in those names
  before it takes the first line and cuts it to 60 code points. It gives
  null when the text holds nothing but those mentions. `modelTitleFrom`
  first changes each underscore of a model answer to a space.
- [Port reports](ports.ts) carry sorted listening ports and their safe labels.
- [Terminal contracts](terminal.ts) own the port shared with the listener exclusion.
- [Restore marker](restore-marker.ts) names the file that the Worker writes at the end of the disk restore. The terminal and the agent runner read it.
- [Commit author](commit-author.ts) builds a GitHub user's commit author and its four Git variables.
- [Org contracts](orgs.ts) carry custom initials and GitHub repository choices for org creation, and the request reader for org moves.
- [Member contracts](members.ts) name each invitation by its email. Each member keeps the `User` with their GitHub login. `PendingOrgInvite` adds the org ID and name, for the invitations that the signed-in user can accept.
- [Account contracts](account.ts) include the repository list available before an org exists. An own endpoint write carries its endpoint and key. Its status carries the host and normal login metadata. The owner's account can also carry `modelList`, with missing app model IDs in `missing` and the last successful read time in `checkedAt`. No successful read means no field. `refreshAgentLoginModelsPath` names the POST route that answers 204 before the browser reads the account again. `AgentLoginStatus.noReuse` of a connected login is true when other members cannot use it. `UpdateAgentLoginRequest` changes only that value, without the secret. Stored statuses also include a Codex ChatGPT sign-in as `token`. A Codex save accepts `api-key` or `endpoint`; ChatGPT uses the device flow. `defaultAgentLoginNoReuse` gives the typed default for each agent and kind. The Worker and the dev backend use these defaults.
- [Waitlist contracts](waitlist.ts) define the state read, code use, and join paths. Their state gives app access, the pause, the required `waitlistOn` flag of the waitlist switch, the approval email, and the personal referral code's totals. `SessionResponse` in [account.ts](account.ts) adds app access to the sign-in session reply.
- [Operator waitlist contracts](operator-waitlist.ts) define approval results, email states, code management, pause and switch changes, and user access details.
- [GitHub setup](github-setup.ts) names the address where GitHub returns after an install, and the `state` values of the install link.
- [Workspace contracts](workspaces.ts) give `workspacePaths.continue` and `workspacePaths.continueResult`. `ContinueWorkspaceRequest` sends the `expectedBranch` that the caller shows, and an optional `allowLocalWork`. `ContinueWorkspaceResponse` is a pending job with its `continueId`, a `confirmation-required` reply with the `branch`, the `baseBranch`, and the `LocalWork` that the check of Continue found, or a `continued` reply with the `workspace` and its `eventNumber`. [Continue routes](../../worker/lifecycle/continue-routes.md) gives the routes and the errors.
- [GitHub contracts](github.ts) give the five `githubPaths` routes of a workspace: the banner and checks reads, the member capability, the merge start, and the merge result. `PullRequest.headSha` is the head commit that the banner shows, and `GitHubMergeRequest` sends it back with the merge method. `GitHubCapabilities` gives `canWrite` and the `mergeMethod` that the member may use, or null. `GitHubMergeResponse` is a pending app job with its `mergeId`, or a completed merge. These member replies never become workspace events. [Member merges](../../worker/github/merges.md) gives the replies and the error codes.
- `githubSummary` in [GitHub contracts](github.ts) maps the banner state to the list mark, and `checksSummary` gives the checks state that the bar uses. [The summary reader](github-read.ts) reads `Workspace.github`.
- [Org settings](org-settings.ts) carry the base image software for the Cloud computer tab.
- [Feedback contracts](feedback.ts) define the feedback path, its request and reply, and its byte limits.
- [Image signatures](images.ts) give `readImage` and `CheckedImage`. [images.test.ts](images.test.ts) checks the four formats, both GIF signatures, and refused or short signatures.
- [Routines](routines.ts) define routine paths, editable fields, triggers, inactive reasons, and run states.
  Author-filter requests carry logins. Saved filters carry account IDs and canonical logins.
  Run now takes a page request ID and returns its run after workspace admission.
  Run history returns up to 50 runs and a `nextCursor` for `routinePaths.runs`.
  Each run carries its own `agent` and `owner`, independent of later routine edits or owner moves.
  An unknown historical agent or owner is null.
  Removed workspaces have a null run workspace ID, while first-turn failures keep their workspace link.
  A pull request trigger can carry `skipLogin`, the account login of an author or sender skip.
  Older runs and skips without an account omit it.
- [Workspace views](workspace-view.ts) add the routine ID and name of a run, or null, in backend replies.
  The routine's `pullRequest` holds the run's pull request number and URL, or null for scheduled and Run now runs.
  Replies also carry `baseBranch`, resolved by the Worker. View writes cannot change it.
- [Base image](base-image.ts) records the software labels, their primary source, and the source check date.
- [Browser fakes](../test-support/README.md) use these response types.
- [Runner fakes](../../worker/test-support/README.md) use these message types.
- [Migrations](../../migrations/README.md) define the D1 tables and reserved ranges.
