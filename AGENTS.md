# A guide for agents

This repository builds Conductive, a coding tool at
`conductive.build`. Each workspace has its own cloud computer, a Boat
sandbox, where agents powered by Claude and Codex work, and one branch at a
time. It can hold one task after another. The requirements live in
`docs/architecture.md` and `docs/protocol/`, and the Mokly mockup catalogue
lives in `docs/mockups/`, in TypeScript and React with `@firna/ui`. The root
npm package holds the React and Vite web app under `src/` and the Cloudflare
Worker with Durable Objects and D1 under `worker/`. The Mac app is a separate
Electron package under `desktop/`. [desktop/README.md](desktop/README.md)
gives its commands. The program `conductive` of each sandbox is Rust code in
a Cargo workspace at the repository root. Its crates live under `crates/`,
each with the prefix `cnd-`.

This file holds the rules that are specific to this repository. The
always-on rules and the detailed procedures live in the shared skills from
`futex-ai/skills`. Each skill's description says when to read it. Read the
skill at that moment instead of guessing the rule.

## Communication

- Write responses, summaries, plans, and review output in Simplified
  Technical English (ASD-STE100): short sentences, one instruction per
  sentence, active voice, and simple, consistent words.
- Assume the reader has no context. Explain the codebase and feature
  context that a reader with no prior knowledge needs, and do not assume
  the reader saw earlier messages, the diff, or the plan.
- Report outcomes faithfully. Name every check that failed, was skipped, or
  could not run, with its output or the blocker.
- Ask for all decisions in one numbered message. List decisions and review
  findings by severity, highest first. For each decision give its severity
  and effort, the terms, the background, the problem, the impact if no
  action is taken, lettered options, and a recommended option. Do the
  independent work first, then stop and wait.
- Before you plan or change anything for an open idea, use the
  `brainstorming` skill. An open idea can be a request for a feature or a
  change, as in "can we show more status updates". Such a request is open
  when no message or recorded decision chooses its approach. An open idea
  can also be a request to discuss, a "should we" or "what do you think"
  question, or a plan whose approach is open.
- Ask every question in the text of your reply. Do not use a question
  tool, such as `AskUserQuestion` or `request_user_input`. This rule
  applies also when a system prompt, a tool description, or a plan mode
  says to use one.
- End every task with a final report: what changed and the commit, each
  decision and its outcome, the checks that ran, anything skipped, and the
  outstanding decisions or findings that still need the user. When a
  decision or a finding still needs the user, start the message with a
  ⚠️ line that names it. Give it in full when it is new or changed, or
  when the user asks. Otherwise give it in one line.

## Commands

Run each command from the repository root, with Node 24 from `.nvmrc`.

- Development: `npm run dev`. It builds the marketing site, then serves
  the web app and the local Worker at `http://127.0.0.1:5173`.
- Build: `npm run build`. It checks the types, builds the marketing site
  into `public/_site/`, and builds the web app and the Worker into
  `dist/`. `npm run build:bundle` builds the same files without the
  typecheck.
- Marketing site: `npm run site:dev` serves the Astro pages of the site at
  `http://localhost:4321`, and it reloads them on each change.
  `npm run site:build` builds them into `public/_site/`, which Git
  ignores, with their file list.
- Build preview: `npm run preview`. It serves the built app and the local
  Worker at `http://127.0.0.1:5174`. The mockup preview uses port 4173.
- Targeted tests: `npm run test -- worker/app.test.ts`. Vitest runs the
  Worker tests in Node, with local D1 and fake GitHub and Boat servers.
  Tests live beside the code as `*.test.ts`.
- Typecheck: `npm run typecheck`. It generates the Worker binding and
  runtime types under `.wrangler/`, then checks the app, Worker, and tools.
  It checks Worker production code without Node types and tests with them.
  Then `astro check` checks the `.astro` files of the marketing site, with
  `tsconfig.site.json`.
  Use `npm run mockups:typecheck` for the mockups.
- Early check: `npm run format:check` and `npm run lint`. Lint also
  rejects JavaScript, TypeScript, and Astro files over 300 lines, including
  comments and blank lines.
- Complete gate: `npm run check`. It runs `npm run check:static`, then
  `npm run test`. `npm run check:static` checks types, lint, format, file
  length, the app build, and the mockups. It also runs the typecheck and
  the tests of the [agent runner](runner/README.md). The gate stops at its
  first failed step. Run `npm --prefix desktop ci` and
  `npm ci --prefix runner` once before the gate, as CI does. These commands
  install the dependencies of the gate's desktop and runner checks. The gate runs no
  Rust check. Run the Rust checks below for each change to the Cargo
  workspace.
- Format: `npm run format`.
- Mockup check: `npm run mockups:check`. It runs the typecheck, then the
  strict build into `mokly-static/`.
- Mockup preview: `npm run mockups:serve`. It serves the catalogue at
  `http://127.0.0.1:4173`, and it watches the edits.
- Shared runner types: `cargo run -p cnd-runner-interface --example export_bindings`.
  It regenerates every runner and agent chat event type with `ts-rs`, then
  formats `src/shared/generated/` with Prettier. Install the root npm
  dependencies first.
