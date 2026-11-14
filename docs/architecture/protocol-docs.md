# Protocol docs

The protocol docs hold the requirements and the decisions in force of each
feature. The [architecture doc](../architecture.md) describes the components
that meet them, and gives the terms and the meaning of a decision number.
This page lists each protocol doc and what it covers.

- [Workspaces and sandboxes](../protocol/workspaces-and-sandboxes.md): the org
  image, the life of a workspace, and the disk flushes of a sandbox.
  - [Sandbox software](../protocol/sandbox-software.md): the releases of the
    app's own software, the updates of each sandbox, the install in a
    build, and the software image.
  - [Create a workspace](../protocol/create-a-workspace.md): New workspace as a
    page or as a dialog, the create, the branch, and a failed first start.
  - [Repository folders](../protocol/repository-folders.md): the folder and the
    shell variable of each repository in a sandbox, and the context folder
    of each workspace.
  - [Life of a workspace](../protocol/workspace-life.md): the start steps,
    the time limits, the states, the stop and resume, the archive, the
    restore, and Continue.
    - [Workspace list marks](../protocol/workspace-marks.md): GitHub colours,
      agent motion, unread output, and reduced motion.
  - [Continue](../protocol/continue.md): the next task of a workspace after a
    merge, on a new branch with the same sandbox and sessions.
  - [Workspace menu](../protocol/workspace-menu.md): the menu of a workspace
    row, which moves, reassigns, renames, and archives the workspace.
  - [Workspace tools](../protocol/workspace-tools.md)
    - [Temporary tabs](../protocol/temporary-tabs.md): the one file or diff
      tab that the next press replaces, what opens and keeps it, and its
      mark in the saved view.
    - [Port previews](../protocol/port-previews.md): detected servers, manual
      opening, preview tabs, and the relay requirement.
- [Chat and events](../protocol/chat-and-events.md): sessions, messages, what
  the chat shows, and the events.
  - [Messages and attachments](../protocol/messages-and-attachments.md)
    - [Message attachments](../protocol/message-attachments.md): the size
      limit, the upload, the storage, the copy into the cloud computer, and
      the deletion of the files of a message, and their chips and their
      drop in the message field.
    - [Fast mode](../protocol/fast-mode.md): the Fast switch of the model
      menu, the models that show it, who may turn it on, and the speed of a
      turn that cannot run fast.
  - [File mentions](../protocol/file-mentions.md): the list of `@` in the
    composer, the chips of files and folders, the sent chips of attached
    files, and the removal of each chip of the composer.
  - [Agent runner](../protocol/agent-runner.md): the connection of the runner,
    its events and their limits, its turns, the background work of Claude
    turns with its note and its time limit, its port reports, and the repair
    of lost workspace updates.
    - [Listening ports](../protocol/listening-ports.md): the scanner's
      eligibility, labels, limits, and full reports.
    - [Lost workspace updates](../protocol/lost-workspace-updates.md): the
      reports that belong to no session, the repair request after a refused
      update, and the notice of a failed repair.
  - [Session transcripts](../protocol/session-transcripts.md): copying a
    session as concise or full Markdown, and the text of a copy.
    - [Transcript routes](../protocol/transcript-routes.md): the route of
      a copy.
    - [Transcript reads by agents](../protocol/transcript-reads.md): the
      route of `read_session`, and the parts of a long text.
- [Access and security](../protocol/access-and-security.md): sign-in, the
  gates, the secrets, and the isolation of sandboxes and previews.
  - [Isolation of orgs and sandboxes](../protocol/isolation.md)
    - [Version pins](../protocol/version-pins.md): the runner version that
      a workspace accepts, the version pin, and the risks of the turn
      token in a sandbox.
  - [Tokens and secrets](../protocol/tokens-and-secrets.md)
    - [Own endpoint logins](../protocol/own-endpoint-logins.md): the
      endpoint and the key of each agent, the model list of the endpoint,
      and the addresses that the app accepts.
  - [Terminal, previews, and desktop](../protocol/terminal-previews-and-desktop.md)
- [Model gateway](../protocol/model-gateway.md): the turn token, and the
  Worker routes that add the agent login to each model request.
  - [Model gateway: requests and answers](../protocol/model-gateway-requests.md):
    the upstream of each login, what passes to it and back, the own
    endpoints, the streams, and the risks.
- [GitHub banner](../protocol/github-banner.md): the pull request bar, its
  actions, Merge, and its events.
  - [The GitHub state](../protocol/github-summary.md): the four summary
    values for workspace list marks and their order.
