# cnd-credential

This crate supplies fresh GitHub credentials to Git and the GitHub CLI in a
Conductive cloud computer. Depend on it to compose the credential command
with injected settings, transport, and protocol streams.

## Responsibilities

- Request a fresh token from the Worker's machine endpoint.
- Keep the caller's turn ID when saved sandbox settings load.
- Write the token only as the requested credential output.
- Show only checked Worker refusal text or the fixed failure message.

## What This Crate Does

`Credential::execute("get")` reads Git credential fields. Only HTTPS access
to `github.com` gets a credential. Git needs a current turn. The `token`
mode reads no stdin and permits an empty turn for the GitHub CLI.
Other operations and hosts succeed without credentials or a request.

The executable supplies the `Environment` boundary through its shared
saved-settings reader. That reader loads `/run/ascii-secrets/env.sh` in a
child shell and reads the machine origin and `WORKSPACE_TOKEN`.
The credential policy reads `CONDUCTIVE_TURN_ID` from the caller before
it loads the file. A saved turn never replaces the caller's turn.

The native HTTP transport requires an HTTPS origin without credentials,
path, query, or fragment. It posts to `/v1/git/credential` with a bearer
token and the optional `X-Conductive-Turn-Id` header. It sends no body or
content type. It refuses redirects and uses a 30-second request timeout.
It saves no token. Errors never display transport details.

## Quick Start

Run from the repository root:

```sh
cargo run -p cnd-cli -- git-credential get <<'FIELDS'
protocol=https
host=github.com

FIELDS
```

The command needs installed sandbox settings and a current turn. It writes
`username=x-access-token`, the password field, and a blank line. The installed
`conductive-git-credential` alias runs the same command. Its `token` argument
writes only the token and a newline.

## Development

```sh
cargo test -p cnd-credential
cargo clippy -p cnd-credential --all-targets -- -D warnings
```

Unit tests mock settings, HTTP, and streams with unimock. Integration tests
use a local HTTPS server and a temporary certificate. No GitHub login is needed.

### Key Code

- [service.rs](src/service.rs): `Credential` and `CredentialService` own credential policy.
- [ports.rs](src/ports.rs): settings, HTTP, and protocol stream boundaries.
- [Shared settings](../cnd-cli/src/environment.rs): the executable's `NativeEnvironment` implements the settings boundary.
- [http.rs](src/http.rs): `NativeHttp` enforces the endpoint and transport rules.
- [streams.rs](src/streams.rs): native protocol input and output.

### Related Docs

- [GitHub access](../../image/github.md) describes installation and the GitHub CLI wrapper.
- [GitHub tokens](../../docs/protocol/github-tokens.md) states the access rules.
- [Architecture](../../docs/architecture.md) describes the system.