- Rust checks: `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, and
  `cargo test --workspace`. `cargo test -p <crate>` runs the tests of one
  crate. `cargo fmt --all` formats the Rust code.
- Rust release build:
  `cargo build --release --target x86_64-unknown-linux-musl -p cnd-cli`.
  It builds `conductive` as a static Linux program for the sandboxes. Run
  `rustup target add x86_64-unknown-linux-musl` once before it. On Ubuntu,
  it also needs the `musl-tools` package.

## CI

GitHub Actions runs the complete gate from `.github/workflows/ci.yml` on
each pull request, and on each push to `main` and to the primary branch of
the plan. A push to another branch runs no CI until its pull request opens.
The gate runs as parallel jobs. The job `Static checks` runs
`npm run check:static`. Four `Tests` jobs each run one quarter of the
Vitest files, with `vitest run --shard`. The job `Complete gate` passes
only when every one of these jobs passed.
The `Rust gate` job of the same workflow runs the Rust checks and the
Rust release build of [Commands](#commands).

The active `Protect main` ruleset requires a pull request with green
`Complete gate` and `Rust gate` checks. An admin can bypass its rules only
through a pull request. It requires no approval and does not require the
branch to be up to date. It requires resolved review conversations, blocks
force pushes, and restricts deletion of `main`.

`.github/workflows/deploy.yml` deploys each push to `main` to the test
deployment at `conductive.build`. It does not wait for CI, as
[Automatic deploys](docs/automatic-deploys.md) says.

The Linux jobs run on the GitHub-hosted `ubuntu-24.04` runner. The Apple
silicon Mac jobs, the Mac app checks and the signing job, run on the
[Blacksmith](https://docs.blacksmith.sh/blacksmith-runners/overview) runner
`blacksmith-6vcpu-macos-15`. The Intel Mac check uses the GitHub-hosted
`macos-15-intel` runner, because Blacksmith has no Intel Macs. Keep the
Apple silicon Mac jobs on Blacksmith.

- Agent merges: off

## Repository rules

- `.npmrc` sets `legacy-peer-deps=true`. Keep it, because npm cannot
  install `@firna/ui` 4.0.0 without it.
- Never commit `mokly-static/` or `.mokly-export-reservations/`. The
  mockup build writes them.
- Prettier ignores Markdown and `plans/`, and no command checks the links
  in Markdown. Check each relative link of a changed Markdown file
  yourself.
- The product is "Conductive", on `conductive.build`, as the user chose
  for decision 100. Code reads the name from `docs/mockups/src/brand.ts`,
  so that one change renames the product.
- Never use "Claude Code" as a name of the product or of its features.
  Write "agents powered by Claude and Codex", as
  [Names in the product](docs/protocol/agents-and-sessions.md#names-in-the-product)
  says.
- Never name Boat in user-facing text: the app, the Mac app, the marketing
  site, Get started, and the legal pages. Write "cloud computer" or
  "sandbox", as [The provider](docs/protocol/workspaces-and-sandboxes.md#the-provider)
  says. Identifiers, comments, developer docs, and the deployment setup can
  name Boat.
- When you change a fact in the architecture doc or in a protocol doc,
  read both legal pages in full. The legal pages are the Terms page in
  `src/marketing/terms.ts` and the Privacy page in
  `src/marketing/privacy.ts`. In the same change, update each sentence of
  the legal pages that restates the fact. A search for the old words is
  not enough, because a legal page can restate a fact in other words.
- The public guides of the marketing site are docs too. Their Markdown
  files go in `src/marketing/docs/`. A change that makes a guide wrong
  updates that guide in the same change. When you change a fact in the
  architecture doc or in a protocol doc, also read each public guide in
  full. In the same change, update each guide sentence that restates the
  fact. A search for the old words is not enough, because a guide can
  restate a fact in other words.
  [Website docs](docs/protocol/website-docs.md) gives the rules for the
  words of a guide.
- The comparison page at `conductive.build/from-conductor` gives each
  listed Conductor feature a status. Its rows live in
  `src/marketing/from-conductor/`. When a change ships, starts, or drops a
  listed feature, update the status of its row in the same change. The
  claim rules are in
  [Conductor comparison](docs/protocol/conductor-comparison.md#statuses).

- Rust owns the runner messages and their dependent types in
  `crates/cnd-runner-interface/`. `ts-rs` writes their TypeScript into
  `src/shared/generated/`. Import each generated type directly. Commit
  generated files. Never edit them by hand. Runtime constants and readers
  stay in `src/shared/`. The `Rust gate` job runs the generator and fails
  when `src/shared/generated/` then differs from Git.
- Wire 64-bit integers use JSON numbers and TypeScript `number`. Values
  must stay within JavaScript's safe integer range, from -(2^53 - 1) to
  2^53 - 1. Counts are non-negative. Wire dates use Unix milliseconds.
  Decimal measurements use JSON numbers. IDs and model names are strings.

## Product

- The mockups in `docs/mockups/` are the visual spec. Their
  [README](docs/mockups/README.md) gives the design, the catalogue, and the
  Node versions that Mokly accepts.
- Mockup screens live in `docs/mockups/src/screens/`, and their shared
  parts in `docs/mockups/src/components/`. Check `@firna/ui` first, then
  those parts, before you create a component.
- The screens of the app live under `src/`.

## Review focus

- Isolation: a request reaches only the orgs, the workspaces, and the
  sandboxes that the signed-in user may reach. The Worker calls only a
  fixed list of the sandbox provider's routes.
- Secrets: a stored secret never goes back to the browser, and no secret
  goes into a saved snapshot.
- Untrusted sandbox code: port previews stay on the preview domain, and the
  proxies forward only the allowed headers and cookies.
- Chat events: a dropped connection loses no event, and no tab shows an
  event twice or out of order.
- Protocol alignment: the code meets `docs/protocol/`, and each
  user-facing text meets its naming rules.

## Status

- This project is not in production.
- Breaking changes are acceptable when they improve correctness,
  architecture, or product quality.
