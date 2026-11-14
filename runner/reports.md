# Runner reports

This guide belongs to the [agent runner](README.md).

The workspace sends a `report.refresh` command when it needs a fresh full
report of one kind.
[Lost workspace updates](../docs/protocol/agent-runner.md#lost-workspace-updates)
states the requirements.

- The runner takes a request without a session or a credential. The agents
  never get it. So a running turn keeps its agent process and its input.
- After the `welcome`, the runner takes commands while the refresh after the
  connect still runs. So a request does not wait for `runner.ready`.
- A `files.snapshot` or `changes.updated` request scans the repository again.
  It sends a full report of that kind only, in numbered parts.
- The repository watcher, the refresh after each connect, and these two
  report requests share one scan queue. So such a report request waits for
  each earlier scan. The events of two scans never interleave. File reads
  and diffs do not use this queue.
- A watcher scan compares each kind with the last scan of that kind. So a
  request for one kind hides no later update of the other kind.
- The runner keeps the latest `start.updated` and `workspace.title`
  reports in memory. Each saved state includes them. A confirm does not
  remove them. They stay after a restart.
- A `start.updated` or `workspace.title` request selects the current
  report and appends its filtered copy in one store operation. It saves
  the copy before it sends it, with a new event number.
- Until the runner accepts an event of that kind, such a request sends
  nothing. The runner has no source of new start steps or new workspace
  names yet.
- The runner skips a command ID that it has seen. When the runner answers
  with a report, the save of the last report event also saves the ID. So a
  repeat of that ID after a reconnect or a restart sends nothing. If the
  runner process ends before that save, a repeat after the restart gets a
  new answer. The outbox still resends an unconfirmed answer.
- A state file from an older runner has no saved events of these two kinds
  and no saved IDs. The runner still reads it.

## Listening ports

- `ProcPortScanner.scan()` reads the TCP socket tables and resolves new
  sockets through process file descriptors. It caches each socket's complete
  selected labels. The executable link identifies the program or interpreter.
  A rewritten interpreter title without an identifiable script has no name.
- `PortReporter` keeps two successful scans for each addition or removal.
  A failed table read keeps the last list and writes a local warning.
- Production `main.ts` supplies a scan every 2 seconds. Its timer stops at
  shutdown. The `PortReports` boundary lets tests inject
  scans and scheduling without reading the host socket tables.
- The port scan queue is separate from the repository scan queue. Agent
  commands do not wait for either queue.
- Each connect sends the current full stable list, including an empty list.
  A `ports.updated` refresh scans again and sends that list with its command
  receipt. The scan keeps the same two-scan rule for new and closed ports.
- A scan reads no process environment and makes no request to a server.
  It selects only a program, script, or module and one allowed command word.
  Its complete folder stays relative to the repository folders.
- The runner filters known credentials from those complete selected labels.
  Its outbox and reconnect keep complete labels, including labels longer
  than the displayed limits. A private byte budget can omit a whole optional
  label. It never cuts a private label.
- The workspace filters its captured marked env values from complete labels.
  Only then does it shorten names and folders for storage and browsers.

[Listening ports](../docs/protocol/agent-runner.md#listening-ports)
states the filters, labels, limits, and scan timing.