- [Agent tools](../protocol/agent-tools.md): the tools that agents use in a
  sandbox, and Mac commands.
  - [Agent tool access](../protocol/agent-tool-access.md): what each call
    reaches, which calls need an active turn, and the rights of the sender.
  - [Workspace calls](../protocol/workspace-calls.md): the calls that
    create, list, get, rename, move, and archive workspaces, and the lists
    that a create call takes.
  - [Session calls](../protocol/session-calls.md): the calls that start,
    list, message, and read the sessions of the org.
    - [Session management](../protocol/session-management.md): the calls
      that get, rename, close, and stop a session, and get a message.
  - [Section and preview calls](../protocol/section-and-preview-calls.md):
    the calls that create and delete sections, and list, open, and close
    port previews.
  - [Names from the workspace tools](../protocol/tool-names.md): the rule
    for the names and titles that the calls give.
- [Orgs and members](../protocol/orgs-and-members.md): orgs, sections,
  roles, the first run, and the end of an org.
  - [Org rail order](../protocol/org-rail-order.md): the order of the orgs
    in the rail that each person keeps, and how the person changes it.
- [Mac app](../protocol/desktop-app.md): the shell for macOS, its sign-in, and
  Mac commands.
  - [Mac packages and updates](../protocol/desktop-packages-and-updates.md)
  - [Mac app sign-in](../protocol/desktop-sign-in.md)
  - [Permissions and Mac commands](../protocol/desktop-commands.md)
- [Operator actions](../protocol/operator-actions.md): the operator, the
  suspension of a user or an org, the lift of a suspension, and abuse
  reports.
- [Operator section](../protocol/operator-section.md): the pages of the
  operator in the web app, their counts, and their searches.
- [Command palette](../protocol/command-palette.md): the key and the search
  that finds the workspaces, the actions, and the settings.
- [Command palette: empty and unavailable states](../protocol/command-palette-states.md):
  what the palette shows while its workspace data loads or did not load,
  and when a tab or a search has no row.
- [Command palette: actions and settings](../protocol/command-palette-actions.md):
  the actions that the palette offers, their order and their groups, the
  Help group with Send feedback, and the rows of the Settings tab.
- [Feedback](../protocol/feedback.md): the Feedback dialog that Send
  feedback opens, its screenshots and context, the reply address, the
  routes, and the email to the team inbox.
- [Keyboard shortcuts](../protocol/keyboard-shortcuts.md): the commands that
  keys run, where a key goes, and where the changes of a person live.
  - [Keyboard shortcuts: the keys](../protocol/keyboard-shortcuts-keys.md)
  - [Keyboard shortcuts: fixed keys and text keys](../protocol/keyboard-shortcuts-fixed-keys.md)
  - [Keyboard shortcuts: the hosts](../protocol/keyboard-shortcuts-hosts.md)
  - [Keyboard shortcuts: matching a press](../protocol/keyboard-shortcuts-matching.md)
  - [Keyboard shortcuts: the settings tab](../protocol/keyboard-shortcuts-tab.md)
- [Org image](../protocol/org-image.md): the org image, its builds and its
  refreshes, and the first build of a new org.
- [Agents and sessions](../protocol/agents-and-sessions.md): the agents and
  their logins, the sessions, and the names of workspaces and sessions.
  - [Workspace and session names](../protocol/workspace-and-session-names.md):
    the missing and the automatic names of workspaces and sessions.
- [Workspace links](../protocol/workspace-links.md): Copy link, and the chips
  that show workspace links in chat.
- [Chat Markdown](../protocol/chat-markdown.md): the formatting of agent
  messages in the chat, with their headings and lists, and their lines in
  the work of a turn.
  - [Chat tables](../protocol/chat-tables.md): the tables of agent
    messages, their short rows and wide tables, and the table rules that
    they share with the file preview.
- [GitHub tokens](../protocol/github-tokens.md): the git and CLI account
  scope of a cloud computer, the author of each commit in a sandbox, and the
  GitHub actions of the Worker as a member.
- [Agent instructions](../protocol/agent-instructions.md): the text that each
  agent session gets, and the sender line and the branch line of each
  message.
  - [Base prompts](../protocol/base-prompts.md): the base prompt of Claude
    agents and the base instructions of Codex agents.
- [Waitlist](../protocol/waitlist.md): app access, the waitlist screen, the
  ways in, the approval email, and the record of app access.
- [Invite and referral codes](../protocol/waitlist-codes.md): the codes of
  the waitlist, the join link, and the use of a code.
- [Sign-ups](../protocol/sign-ups.md): the pause, the waitlist switch, open
  sign-up, and the main action of the marketing site.
- [Website docs](../protocol/website-docs.md): the public guides of the
  marketing site, their addresses and navigation, and the rules for their
  words.
- [Conductor comparison](../protocol/conductor-comparison.md): the public
  page for people who move from Conductor, with the status of each
  Conductor feature.
- [Routines](../protocol/routines.md): routines and their schedules, with the
  linked pages [Routine runs](../protocol/routine-runs.md),
  [Pull request runs](../protocol/pull-request-runs.md), and
  [Base branches](../protocol/base-branches.md).
