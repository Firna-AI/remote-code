# Agent tools

This doc holds the requirements and the decisions in force for the tools
that the app gives the agents in each sandbox. It covers the workspace
tools as a whole, Mac commands, and the computer tools. Linked pages state
the calls of the workspace tools:

- [Agent tool access](agent-tool-access.md): what each call reaches, which
  calls need an active turn, and the rights of the sender.
- [Workspace calls](workspace-calls.md): the create call, the workspace
  list, the calls of one workspace, and the lists that a create call
  takes.
- [Session calls](session-calls.md) and
  [Session management](session-management.md): the calls of sessions and
  messages.
- [Section and preview calls](section-and-preview-calls.md): the calls of
  the sections and of the port previews.
- [Names from the workspace tools](tool-names.md): the rule for each name
  and title that a call gives.

The terms are those of the [architecture doc](../architecture.md#terms). A
decision number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

## Workspace tools

- Every sandbox has two workspace tools: an MCP server and a CLI.
- Both tools give each call. Reason: the two tools stay equal.
- The tools have 24 calls:
  - 9 workspace calls: create, list, get, rename, move, and archive a
    workspace, and list the repositories, the sections, and the models
    that a create call takes
  - 9 session calls: list, read, get, start, rename, close, and stop a
    session, send a message, and get a message
  - 5 section and preview calls: create and delete a section, and list,
    open, and close the previews of a workspace
  - 1 call that asks to run a command on a Mac, as
    [Mac commands](#mac-commands) says
- The calls cover each command of Conductor's CLI whose feature Conductive
  has (decision 277). Reason: an agent can then manage the work that it
  hands out.
- Calls for routines and for the env vars of one workspace were left out
  (decision 277). Reason: Conductor's CLI refuses the workspace token for
  its routine commands, so its agents cannot use them either. Conductive
  has no env vars for one workspace.
- Fast mode has no call of its own. Each call that takes a model also takes
  fast mode, as Conductor's CLI takes it beside the model and the effort.
  [Fast mode](fast-mode.md#agent-tools) gives the rules.
- Both tools call the Worker with the workspace token of their sandbox.
- With the workspace token, the tools can make only these calls.
  [The workspace token](tokens-and-secrets.md#the-workspace-token) states
  what the token allows.
- For each refusal of the Worker, both tools give the agent its error code
  and its message. Reason: an agent can act on a refusal, such as a closed
  session.
- An input of the wrong form, such as a word where a call takes a number,
  gets HTTP 400 with the error code `invalid_input`.
- The tools call `api.conductive.build`, the hostname for machines. Its
  gate checks the workspace token in place of a sign-in.
- Each call has a fixed route of its own under `/v1/tools/`. The table of
  each linked page gives the routes. Mac command requests use
  `/v1/tools/mac-command` and the addresses under it. Reason: the token
  gate of the machine host keeps one list of routes.
- The CLI takes the text of a message from a file, or from stdin with `-`,
  for each call that takes a message. Reason: Conductor's CLI takes a
  message file. The MCP server takes the text only.
- The workspace tools are a part of the sandbox software. A build of the
  org image installs the newest tools. A cloud computer gets newer tools
  with each update, as [Updates](sandbox-software.md#updates) says.
- Older tools keep working with the Worker until their update applies.
  They offer only their own calls.
- The app sets no limit of its own on the workspaces that agents create
  (decision 8). The plan limits of the app's Boat account apply, as
  [The provider](workspaces-and-sandboxes.md#the-provider) says.
  [No limit](session-calls.md#no-limit) states the same for sessions.
- A workspace that an agent creates starts with no approval step in the
  app.

## Names of the calls

- Each MCP tool has a verb and a noun, such as `archive_workspace`. Each
  CLI command has the form `conductive <nouns> <verb>`, such as
  `conductive workspaces archive` (decision 278).
- Conductor's command names were rejected for the CLI, for the MCP tools,
  and as aliases. A second program with Conductor's commands was rejected
  too. Reason: agents learn the tools from their descriptions and help, so
  names matter little.

## Tool descriptions

- The help of the CLI and the descriptions of the MCP tools say these
  things:
  - which calls need an active turn
  - that the calls reach each workspace of the org
  - that a write acts with the rights of the sender in the app, so only the
    workspace owner or an admin can archive a workspace
  - which links each reply gives
- [Tool descriptions](session-calls.md#tool-descriptions) states the
  other text of the session calls.

## Create and list calls

[Create a workspace](workspace-calls.md#create-a-workspace) and
[List the workspaces](workspace-calls.md#list-the-workspaces) state the
create call and the workspace list.

## Repository, section, and model lists

[Repository, section, and model lists](workspace-calls.md#repository-section-and-model-lists)
states the three lists that a create call takes.

## Mac commands

An agent can ask to run a command on the Mac of the person who sent its
turn (decision 62). The Mac app on that Mac asks that person first, as
[Mac commands in the Mac app](desktop-commands.md#mac-commands) says.

### Who gets a request

- A request goes only to the Mac of the sender of the turn that asks.
- The agent login belongs to the starter of the session (decision 105). A
  request still goes to the Mac of the sender of the turn. A request to the
  Mac of the workspace owner was rejected, because one member could then ask
  for commands on the Mac of another member.
- The first turn of a workspace that a create call made has the sender of
  the calling turn. So does each new turn that a message of the
  [session calls](session-calls.md#the-sender) starts. The requests of
  such a turn go to the Mac of that member.
- A message of the session calls that joins a running turn keeps the
  stored sender of that turn.
- A request names its turn. The Worker accepts it only while that turn
  runs in the calling workspace.
- [The workspace token](tokens-and-secrets.md#the-workspace-token) states
  how the Worker finds the sender.
- When the sender has no available Mac, the agent gets the answer that the
  Mac is not available.
- Risk: every process in the sandbox can ask in the name of a turn that
  runs now. So a member with a terminal in the same sandbox can ask for a
  command on the Mac of that sender. The Mac still asks first, unless a
  saved choice covers the command.

### The request

- A request gives the exact command, the folder where it runs, the
  reason, and the time limit (decision 62).
- The workspace and the sender that a request shows come from the records
  of the Worker, never from the request.
- A request can have a stable ID for retries. The Worker keeps that ID
  exact. Each record also gives a key for its read and approval addresses.
- Reason: an ID such as `.` or `..` can change the meaning of a URL path.
- A request without a time limit gets 60 seconds.
- A time limit can be at most 120 seconds. A longer limit, up to 30
  minutes, needs a reason for the longer limit.
- Reason: the user sees why a command needs more time before they allow
  it. Conductor's tool does the same.
- Each request body of Mac commands, from the agent tools or from the Mac
  app, can contain at most 1,000,000 bytes, which is 1 MB (decision 65).
  The Worker stops reading a larger body and returns HTTP 413.
- Each message on the device connection has the same limit.

### Results

- Each request ends with one result for the agent: the command ran, the
  user denied it, or the Mac is not available.
- After a run, the agent gets the output of the command and how it ended:
  its exit code, the end of its time limit, or a failure to start.
- The command stops at its time limit.
- The output that returns to the agent has a size limit. When the output
  passes that limit, the result says that the output was cut.
- When the Mac stops being available while a request waits or runs, the
  request ends as not available.
- When its turn ends, a request that waits or runs ends too, and its
  command stops. Its result says that the turn ended. It does not say that
  the Mac is not available.

### Who answers

- Only the Mac app on the Mac that got the request can answer it.
- Reason: the person at that Mac decides what runs on it. A browser or
  another Mac cannot allow a command there.
- The web app in a browser and the Mac app on any other Mac show the
  request without choices.
- The Worker never allows a command by itself. The Mac app on that Mac
  decides, from the answer of its user or from a choice that its user
  saved there.

### What the chat shows

- While a request waits, it shows as a compact message just above the
  composer of its session (decision 62). The message shows the exact
  command, the Mac, and the time limit as a small label.
- Details opens the folder, the reason, the workspace, and the sender.
- A longer time limit shows its reason without a click.
- The user can scroll through long commands and all waiting requests with
  the keyboard. The composer stays reachable, and the Allow menu stays
  visible outside the region that scrolls.
- While a request waits, its workspace shows needs input, as
  [Workspace states](workspace-life.md#workspace-states) says
  (decision 68). The workspace keeps needs input while any of its
  requests waits.
- After its result, the command shows at its place in the chat: denied,
  done with its output, or Mac not available.
- When its turn ends, the result folds with the work of the turn, at its
  place, as [The work of a turn](chat-and-events.md#the-work-of-a-turn)
  says (decision 151). A result that stays in view between two folds was
  rejected, because the work then does not fold into one line.

## Computer tools

- The agents keep Boat's computer tools: the MCP server `computer` that
  every sandbox has (decision 36).
- The agent runner gives these tools to the agents.
- The agents use the computer tools for browser work on the desktop of the
  sandbox.
- The Desktop tool can show the same desktop, so the user can watch the
  agent work. The app hides it for now, as
  [Desktop](workspace-tools.md#desktop) says.
