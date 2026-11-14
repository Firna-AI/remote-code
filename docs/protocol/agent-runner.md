# Agent runner

This doc holds the requirements and the decisions in force for the agent
runner, our program in each sandbox. It covers the connection of the
runner, its events and their limits, its turns, the background work of
Claude turns, its report of the listening ports, and the repair of lost
workspace updates. It belongs to
[Chat and events](chat-and-events.md), which covers the agents, the
sessions, what the chat shows, and the events. The terms are those of the
[architecture doc](../architecture.md#terms). A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says. A gateway decision number names a decision of the change that adds
the [model gateway](model-gateway.md), as that doc says. A background work
decision number, such as background work decision 1, names a decision of
the change that keeps a turn open for background work.

## The agent runner

- The runner starts with the sandbox, and starts again after each resume.
- The runner opens one outbound WebSocket to the Durable Object of its
  workspace, at `/v1/runner` on `api.conductive.build`, the hostname for
  machines. It proves itself with the workspace token.
- The runner connection carries a protocol version.
  [Runner versions](version-pins.md#runner-versions) states which version
  a workspace accepts, and what a refused runner and its turns get.
  [The version pin](version-pins.md#the-version-pin) states the lowest
  version that each workspace accepts.
- Each build of the org image installs the newest runner. Each sandbox then
  updates its runner itself at a later start, as
  [Updates](sandbox-software.md#updates) says. Reason: a fix of the runner
  then reaches each sandbox with no new workspace.
- A sandbox runs its older runner until its update applies. A stopped
  sandbox can also resume weeks later with an old runner.
- A connection to the runner through a Boat port address was rejected,
  because it ties the runner to Boat.
- The runner numbers each event, and keeps it until the Durable Object
  confirms it.
- A dropped connection loses no event. A resent event shows once.
- A complete numbered runner event envelope holds at most 1 MiB, or
  1,048,576 bytes, of compact UTF-8 JSON (decision 76).
- The limit measures `JSON.stringify` of the complete runner event envelope.
  It includes the stream ID, event number, timestamp, payload, escapes, and delimiters.
- The limit excludes WebSocket framing and the workspace storage wrapper.
  Reason: the remaining storage value budget holds that wrapper.
- Each tool detail holds at most 64 KiB, or 65,536 bytes, of serialized UTF-8 JSON.
  The count includes its surrounding quotes and JSON escapes.
- The runner keeps the longest detail prefix that fits that limit.
  It replaces lone UTF-16 surrogates with U+FFFD before it counts or truncates text.
- A prefix never splits a Unicode code point.
  The omitted detail count measures source UTF-8 bytes before JSON escaping.
- The count applies to the complete source detail of that tool update.
  It does not add the counts of previous updates.
- A null detail stays null and has an omitted count of zero.
  A complete detail also has an omitted count of zero.
- A detail has no inserted omission notice. Its count carries that information.
- An end-of-turn file list keeps a prefix of at most 200 unique-path entries.
  Its serialized UTF-8 JSON array also holds at most 256 KiB, or 262,144 bytes.
- That byte count includes brackets, commas, and escapes.
  Each entry stays whole. The omitted file count equals the full count minus the kept count.
- Both omission counts are non-negative safe integers.
  Reason: bounded excerpts keep tool output and turn summaries within the event budget.
- A `turn.completed` event carries `filesUnavailable: true` when the runner
  cannot tell which files the turn changed (decision 109). Examples are a
  failed read of the repository, and a restart that ends a started turn.
- With the mark, `files` is empty and `omittedFileCount` is 0. These values
  then mean an unknown list. Without the mark, the same values mean that
  the turn changed no files.
- The mark never changes the state of the end, `finished` or `stopped`.
- A `turn.completed` event of a turn with fast mode on carries its speed
  when known, with the cause of a standard speed, as
  [The speed of a turn](fast-mode.md#the-speed-of-a-turn) says. The speed
  never changes the state of the end either.
- A permanent refusal has one of three reasons: too large, invalid, or turn not active.
  The workspace stores one small refusal marker before it confirms that runner event.
- The marker names the runner stream, runner event number, event type, and reason.
  An invalid discriminator uses `unknown` as its type.
- A marker includes verified session and turn IDs, or null when no verified context exists.
  It never copies the refused payload.
- The marker belongs only to workspace chat events. The runner cannot send it.
- A confirmed marker advances the runner cursor and removes that event from its outbox.
  A duplicate produces no second marker and no second chat line.
- Reason: one bad event must not stop all later events (decision 76).
- A refused end-of-turn event still ends its active turn.
  The marker shows that the terminal data was lost.
- Turn not active means that the event names a turn that never started (decision 104).
  The workspace stores each valid late event of a turn that started and has ended, in that turn.
- A late event never reopens its turn or changes its end.
  The active turn of its session stays the same.
- The chat shows that turn as ended. A tool that was running in it shows as stopped.
- Reason: after a resume, the runner sends the unconfirmed events of an ended turn again.
  A refusal of these events was rejected, because it lost real agent text.
- A storage or network failure closes the connection without a confirmation.
  It remains retryable. It never becomes a permanent refusal.
- The Durable Object forwards each message, each message during a turn,
  each interrupt, and each change of the model, the effort, or the fast
  mode to the runner.
- Each turn also brings a turn token for the agent login of the starter of
  its session, as [The turn token](model-gateway.md#the-turn-token) says.
  No command carries the agent login itself, as
  [Agent logins in a sandbox](isolation.md#agent-logins-in-a-sandbox)
  says.
- A turn on a Claude own endpoint login also asks the runner for a prompt
  cache of 1 hour, as
  [How the agents reach the gateway](model-gateway.md#how-the-agents-reach-the-gateway)
  says. A runner that does not support this request ignores it. Claude
  then asks for the default cache of about 5 minutes.
- Each turn also asks the runner for the fast mode of its choice. A runner
  that does not support fast mode ignores it, and the turn runs at standard
  speed, as [Fast mode](fast-mode.md#the-requests-of-the-agents) says.
- Each turn that the runner accepts gets exactly one end: `turn.completed`
  or `turn.failed`. This holds also when Stop, a shutdown, or a crash of
  the runner comes before the agent starts.
- The runner keeps a record of each accepted turn across a crash and a
  restart, until the workspace confirms the end of the turn. The workspace
  sends no turn or message command for a turn after it stores the end of
  that turn.
- After a failed file copy ends a running turn, the workspace can still
  send Stop for that turn, to cancel the agent. That turn still shows as
  failed. Reason: the failure in [Attachments](messages-and-attachments.md#attachments) ends the turn
  at once, with no new wait for the agent.
- At a shutdown, the runner sends a stopped end for each accepted turn that
  has no end. After a restart, it does the same for each turn that it
  accepted before the restart. It starts no agent for such a turn.
- A resent turn command or Stop that finds the record of its turn starts
  nothing and sends no second end.
- A Stop of a turn that the runner does not know gets one stopped end. The
  runner keeps a record of that turn too.
- Reason: work that Stop or a shutdown ended must not run later. A list of
  waiting turns only in memory was rejected, because a crash loses it, and
  the resent turn then runs.
- When a read of the repository or a save by the runner fails during a
  step, the runner still ends that step (decision 109):
  - A turn that cannot start ends with `turn.failed` and its cause.
  - A turn whose changed files the runner cannot read ends with
    `filesUnavailable: true`.
  - After a connect, a failed scan of the repository does not stop
    `runner.ready`. The runner sends `files.unavailable` first, as
    [Files and changes](workspace-tools.md#files-and-changes)
    says. It then accepts commands.
- Reason: one failed read must not leave a turn running with no agent, or
  the chat in its starting state. An exit of the runner after such a
  failure was rejected, because it loses each running turn, and a lasting
  failure repeats the exit.
- The runner also reports the file tree and the changes of its workspace,
  and reads files and diffs on request, as
  [Files and changes](workspace-tools.md#files-and-changes) says.
  File results are not part of the chat history.

## Background work

- Live work is each task of the
  [background work](../architecture.md#terms) that runs or waits to start,
  and each wake-up. A task that the agent program does not count as
  activity is not live work.
- A Claude turn stays open after a reply of the agent while live work
  remains (background work decision 1). Such a time is a wait.
- When a task ends or a wake-up fires, the agent program notifies the
  agent. The agent then works again in the same turn.
- The turn ends when the agent is idle and no live work remains. The agent
  is idle when no reply runs and no message of the turn waits for an answer.
- That end has the state `finished`. Its duration and its files cover the
  whole turn, with each wait.
- Each end of a Claude turn closes the agent program. The close ends its
  tasks, and each wake-up that it keeps only in memory.
- A waiting turn is a running turn for every other rule. Examples are Stop,
  a shutdown, a message, a model change, the turn token, the idle stop, and
  Continue. So Stop during a wait ends the turn as stopped.
- A Codex turn does not wait, because Codex gives its agent no notification
  when background work ends.
- Reason: the tool text of Claude promises that notification. The wait
  keeps the promise up to the limit, also in a routine run.
- A rule that the agent waits in the foreground for each result was
  rejected, because the tool text still promises the notification.
- Background work turned off was rejected, because agents then lose it also
  inside a turn.
- A new turn that background work starts by itself was rejected, because
  sandbox code could then spend the login of the sender.

### The note

- At the end of a reply, the agent gets one note when live work holds a
  task or a wake-up that no earlier note of the turn named.
- The note names each such task and wake-up, so each one at most once in a
  turn. Reason: a second note for the same work can loop the agent.
- The note is guidance, not an error, so the reply goes on. It says that
  the turn stays open while the work runs, for up to 30 days. It says that
  a notification comes when each task ends or each wake-up fires.
- The note asks the agent to stop each task that it does not need, such as
  a dev server. It asks the agent to delete each wake-up that it does not
  need. Then it asks the agent to end its reply.
- The note follows the naming rules of the
  [agent instructions](agent-instructions.md#what-the-instructions-hold).
  So it never names Boat, and it never uses "Claude Code" as a name.
  Reason: the agent can repeat the note in the chat.
- The chat never shows the note. Reason: the note is for the agent.
- A wake-up that repeats is live work too. Reason: one rule for all
  background work keeps the promise of each tool.
- A wait with no note was rejected, because a forgotten dev server would
  then hold each turn until the limit.

### The time limit

- A turn waits for at most 30 days. The user chose this limit on
  13 November 2026, in place of the 120 minutes of background work
  decision 2. Reason: background work, such as a long job or a scheduled
  wake-up, can need more than 2 hours.
- No limit was rejected, because a forgotten task would then hold its
  sandbox without end.
- The count starts at the first wait. Agent work after a notification
  counts.
- A message of a member that joins the turn during a wait starts the count
  again, from that message. A message during a reply does not change the
  count.
- Reason: the limit bounds the waiting that a turn holds with no new
  message of a member.
- When the limit passes during a reply, the limit applies at the end of
  that reply. Reason: a cut tool call can leave half-done work, such as a
  push without its merge.
- When the limit applies, the runner closes the agent program (background
  work decision 3). The runner then sends `turn.completed` with the state
  `finished`, its duration, its files, and `endReason`.
- This end at the limit holds also when no live work remains at the end of
  that reply.
- `endReason` is an optional field of `turn.completed`. Its one value is
  `background_work_limit`, which marks an end at the limit.
- A stopped end at the limit was rejected, because it shows no duration
  and no files.
- Risk: a wait keeps each right of a running turn, such as its turn token,
  for up to 30 days more, as
  [Turn tokens in a sandbox](version-pins.md#turn-tokens-in-a-sandbox)
  says.
- Risk: a wait is a running turn, so the
  [idle stop](workspace-life.md#stop-and-resume) does not stop its
  sandbox. A task that the agent does not stop, such as a dev server, can
  keep the sandbox running for up to 30 days.

## Listening ports

The [listening-port requirements](listening-ports.md) give the scanner,
its labels, its limits, and its full reports.

## Lost workspace updates

The [lost-update requirements](lost-workspace-updates.md) give the reports
that belong to no session, the repair request after a refused update, and
the notice of a failed repair.
