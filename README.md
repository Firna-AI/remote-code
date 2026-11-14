# Conductive

Conductive is a coding tool at `conductive.build`, in the browser and in a
Mac app. Each workspace has its own cloud computer, where agents powered by
Claude and Codex work, and one branch at a time. It can hold one task after
another. The agents run only in the cloud. It replaces Conductor Cloud,
which shuts down on 20 November 2026.

## Status

Today the repository holds:

- the [architecture doc](docs/architecture.md) and the
  [protocol docs](docs/architecture/protocol-docs.md), which state the
  requirements
- the [mockup catalogue](docs/mockups/README.md), which draws every screen
  at phone and desktop sizes
- the app package, with tests against fake GitHub and Boat servers and
  local D1 storage, and the complete gate, which GitHub Actions runs
- the Mac app in `desktop/`, with signed packages and update support, as
  [Mac app](#mac-app) says

A test deployment runs at `conductive.build`. Each push to `main` deploys
it, as [Automatic deploys](docs/automatic-deploys.md) says. The project is
not in production yet. [Deployment inputs](docs/deployment.md) lists what a
deployment needs.

## Features

Conductive has these features. The protocol docs state each one. A
feature that is not complete yet says so.

- Sign in with GitHub. The product is free, with no plans or billing, as
  [Orgs and members](docs/protocol/orgs-and-members.md#orgs) says.
- A waitlist. A new account waits until an operator approves it, or an
  invite code, a referral code, or an org invitation lets the person in.
  An operator can turn the waitlist off. Each new person then gets in at
  once, unless sign-ups are paused.
- Every cloud computer runs in the app's own Boat account, so users need no
  Boat account.
- A new workspace starts as an empty chat. The first message creates it,
  with its own cloud computer and branch.
- Chat with agents powered by Claude and Codex. A workspace holds several
  sessions, and one picker sets the model and the effort.
- Send a message during a turn, or stop the turn.
- Attach files of up to 100 MB each to a message.
- Each user connects a Claude subscription token, a ChatGPT plan through
  device code sign-in, an API key, or an own endpoint in Account or Get started.
- Files and Changes, a terminal, and port previews. The live desktop is
  hidden for now, as [Desktop](docs/protocol/workspace-tools.md#desktop)
  says.
- A pull request bar with the GitHub state of the branch and its checks.
  It sends the agent fixed requests, such as Create PR and Fix
  checks, and merges as the member. After the merge, Continue moves the
  workspace to a new branch, with the same cloud computer and sessions.
- One prepared cloud computer image for each org, built from an install
  script, with a startup script and env vars.
- Agents can create workspaces and sessions. They can read chats and
  message sessions across the org.
- Routines run a saved prompt on a schedule or on a pull request event,
  each time in a new workspace.
- Each workspace has a number, such as `W-395`. A press on the number in
  the header copies the link of the workspace. A workspace link in chat
  shows as a chip with the number and the name.
- Orgs with members, sections, reassignment, Archive, and Delete org.
- A menu on a workspace row moves, reassigns, renames, or archives the
  workspace.
- A command palette, on ⌘K or Ctrl+K, finds the workspaces of the org,
  runs the actions of the page, and opens the settings.
- Keyboard shortcuts, which each person can change on the Account page.
- Send feedback from the command palette, with screenshots. The team gets
  each message by email, and replies to the primary verified GitHub email.
- The web app works on phones and on desktops.
- A Mac app for macOS, with the native window buttons in its own top bar.
  An agent can ask to run a command on the Mac of the person who sent its
  turn. Published packages update themselves from GitHub releases.

## What a user needs

- a GitHub account
- at least one agent login:
  - for Claude, a Claude subscription token, an Anthropic API key, or an
    own endpoint that serves the Anthropic Messages API
  - for Codex, a ChatGPT plan with device code sign-in enabled, an OpenAI
    API key, or an own endpoint that serves the OpenAI Responses API

An own endpoint is a gateway or a proxy that the user chose, with its key.
[Own endpoint logins](docs/protocol/own-endpoint-logins.md)
states its address rule and its other rules.

## Get started

The [Run it](src/app/README.md#run-it) section of the web app README says
how the app runs in development and in the production build.

1. Install Node 24, as `.nvmrc` says. The
   [mockups README](docs/mockups/README.md#commands) lists the Node
   versions that Mokly refuses.
2. Run `npm install`. The `.npmrc` file sets `legacy-peer-deps`, which
   `@firna/ui` needs. Then run `npm --prefix desktop ci` for the Mac shell's
   check dependencies. Run `npm ci --prefix runner` for the check
   dependencies of the [agent runner](runner/README.md).
3. Run `npm run db:migrate` to create the local D1 tables.
4. Run `npm run dev`, and open `http://127.0.0.1:5173`.
5. Open `http://127.0.0.1:5173/api/health` to check the Worker. It returns
   `{"status":"ok"}`.
6. Run `npm run check` before you submit a change.

Local development needs no Cloudflare account. Wrangler provides local D1,
R2, and Durable Object storage under `.wrangler/`. The D1 ID and the R2
bucket name in `wrangler.jsonc` name the production database and bucket.
Local commands, such as `npm run db:migrate` and `npm run dev`, use only
the local storage.

This local setup creates no Cloudflare resources and deploys nothing. Put
local secrets in `.dev.vars`, which Git ignores.

The app origin is the scheme, host, and port of the web app. A deployed
Worker reads it from `APP_ORIGIN`, which `wrangler.jsonc` does not set.
`npm run dev` and `npm run preview` do not need `APP_ORIGIN`. An HTTP
request to `localhost`, `127.0.0.1`, or `[::1]` uses its own origin as the
app origin. An `APP_ORIGIN` value in `.dev.vars` does not change this. So
the app origin is `http://127.0.0.1:5173` in `npm run dev`, and
`http://127.0.0.1:5174` in `npm run preview`.

Host routing, the `Origin` check, the content policy, and GitHub sign-in use
the app origin of each request. The development page has the same content
policy as the built app. That policy allows no inline script. So, in
`npm run dev` only, a plugin in `vite.config.ts` moves each inline script of
the page into an external script file.

GitHub sign-in needs these values in `.dev.vars`:

| Name | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | The GitHub App's client ID |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret |
| `SESSION_SIGNING_KEY` | 32 random bytes, encoded as Base64 |
| `BOAT_KEY_ENCRYPTION_KEY` | A separate 32 random bytes, encoded as Base64. It encrypts the stored secrets, such as the agent logins and the workspace tokens. |

In a deployment, the client secret and both keys are Worker secrets, as
[Deployment inputs](docs/deployment.md#secrets) says. Open `/api/auth/github` to start sign-in. GitHub then returns to
`/api/auth/github/callback` on the same app origin. The GitHub App must
accept that callback address, for example
`http://127.0.0.1:5174/api/auth/github/callback` for `npm run preview`. The
GitHub App is "Conductive Build", with the slug `conductive-build`, in the
Firna-AI organization. It sends its webhooks to the address in
[The GitHub App](docs/protocol/github-banner.md#the-github-app).
[The GitHub App](docs/deployment.md#the-github-app) in the deployment guide
gives each setting of the GitHub App, with the address where GitHub returns
the user after an install.
Automated tests use fakes and need no credentials.

Every cloud computer of every org runs in the app's own Boat organization.
That organization holds only the app's sandboxes and saved snapshots, and
no other Boat work. The Worker needs two values to start cloud computers:

| Name | Value |
| --- | --- |
| `BOAT_API_KEY` | An API key for the app's Boat organization, and the only Boat credential. It is a secret. |
| `BOAT_ORG_ID` | The ID of the app's Boat organization. It is not a secret. The Worker names it on every Boat call. |

[The app's Boat account](worker/sandbox/README.md#the-apps-boat-account)
says how to make the key. Put both values in `.dev.vars` to start real cloud
computers in local development. In a deployment, `BOAT_API_KEY` is a
Worker secret, and `BOAT_ORG_ID` is a variable in the settings of the
Worker, as [Deployment inputs](docs/deployment.md#how-to-set-the-inputs)
says.
[Access and security](docs/protocol/isolation.md#the-apps-boat-key)
states how the Worker keeps them away from the browser and the sandboxes.

`wrangler.jsonc` also sets the production values: `MACHINE_ORIGIN` is
`https://api.conductive.build`, and `PREVIEW_DOMAIN` is `conductive.page`.
It sets `CONDUCTIVE_TITLE_MODEL` for automatic workspace names, as
[The title model](docs/deployment.md#the-title-model) says.
It also holds the model list and the app default in `CONDUCTIVE_MODELS`
and `CONDUCTIVE_DEFAULT_CHOICE`. Edit these values in the repository.
The next deploy publishes them, as [Models](docs/deployment.md#models) says.
A value in `.dev.vars` replaces the corresponding production value locally.
When `.dev.vars` sets `MACHINE_ORIGIN` or `MARKETING_ORIGIN` to a local address,
requests to that address keep that role. The
[marketing README](src/marketing/README.md#development) uses this to preview
the built site through the Worker. For `npm run preview`, set
`MARKETING_ORIGIN=http://localhost:5174` and
`APP_ORIGIN=http://127.0.0.1:5174` in `.dev.vars`. Run `npm run build`
before `npm run preview`. Open `http://localhost:5174` for the site and
`http://127.0.0.1:5174` for the app. The Worker fills sign-in links from
`APP_ORIGIN` and serves Astro's built pages with their security headers.

Worker types come from `wrangler.jsonc`. The type check generates them
under `.wrangler/`, which Git also ignores.

| Command                     | What it does                                                   |
| --------------------------- | -------------------------------------------------------------- |
| `npm run dev`               | Build the marketing site, then serve the web app and the local Worker |
| `npm run build`             | Check types, build the marketing site into `public/_site/`, then build the web app and Worker into `dist/` |
| `npm run preview`           | Serve the built app and local Worker at port 5174              |
| `npm run typecheck`         | Generate types and check app, tools, Worker production, Worker tests, and the Astro files of the marketing site |
| `npm run test`              | Run the Vitest tests                                           |
| `npm run db:migrate`        | Apply the D1 migrations to local storage                       |
| `npm run site:dev`          | Serve the marketing site from Astro at `http://localhost:4321`, and reload on edits |
| `npm run site:build`        | Build the marketing site into `public/_site/`, with its file list |
| `npm run check`             | Run every check: `npm run check:static`, then the Vitest tests |
| `npm run check:static`      | Run every check except the root Vitest tests, including the app build, the mockup checks, and the runner checks |
| `npm run mockups:serve`     | Serve the catalogue at `http://127.0.0.1:4173`, and watch edits |
| `npm run mockups:check`     | Check mockup types, then build the catalogue in strict mode     |
| `npm run lint`              | Run ESLint, including the 300-line limit of JavaScript, TypeScript, and Astro files |
| `npm run format:check`      | Check formatting with Prettier                                 |
| `npm run format`            | Format the files with Prettier                                 |

The program `conductive` of each sandbox is Rust code in a Cargo workspace
at the repository root. Its crates live under `crates/`, each with the
prefix `cnd-`. Install Rust with `rustup`. Run these commands from the
repository root before you submit a change to the Cargo workspace:

| Command | What it does |
| --- | --- |
| `cargo fmt --all -- --check` | Check the format of the Rust code |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lint the Rust code, and fail on each warning |
| `cargo test --workspace` | Run the Rust tests |
| `cargo build --release --target x86_64-unknown-linux-musl -p cnd-cli` | Build `conductive` as a static Linux program for the sandboxes |

The release build needs the target that
`rustup target add x86_64-unknown-linux-musl` adds. On Ubuntu, it also
needs the `musl-tools` package. `npm run check` runs no Rust command.

GitHub Actions uses `.nvmrc`. It installs with `npm ci`,
`npm --prefix desktop ci`, and `npm ci --prefix runner`. Then it runs
the complete gate on pull requests, and on pushes to `main` and to the
primary branch of the plan. One job runs `npm run check:static`. Four jobs
each run one quarter of the Vitest files at the same time. The job
`Complete gate` passes only when all of them pass. A separate `Rust gate`
job runs the four Rust commands above. A pull request into `main` needs
both `Complete gate` and `Rust gate` to pass. CI does not deploy, as
[Automatic deploys](docs/automatic-deploys.md) says.

## Mac app

The Mac app is an Electron shell for macOS, on Apple silicon and Intel
Macs. It bundles the built web app, shows it in its own window, and calls
the same Worker. The agents still run only in the cloud. The shell has these
features:

- It shows the shared web app screens. The window has no title bar of its
  own. The native window buttons sit at the top left of the app's left
  panel. The sidebar toggle, Back, and Forward share that bar. The top bars
  move the window, and their controls do not. Full screen gives back the
  space of the window buttons.
- The Worker routes the browser-to-app GitHub sign-in handoff. The Mac
  workflow builds and tests desktop changes on Apple silicon and Intel.
- Pull request and local builds have an ad-hoc signature. Release builds
  have a Developer ID signature, and Apple notarizes them.
- Each merge of the release pull request publishes a GitHub release of
  this repository with the signed Mac app. The published builds update
  themselves from later releases.

[Mac app](docs/protocol/desktop-app.md) states the requirements.
[desktop/README.md](desktop/README.md) gives the commands, and
[desktop/RELEASES.md](desktop/RELEASES.md#releases) gives the release steps.

## Key code

[Key code](docs/key-code.md) lists the entry points of the app, Worker, and mockups.

## Docs

- [Architecture](docs/architecture.md): the
  [components](docs/architecture/components.md), the hostnames, the
  [flows](docs/architecture/flows.md), the
  [marketing site](docs/architecture/marketing-site.md), the
  [data and trust boundaries](docs/architecture/data-and-trust.md), and the
  terms.
- [Protocol docs](docs/architecture/protocol-docs.md), which state the
  requirements. That page of the architecture docs lists each one, with
  what it covers.
- [Mockups](docs/mockups/README.md): the design and the catalogue.
- [Third-party notices](THIRD_PARTY_NOTICES.md): licenses for copied icons
  and the bundled font.
- [AGENTS.md](AGENTS.md): the rules for agents in this repository.
