# Version pins

This page belongs to [Isolation of orgs and sandboxes](isolation.md). It
states which runner protocol version a workspace accepts, the version pin
of a workspace, and the risks of the turn token in a sandbox.
[Agent logins in a sandbox](isolation.md#agent-logins-in-a-sandbox) states
the share setting and the other login rules. The terms are those of the
[architecture doc](../architecture.md#terms). A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says. A gateway decision number names a decision of the change that adds
the [model gateway](model-gateway.md), as that doc says.

## Runner versions

- The [runner connection](agent-runner.md#the-agent-runner) carries a
  protocol version. The workspace accepts only runner protocol version 2,
  the version of the current runner (the user's decision of 12 November
  2026).
- Reason: that version runs each turn through the
  [model gateway](model-gateway.md), with a turn token. So no agent login
  reaches a sandbox.
- The workspace refuses a runner of any other version, whatever the
  version pin of the workspace. It closes that connection before the
  `welcome` and before any command. So the runner gets no credential.
- Reason: any process with the workspace token can open a runner
  connection and claim any version.
- When the workspace refuses a runner below version 2, each turn of the
  workspace that waits or runs fails with the code
  `runner_protocol_unsupported`. The cause says that the cloud computer
  can no longer run agents. It tells the member to ask an admin to build
  the org image again, and then to start a new workspace.
- A start of the cloud computer that waits for a runner below version 2
  also fails at once with the same cause. It fails in the same way as
  after any other error.
- These failures do not mark the login of a session as unusable.
- Reason: a new cloud computer from a rebuilt org image starts with the
  newest runner at once. Existing computers follow the
  [sandbox software update rules](sandbox-software.md#updates).
- The refusal of a runner above version 2 changes no turn and no start.
  Reason: only a later release of the app accepts such a runner, so the
  cause above does not help.
- After a restart of the workspace, a saved connection of another version
  closes in the same way. A saved connection that sent its `hello` but has
  no recorded version counts as a version below 2.

## The version pin

- The version pin of a workspace is the lowest runner protocol version
  that it accepts. The version pin of a sandbox is the version pin of its
  workspace.
- Each build and each refresh of the org image records the runner protocol
  version that it installs. A refresh also installs the newest release, as
  [Installs in a build](sandbox-software.md#installs-in-a-build) says.
- Each cloud computer of a workspace takes the runner version of the org
  image that it starts from as the version pin of the workspace, before it
  can connect. So a Try again that starts a new cloud computer from a
  newer image takes the version of that image. A stop and a resume keep
  the pin.
- A workspace or an org image without a recorded version counts as version
  1, the oldest runner version (gateway decision 5).
- The workspace also refuses a runner connection whose protocol version is
  below its pin. It closes that connection before the `welcome` and before
  any command. That refusal changes no turn and no start.
- A pin never lets a runner of another version connect. So a runner of
  version 2 works in a workspace with a pin of 1 or with no recorded pin.
- The version pin decides no login rule. Each sandbox follows
  [Turn tokens in a sandbox](#turn-tokens-in-a-sandbox), whatever its pin.
- Reason: a later release can accept more than one runner version. The pin
  then stops a process with the workspace token from claiming a version
  below the runner of its image.
- A pin by the first connection was rejected, because a program that the
  org image or the startup script starts can connect first.

## Turn tokens in a sandbox

- A sandbox holds no agent login. The [model gateway](model-gateway.md)
  keeps each login in the Worker, and adds it to each model request of a
  turn (decision 120).
  [No login in the sandbox](model-gateway.md#no-login-in-the-sandbox)
  gives the approaches that were rejected.
- No runner connection gets an agent login, whatever version it claims.
  The workspace refuses each other version before any command, as
  [Runner versions](#runner-versions) says.
- Risk: while a turn runs, each process in the sandbox can read its turn
  token. A member with a terminal in the sandbox can read it too.
- Claude reads the token from a file that only the sandbox user can read.
  Each process of the sandbox runs as that user, so it can read the file
  (gateway decision 11).
- Codex reads its ChatGPT turn token from the login file of its session.
  Only the sandbox user can read it. Processes of that user can copy it
  while the turn runs (decision 175).
- The email, account ID, and ChatGPT workspace name of the signed-in account also reach
  the sandbox. A process or member with a terminal can read them.
- Such a process or member can spend the login of the starter through the
  gateway while the turn runs. A copy of the token works in the same way
  outside the sandbox. A request that still runs at the end of the turn
  stops within 30 seconds, as
  [Streams](model-gateway-requests.md#streams) says.
- The token works only on the model routes of the gateway.
  [The turn token](model-gateway.md#the-turn-token) states when it works.
  It never gives the login itself.
- Risk: a settings file in the repository, such as `.claude/settings.json`,
  can set the address of the model requests of Claude. Claude then sends
  each model request, with its content and the turn token, to that
  address. A commit, the agent, or other code in the sandbox can change
  that file (gateway decision 11).
- Risk: a process that keeps running in the sandbox can also get the turn
  token of each later turn while that turn runs. This holds also for the
  turns of other starters. Examples of such a process are a server that a
  tool started, and a program that the startup script started. It can
  read each token from the runner, or from the file of Claude, while that
  turn runs.
- So the members of one org trust each other with the use of their logins
  while their turns run. The share setting does not keep a turn token away
  from them. No other member and no process in the sandbox can get the
  login itself.
