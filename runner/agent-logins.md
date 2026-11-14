# Agent logins

This page belongs to the [agent runner](README.md). It gives the facts of
this implementation about agent logins and turn tokens.
[How the agents reach the gateway](../docs/protocol/model-gateway.md#how-the-agents-reach-the-gateway)
states the requirements.
[Turn tokens in a sandbox](../docs/protocol/isolation.md#turn-tokens-in-a-sandbox)
states the accepted risks.

An agent login is the Claude subscription token, ChatGPT sign-in, or
API key of the member who started a session. No runner command gives the
runner an agent login. Each `turn` command carries a turn token in place
of the login. The [model gateway](../worker/model-gateway/README.md) of
the Worker adds the login to each model request. Only the
[measure tool](#the-measure-tool) uses a real login, which a developer
gives it.

The runner's `hello.loginKinds` lists Claude tokens, Claude API keys,
Codex API keys, and Codex ChatGPT sign-ins. A `hello` without this list
supports the first three kinds only. The Worker checks each turn and later
message before it builds a command. An unsupported login ends the turn with a
cause. Reconnect cannot send that turn again.

## The turn token

- The `credential` of a `turn` command holds the turn token, the agent, and
  the login kind. Its agent must be the agent of the message. A `message`
  command carries no credential. A Codex `token` credential also holds
  public account identity: the account ID, email, plan type, and user ID.
- The runner closes its connection with code 1002 when a command lacks a
  field that it needs, or has an invalid one. An example is a `turn`
  command with no `credential`. A `welcome` of another protocol version
  also closes the connection.
- The parser ignores other fields. It keeps only the fields that it reads.
- The runner starts each turn with the token of its `turn` command. That
  token stays for the whole turn, also when a model change starts a new
  agent process in the turn. Each `message` command of the turn goes to
  the running agent process at once, whoever sent it.
- Each end of a turn closes its agent process, so no agent process keeps a
  token after its turn. A Claude process that waits for background work
  keeps its token, because its turn still runs, as
  [Background work](background-work.md#the-wait) says. The next turn starts
  a new agent process on the saved conversation, when one exists, with the
  token of that turn.
- The engine gives each agent adapter two values: the gateway address of
  its agent, and the turn token. The address is the machine origin with
  `/v1/model/claude` for Claude, or `/v1/model/codex` for Codex.
  `MACHINE_PATHS` in [`agent-tools.ts`](../src/shared/agent-tools.ts)
  holds these paths.
- The machine origin is the origin of `CONDUCTIVE_RUNNER_URL`, with
  `https:` in place of `wss:`.
- The runner passes the token unchanged, so the token keeps the prefix of
  a real login of its kind.
  [Model requests](../worker/model-gateway/README.md#model-requests) says
  how the gateway reads that prefix.
- The output filter keeps the token of each `turn` command, so that it can
  replace that token with `[redacted]` in displayed text. It keeps the
  tokens in memory until the runner process ends.
- The state file holds no turn token. No token goes in an agent's arguments.
  Claude reads its token from a credentials file, as [Claude](#claude) says.
  A Codex ChatGPT turn reads its token from a temporary login file.

## The helper boundary

The Rust helper driver sends start options through a private stdin pipe.
The helper keeps no state file and logs no request bytes.
Agent output returns through stdout as typed JSON lines.
Warnings pass through a token filter before local logging.
The runner's existing output filter masks event text before storage or sending.

Closing the helper cancels pending setup and closes the agent.
The helper removes temporary credentials after agent exit.
The runner waits for both agent cleanup and helper exit.
A failed helper process fails pending requests and the active turn.
The next runner start removes stale credential files.

## The agent environment

- `providerEnvironment` copies the environment of the runner. It removes
  each variable whose name starts with `ANTHROPIC_`, `CLAUDE_`, `OPENAI_`,
  or `CODEX_`, and the variable `CLAUDECODE`.
- It also removes `CONDUCTIVE_MEASURE_LOGIN`, the private input of the
  measure tool.
- It sets `HOME`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` for the home folder
  of the agents. It sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and
  `DISABLE_AUTOUPDATER` to `1`.
- It also sets the workspace tool context of the turn: its machine origin,
  workspace token, and turn ID, as
  [Workspace tools](agent-tools.md#workspace-tools) says. That context holds
  no agent login and no turn token.
- The Claude adapter adds the two profile variables that [Claude](#claude)
  names. For a subscription or own endpoint turn, it also adds the variable that
  [The prompt cache of Claude](#the-prompt-cache-of-claude) names.
- A Codex ChatGPT turn sets `CODEX_HOME` to its private session home.
  That value holds no token. The real ChatGPT sign-in stays in the Worker.
- Each other variable of the runner passes unchanged. Examples are the
  proxy and certificate settings in the env vars of the org.

## Claude

- Before it starts the `claude` program, the Claude adapter writes the
  profile pair of the session into `<home>/.conductive/anthropic`. That
  folder is beside the `claude` and `codex` folders of the agents. It has
  mode 0700.
- `configs/<name>.json` holds the gateway address of Claude as `base_url`,
  and `user_oauth` as `authentication.type`.
- `credentials/<name>.json` holds the turn token as `access_token`. The
  file has mode 0600, in a `credentials` folder with mode 0700. Each write
  sets these modes again. The pinned program refuses a credentials file
  that other users can read.
- The name is `session-`, then the hexadecimal SHA-256 hash of the session
  ID. So each session keeps one name, and two sessions never share a token.
- The adapter starts the program with `ANTHROPIC_CONFIG_DIR` set to that
  folder, and `ANTHROPIC_PROFILE` set to that name. The runner gives the
  program no descriptor credential, no `ANTHROPIC_BASE_URL`, no API key,
  and no auth token.
- The runner adds no gateway address, no proxy setting, and no certificate
  setting of its own to that environment or to the flag settings.
- The pinned program reads the address and the token from the profile
  pair. It uses the profile only when it has no other credential. An
  `ANTHROPIC_BASE_URL` setting wins over the `base_url` of the profile.
- The adapter keeps `settingSources: ['project']`. So the
  `.claude/settings.json` of the repository can set `ANTHROPIC_BASE_URL`.
  The program then sends each model request and the turn token to that
  address.
- The lifetime of the agent process removes the credentials file after the
  program exits. So the file goes at each end of a turn, at Stop, at a
  shutdown, and after a failed start.
- Stop also removes the file when it comes while the adapter still writes
  the profile pair. The config file stays, and it holds no secret.
- Before its first connection, the runner removes each entry of the
  `credentials` folder. So no token stays after a crash. A reconnect
  removes nothing.
- While the pinned program reads a credentials file, it locks the folder
  that holds the file. Its lock is the folder `credentials.lock`, beside
  the `credentials` folder. The program removes the lock at a normal exit
  and at each signal that it can catch.
- The removal before the first connection keeps that lock, because the
  lock is outside the `credentials` folder. A hard kill of the program
  during a read can leave the lock. Then no later program can read its
  token until the lock is 60 seconds old.
- The runner uses its own folder, not the default Anthropic folder
  `~/.anthropic`. So the Anthropic profiles of a project stay as they are.
- A tool process inherits `ANTHROPIC_CONFIG_DIR` and `ANTHROPIC_PROFILE`.
  A program that reads Anthropic profiles and has no key of its own can
  then find the profile pair while the turn runs.
- The Claude route of the gateway refuses the requests of such a program.
  They lack the markers of the `claude` program, as
  [Requests and answers](../docs/protocol/model-gateway-requests.md#requests-and-answers)
  says.
- This route belongs to the `claude` program 2.1.318 that Claude Agent SDK
  0.3.318 installs. `sdk-helper/package.json` pins that SDK version. Check the route
  again at each update of the SDK.

## The prompt cache of Claude

- The pinned `claude` program picks its own prompt cache time. Without an
  override, it asks for 1 hour only when it is signed in to a Claude
  subscription. With the profile pair, it does not know that a
  subscription is behind the turn token, so it asks for about 5 minutes.
- So for a turn whose credential has the login kind `token`, the Claude
  adapter adds `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` to the agent
  environment. That login kind is a Claude subscription token.
- The adapter also adds that variable when the gateway credential has
  `promptCacheTtl: '1h'`. The Worker adds this field only for a Claude own
  endpoint turn, which keeps the login kind `api-key`.
  The parser ignores unknown values and keeps the turn valid.
- With that variable, the program sends `"ttl": "1h"` and the
  `extended-cache-ttl-2025-04-11` value of `anthropic-beta` on its main
  requests.
- The variable holds also during paid extra usage, when Anthropic bills
  the use beyond the limits of the subscription. In native mode, the
  program asks for about 5 minutes then.
- An API-key turn without that field gets no such variable, so it keeps
  the default of about 5 minutes. The [measure tool](#the-measure-tool)
  gets none either, because in native mode the program picks its own
  cache time.
- The agent environment removes a copy of the variable that the runner
  inherited, as it removes each `CLAUDE_` variable. So the program never
  gets the value that the runner inherited.
- A tool process inherits the variable. Only the `claude` program reads
  it, and it holds no secret.
- The variable belongs to the same pinned program. Check it again at each
  update of the SDK.

## Codex

An API key uses a private login request and an ephemeral credential store.
A ChatGPT turn uses a temporary `auth.json` file in a private session home.
It holds only the turn token and synthetic identity data.
Both modes use the gateway.
[Codex logins](codex-logins.md) gives their settings, start sequence, and tests.

## The measure tool

The [measure tool](sdk-helper/scripts/README.md) sends one prompt with a login that a
developer gives it. It uses the native credential mode of the adapters,
with the login in place of a turn token. The runner never uses this mode,
because no runner command carries a login.

- The measure tool gives each adapter the address of its provider:
  `https://api.anthropic.com` for Claude, and `https://api.openai.com/v1`
  for Codex. So its model requests do not use the gateway.
- Codex: the model provider gets that address as `base_url`. The
  `account/login/start` request carries the login.
- Claude: the adapter puts that address in `ANTHROPIC_BASE_URL`, and it
  writes no profile pair.
- `spawnClaudeProcess` starts the `claude` program with one more pipe, on
  file descriptor 3. It adds `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3` for
  a subscription token, or `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR=3` for an
  API key. The value is only the number of the descriptor.
- It writes the login and a newline to the pipe. Then it closes its end of
  the pipe. It also closes its end when the program exits first.
- A pipe error closes the program. When the SDK fails after it started the
  program, the adapter closes the program and waits for its exit. Then the
  start fails.
- The pinned `claude` program reads that pipe once, until a newline or the
  end of the stream, and then closes it. Then it removes the descriptor
  variable from its own environment. So its later tool processes get
  neither the pipe nor the variable.
- The program uses this route when `CLAUDE_CODE_REMOTE` is not set and it
  has no IPC channel. With `CLAUDE_CODE_REMOTE` set, it can write a copy of
  the login to disk. The agent environment removes that variable, and the
  adapter starts the program without an IPC channel.

## What these routes do not stop

- A process of the sandbox user can read the credentials file of a running
  Claude or Codex ChatGPT turn. Each file holds only a turn token.
- A copy of a turn token works only as
  [The turn token](../docs/protocol/model-gateway.md#the-turn-token) says.
  [Turn tokens in a sandbox](../docs/protocol/isolation.md#turn-tokens-in-a-sandbox)
  states these accepted risks.
- The descriptor pipe of the measure tool stops only the automatic copy of
  the developer login into new processes. A process of the same user can
  still read that login on purpose while the tool runs.

## Tests

The [Rust command tests](../crates/cnd-runner/src/json/_tests_/command_tests.rs)
check typed credentials, public ChatGPT claims, author tolerance, and cache values.
The [helper process tests](../crates/cnd-runner/tests/engine/helper_process_tests.rs)
check correlated pipe requests and process exit.
The [engine tests](../crates/cnd-runner/tests/engine/)
check credential continuity and helper cleanup before completion.
The [filter tests](../crates/cnd-runner/src/filter/_tests_/)
check split tokens before event storage.

Helper tests stay under `sdk-helper/src/providers/`.
They check Claude profile files, cache settings, native descriptor pipes,
Codex private login, temporary ChatGPT files, and cleanup after cancellation.
These fake SDK checks prove no real login or model request.

## Key code

- [commands.rs](../crates/cnd-runner/src/json/commands.rs) validates commands and tolerant credential metadata.
- [provider.rs](../crates/cnd-runner/src/engine/provider.rs) pins the original turn credential and author in helper options.
- [helper](../crates/cnd-runner/src/helper/) starts private pipes and clears stale credentials before the first connection.
- [filter](../crates/cnd-runner/src/filter/) keeps workspace and historical turn tokens in memory.
- [environment.ts](sdk-helper/src/providers/environment.ts) builds each agent environment.
- [claude-profile.ts](sdk-helper/src/providers/claude-profile.ts) writes private Claude credentials and removes stale files.
- [claude.ts](sdk-helper/src/providers/claude.ts) and
  [claude-process.ts](sdk-helper/src/providers/claude-process.ts) start the pinned agent through the SDK.
- [codex.ts](sdk-helper/src/providers/codex.ts),
  [codex-settings.ts](sdk-helper/src/providers/codex-settings.ts), and
  [codex-credentials.ts](sdk-helper/src/providers/codex-credentials.ts) own Codex login and temporary storage.
- [lifetime.ts](sdk-helper/src/providers/lifetime.ts) removes credentials after child exit.
- [measure.ts](sdk-helper/src/measure.ts) uses developer logins for measurements.
