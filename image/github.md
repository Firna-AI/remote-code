# GitHub access

This guide belongs to the [sandbox software](README.md).

## Commit author

At each create and resume, the startup command writes the workspace
owner's commit author to the Git system settings, `/etc/gitconfig`, as
`author.name`, `author.email`, `committer.name`, and `committer.email`.
This includes a disk retention restart. Git uses this author outside an
agent turn, such as in the terminal and in the startup script. These keys
win over a `user.name` and a `user.email` that a script writes into a
repository.

In an agent turn, the runner gives each agent process `GIT_AUTHOR_NAME`,
`GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` with
the turn sender's author. These variables take precedence over all Git
settings. The sandbox variables do not hold them, so a login shell that
loads the sandbox variables again keeps them.
[Commit author](../docs/protocol/github-tokens.md#commit-author) states the
name and email rules.

## Git credential helper

The release installer links `/usr/local/bin/conductive-git-credential` to
`/opt/conductive/current/conductive`. This executable name selects
`conductive git-credential`. The Rust helper keeps the caller's
`CONDUCTIVE_TURN_ID` and loads the saved machine origin and workspace token
from `/run/ascii-secrets/env.sh` in a child shell.

- In Git credential mode, the helper answers only a `get` request for `https` on `github.com`. It
  ignores every other request.
- It posts to the git credential route, `/v1/git/credential`, at
  `CONDUCTIVE_MACHINE_ORIGIN`, with the workspace token as a bearer token. It sends the turn ID in the
  `X-Conductive-Turn-Id` header. It sends no request body. It refuses
  redirects, and it stops after 30 seconds.
- It gives git the token as the password of the user `x-access-token`.
- The Worker returns a fresh GitHub user token of the sender of that turn.
  The helper saves nothing, so each git operation asks again.
- In Git credential mode without a turn ID, the helper writes that Git
  gets GitHub access in an agent turn, and it sends no request.
- When the Worker refuses, the helper writes the Worker's error message.
  It writes it only when it is one line of at most 300 characters with no
  control or format characters.
- Any other failure writes "GitHub access failed. Try again." Git then
  gets no credential from the helper.

The Worker serves that route on the machine hostname, as the
[lifecycle README](../worker/lifecycle/README.md#machine-route) says.

### GitHub CLI

The release installer links `github-cli.sh` as `/usr/local/bin/gh`.
The image build installs the `gh` package.
The wrapper asks `conductive-git-credential token` for a fresh token.
That mode reads no stdin and returns only the token.
The wrapper sets `GH_TOKEN` for `/usr/bin/gh`, then replaces itself with that program.
Arguments, stdin, signals, and exit status pass through.
An explicit `GH_TOKEN` or `GITHUB_TOKEN` takes precedence.
The wrapper classifies help, version, and completion before it requests a token.
The first-argument forms pass through without a credential request.
A lone `-h` does too.
A later `--help` passes through only before `--`, after a non-flag argument
or an argument with `=`.
Other forms keep their credential request because the flag can be a value.
This preserves `--title --help` and the hostname flag `-h`.
Extension execution and dynamic completion keep their credential requests.

With a turn ID, the Worker returns that turn sender's token.
Without a turn ID, it returns the workspace owner's token.
An invalid or ended turn gets no token.
[GitHub tokens](../docs/protocol/github-tokens.md) states the access rules.
The wrapper saves no token and changes no shell profile or login file.

A release update installs the wrapper. A workspace downloads updates in
the background and applies them at a later start, as
[Release updates](README.md#release-updates) describes.

### GitHub App permissions

Automatic authentication uses the permissions of the Conductive Build GitHub App.
The App requests Issues read and write for issue commands.
Private issue listing needs the Issues repository permission with read access.
Creating or changing issues needs write access.
The app owner must change this setting on GitHub.
Each affected installation must approve an added permission before it takes effect.
The wrapper cannot grant a permission that the GitHub App does not have.
See GitHub's [issue permissions](https://docs.github.com/en/rest/issues/issues#list-repository-issues)
and [permission update steps](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app).

## Development

Run `cargo test -p cnd-credential` from the repository root.
The tests check Git output, token mode, turn context, ignored operations,
safe refusal text, and a real local HTTPS request with no body.
They also check redirect refusal and invalid machine origins.
The [credential crate](../crates/cnd-credential/README.md) gives its boundaries.

Run the GitHub CLI wrapper tests with
`npm run test -- worker/lifecycle/github-cli.test.ts`.
They check token delivery, stdin, arguments, exit status, and safe failures.

The [GitHub CLI environment reference](https://cli.github.com/manual/gh_help_environment)
describes the token variables that the wrapper supplies.
