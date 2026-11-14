# Codex logins

This page gives the Codex settings and start sequence of the
[agent runner](README.md). [Agent logins](agent-logins.md) gives the shared
credential and environment rules. The
[model gateway protocol](../docs/protocol/model-gateway.md) states the requirements.

The runner starts `codex app-server` from the `@openai/codex` package that
`@openai/codex-sdk` installs. `sdk-helper/package.json` pins version 0.167.0.
Check both routes again at each update of the pinned program.

## Conversation continuation

Both login kinds use the shared conversation storage. The runner first sends
`thread/resume` for a saved conversation. If its JSON-RPC error has
`data.type=modelProviderMismatch` or `data.type=modelProviderNotConfigured`,
the runner sends one `thread/fork` for the same thread ID.
The fork uses the current provider, model, working folder, developer
instructions, approval policy, and sandbox. It uses no rollout path or
supplied history. Every other resume error keeps its failure.

The runner sends the fork's ID through its existing `conversation` event.
Its session store replaces the old ID, so later turns resume the fork,
also after a runner restart. A refused fork closes the App Server and fails
the turn. [Agents and sessions](../docs/protocol/agents-and-sessions.md#agents)
states the conversation continuity requirement.

## API key

- The App Server gets no login or turn token in its environment or arguments.
- The `conductive` model provider has the gateway address as `base_url`.
  It has `requires_openai_auth=true` and no `env_key`.
- The credential store is `ephemeral`, so Codex keeps the token in memory.
- After `initialize`, the runner sends `account/login/start` with type
  `apiKey` and the turn token on standard input.
- A successful login opens `thread/start`, or `thread/resume` for a saved
  conversation. A refused or canceled login closes the App Server.

## ChatGPT sign-in

- The Worker alone runs the device code sign-in and renews its tokens.
  The sandbox gets only a turn token and public account identity.
- The runner uses the built-in `openai` provider for the kind `token`.
  It sends no `account/login/start` request and adds no credential variable.
- Before starting Codex, the runner writes `auth.json` in a private session
  home. The file has mode 0600. The home has mode 0700.
- The home name is `session-` and the SHA-256 hash of the session ID, under
  `<home>/.conductive/codex/session-homes`. Each session keeps its home.
- The file selects `auth_mode=chatgpt`. Its `tokens.access_token` holds
  only the turn token. Its refresh token is an unusable placeholder.
- Its ID token is a synthetic JWT. It holds only the email and the
  namespaced ChatGPT account ID, plan type, and user ID from the command.
  Pinned Codex decodes these claims without checking the signature.
- `tokens.account_id` repeats the account ID. `last_refresh` is a future
  marker, `9999-12-31T23:59:59Z`. The turn token has no JWT expiry.
  These fields prevent proactive renewal by pinned Codex.
- `CODEX_HOME` selects this home, and `cli_auth_credentials_store=file`
  lets Codex read the file. No real sign-in enters the sandbox.
- `chatgpt_base_url` is the gateway base followed by `/backend-api`.
  `openai_base_url` is that address followed by `/codex`.
- The runner disables request compression with
  `features.enable_request_compression=false`.
- The session home's `sessions` and `archived_sessions` directories link to
  the existing shared Codex storage. `sqlite_home` selects that storage too.
  Either login kind can read a saved conversation for a resume or a fork.
- After initialization, `account/read` loads the workspace identity and routing.
  Then `configRequirements/read` checks `requirements.chatgptBaseUrl`.
- A required address outside the gateway closes the App Server and fails
  the turn with a cause. The pinned program accepts this requirement only
  from local managed requirements. It ignores that field in cloud rules.
- Codex reads the workspace rules, account check, and model list through
  the gateway. The Worker follows routing and hides routed origins.
- The gateway refuses the first WebSocket attempt. Codex falls back to
  HTTP streaming without zstd request compression.
- The gateway sends no 401 on the four ChatGPT routes, so Codex never uses
  the placeholder refresh token.
- After the retryable 502 of `POST /backend-api/codex/responses`, pinned
  Codex must send the request again. Each pin update checks that resend.
  [How the agents reach the gateway](../docs/protocol/model-gateway.md#how-the-agents-reach-the-gateway)
  gives the gateway recovery rule.
- Closing or stopping the process removes its `auth.json` after exit.
  Failed setup and canceled file writes use the same removal path.
  Before its first connection, the runner removes stale login files and
  interrupted `.auth-` replacement files. Reconnects keep active files.
- The home and its conversation data stay after removal. A sandbox process
  can read the turn token on purpose while the turn runs.

## Tests

- `sdk-helper/src/providers/codex-resume.test.ts` checks the two provider refusals,
  the fork's settings and thread ID, and the errors that still fail.
- `sdk-helper/src/providers/rpc.test.ts` checks the JSON-RPC error data and message.
- [Rust lifecycle tests](../crates/cnd-runner/tests/engine/lifecycle_tests.rs) checks replacement and restart of a
  session's saved conversation ID.
- `sdk-helper/src/providers/codex-login.test.ts` checks private login order and failures,
  the API key gateway settings, and the native measurement route.
- [Rust command tests](../crates/cnd-runner/src/json/_tests_/command_tests.rs) checks the public ChatGPT account fields.
- `sdk-helper/src/providers/codex-token.test.ts` checks the login file, the gateway
  settings, start and resume, and a conflicting address rule.
- `sdk-helper/src/providers/codex-credentials.test.ts` checks file permissions,
  session isolation, conversation storage, and startup removal.
- `sdk-helper/src/providers/codex-token-lifecycle.test.ts` checks removal after failure,
  Stop, abort, and canceled file preparation.
- [Rust filter tests](../crates/cnd-runner/src/filter/_tests_/filter_tests.rs) checks a turn token split across output.
  The token stays out of sent events and saved runner state.
- These tests use fake credentials and a fake App Server. They establish
  neither real-token authentication nor the behavior of the pinned program.
