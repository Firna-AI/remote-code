# Sandbox software

This page describes the app's own software in each sandbox: its programs
and parts, its releases and updates, its message types, and the software
image. It uses the terms of the
[architecture doc](../architecture.md#terms).
[Sandbox software](../protocol/sandbox-software.md) in the protocol docs
states the rules of the releases and the updates. A decision number names
a dated record, as [Decision numbers](../architecture.md#decision-numbers)
says. A sandbox software decision number, such as sandbox software
decision 3, names a decision of the change that makes the sandbox software
update itself.

## Programs

Every sandbox holds two programs of the app (sandbox software decision 3):

- `conductive`, one Rust program. Its subcommands run the agent runner,
  the preview relay, the agent tools, the git credential helper, and the
  updater. The runner runs as an always-on service. The relay listens on a
  private port.
- The SDK helper, a Node program. It runs the Claude Agent SDK and the
  Codex SDK for the runner, because these SDKs exist only in TypeScript
  and Python. The runner starts it as a child process. The two programs
  exchange JSON lines.

Reason: one program then holds one update path for each part. The preview
relay and the git credential helper need no npm package, so Node runs only
the SDK helper. Rust only later, a Rust installer only, and a Rust
installer with only the workspace CLI were rejected. A runner with no Node
was left out, because the stream protocol of the `claude` program is not a
published stable API.

The agent tools are an MCP server and a CLI. They manage the workspaces,
the sessions, the sections, and the port previews of the org, and they ask
for Mac commands. [Agent tools](../protocol/agent-tools.md) states their
calls. The git credential helper gets a fresh GitHub token for each git
operation.

The program also installs the other parts of the software:

- the SDK helper, with its private Node, its packages, and the agent
  programs
- the units of the runner and the preview relay
- the scripts and units of the terminal service, on a private port
- the wrapper of the GitHub CLI, and the Git setting of the credential
  helper
- a udev rule that stops disk flushes at each boot, as
  [Disk flushes](../protocol/workspaces-and-sandboxes.md#disk-flushes) says

The image build installs the system packages, such as the terminal
packages `ttyd` and `tmux`.

## Releases and updates

1. Each deploy from `main` builds the program as a static Linux program,
   and packages each other part (sandbox software decision 6).
2. The deploy writes the release files to the R2 bucket
   `conductive-runner`, which serves them at `runner.conductive.build`
   (sandbox software decision 4). It writes the JSON file of the newest
   release last.
3. In each sandbox, the updater reads that JSON file when the runner
   starts and every hour. It uses the `cli-updater` crate of
   `futex-ai/cli-release` (sandbox software decision 1).
4. The updater downloads a newer release in the background, with only the
   parts that changed. The next start of the runner applies it (sandbox
   software decision 5).
5. Each build of an org image or of the software image installs the newest
   release through the same program.

## Message types

Rust owns the messages between the runner, the SDK helper, the agent
tools, and the Worker (sandbox software decision 8). The TypeScript code
of the Worker and the apps uses the types that `ts-rs` generates from the
Rust types. Reason: one source then defines each message for both
languages. Hand-written Rust copies, TypeScript or runtime schemas as the
source, and a separate source for each boundary were rejected.

## The software image

The Worker builds one software image for each version of this software,
when the deploy run asks. The software image holds the base image and a
release of this software, and no org data. A build of an org without an
org image starts from it. That build then installs only the parts that a
newer release changed.

## Agents and ports

The SDK helper runs Claude through the Claude Agent SDK, with the agent
program that the SDK bundles at its own version. A pinned version guards
against a change in how the agent program reads its credential and its
model address. It runs Codex through the Codex SDK or the Codex App Server
(decision 36).

The runner finds the listening ports in the sandbox itself, with no Boat
call (decision 220).

The runner makes both agent programs send their model requests to the
[model gateway](../protocol/model-gateway.md). It gives each agent program
the turn token of its turn, and no agent login. A settings file in the
repository can send the requests of Claude to another address, as
[How the agents reach the gateway](../protocol/model-gateway.md#how-the-agents-reach-the-gateway)
says. A sandbox runs an older runner until an update applies, as
[Updates](../protocol/sandbox-software.md#updates) says. The workspace
refuses a runner of an unsupported protocol version, as
[Runner versions](../protocol/version-pins.md#runner-versions) says.

## Previews and commits

The preview relay forwards each preview request to a local port of the
sandbox. The previewed server then gets its local address as `Host`
(decision 218).
[Terminal, previews, and desktop](../protocol/terminal-previews-and-desktop.md#port-previews)
states the rules of the relay.

The Worker gives each sandbox the commit author of its workspace owner.
The agent runner gives each agent the commit author of the sender of its
turn. [Commit author](../protocol/github-tokens.md#commit-author) states
the rules.
