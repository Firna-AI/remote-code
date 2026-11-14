# Developer scripts

These scripts of the [sandbox software](README.md) run on a developer
machine. The deploy workflow also runs the packager. No image build
installs them.

- `package-system.sh` packages the system part.
- `live-check.mjs` checks chat in a real sandbox and times the first agent start.

Run commands from the repository root with Node 24. Run `npm ci --prefix runner`
first. It installs the SDK helper packages and the live-check developer packages.

## Package a release

Run `bash image/package-system.sh .context/release-input` to make the system
archive. Run `node runner/sdk-helper/scripts/package.mjs .context/release-input`
to make the SDK helper archive. Both print the archive digest.
The [release crate](../crates/cnd-release/README.md#quick-start) gives the
parts-list and executable packaging commands. Use `node`, `system`, and
`sdk-helper` as the three parts. The
[deploy guide](../docs/deployment/runner-archive.md#the-release-in-each-deploy)
gives their public paths and publication order.

## Live check

`live-check.mjs` bundles the TypeScript check into
`.context/chat-live-check/cli.mjs`, with the esbuild of the SDK helper
packages. Then it runs that file.

```sh
npm --prefix runner/sdk-helper run build
node image/live-check.mjs --help
node image/live-check.mjs --prepare
node image/live-check.mjs
```

- `--help` lists the variables.
- `--prepare` checks that esbuild can bundle the check, and that the SDK helper
  bundles are in `dist/sdk-helper/`. It uses no app, no sandbox, and no agent.
- Without an option, the script runs the real check. It reads its inputs
  and its secrets from the environment. Put no secret in a saved command
  or file.

### What a real check needs

- An externally reachable test Worker, with its app and machine origins,
  and the inputs of [Deployment inputs](../docs/deployment.md). Each
  sandbox must reach the machine origin.
- A signed-in test account with a stored agent login for `LIVE_AGENT`.
- An org with a published org image that contains the release under test.
  The check makes no image.
- A repository of that org that the image holds.

Build computer on the Cloud computer tab starts an org build, as
[The org image](../docs/protocol/org-image.md#the-org-image) says.
Publish the Conductive release from the same commit as the test Worker.
The image records the Worker runner protocol version. A workspace refuses
a runner of another protocol version, as
[Runner versions](../docs/protocol/version-pins.md#runner-versions) says.

The check does not read the runner version of the image. The agents send
the model requests of the chat steps through the
[model gateway](../docs/protocol/model-gateway.md) of the test Worker. The
gateway adds the login that the app stored for the account. A build or refresh installs the newest release. Ensure that the test image
and Worker use compatible protocol versions.

### Variables

These variables are required:

| Variable | Value |
| --- | --- |
| `LIVE_APP_ORIGIN` | The app origin of the test Worker. |
| `LIVE_MACHINE_ORIGIN` | The `MACHINE_ORIGIN` of the test Worker. Each sandbox must reach it. The runner URL that the check makes from the saved machine origin of the sandbox must match it. |
| `LIVE_COOKIE` | The full `Cookie` header of a signed-in session of the test account. |
| `LIVE_ORG_ID` | The app ID of the org. |
| `LIVE_REPOSITORY_ID` | The app ID of a repository that the org image holds. |
| `LIVE_BOAT_KEY` | A Boat key of the app's Boat organization. |
| `LIVE_BOAT_ORG` | The ID of that organization: the `BOAT_ORG_ID` of the test Worker. |
| `LIVE_AGENT` | `claude` or `codex`. |
| `LIVE_MODEL` | A model of that agent. |
| `LIVE_AGENT_LOGIN` | A login of that agent, only for the measurement forks. Their model requests go straight to the provider, not through the gateway. The app uses the login that it stored for the account. |

These variables are optional:

| Variable | Value |
| --- | --- |
| `LIVE_AGENT_LOGIN_KIND` | `api-key`, the default, or `token` for Claude. |
| `LIVE_RUNS` | The number of resumes of each placement. The default and the minimum are 3. |
| `LIVE_OUTPUT` | The output folder. It must be under `.context/`. The default is `.context/chat-live-check/run-<time>`, with the start time in milliseconds. |
| `LIVE_SOFTWARE_DIR` | The software folder in the sandbox. The default is `/opt/conductive/current`. |
| `LIVE_BOAT_API` | The Boat API. The default is `https://boat.dev/api/v1`. Only an HTTP endpoint on `localhost`, `127.0.0.1`, or `[::1]` can replace it. |

Both origins must have no path, query, fragment, or credentials. Each
origin must use HTTPS, or HTTP on `localhost`, `127.0.0.1`, or `[::1]`. The
script does not check that an app on such a local origin is a fake.

### Steps

Each wait for a state or an answer stops after 10 minutes.

1. It creates a workspace through the app. The first message holds a
   random code. Then it opens the events socket of the workspace.
2. It waits for the answer. Then it sends a second message in the same
   session.
3. It stops the sandbox through Boat, and waits until the app shows the
   workspace as stopped. Then it resumes the workspace through the app.
4. It sends a third message. The answer must still hold the code.
5. It reads `CONDUCTIVE_MACHINE_ORIGIN` from the saved variables of the
   sandbox. It makes the runner URL from that origin and
   `MACHINE_PATHS.runner`, as the start script does. It ignores a saved
   `CONDUCTIVE_RUNNER_URL`. That URL must match `LIVE_MACHINE_ORIGIN` with
   the same path.
6. It forks the sandbox twice. The forks get none of its env, so their
   runner service starts nothing.
7. It copies the SDK helper files and their packages into a new folder of each
   fork: inside the home folder in one, and under `/opt` in the other. Both
   forks keep the private Node of the image in its place.
8. It stops and resumes each fork `LIVE_RUNS` times. After each resume,
   the private Node runs the `measure.mjs` of the copy, which times the
   first agent text. Its prompt goes straight to the provider with
   `LIVE_AGENT_LOGIN`.
9. `dist/sdk-helper/compare.mjs` compares the two placements.
10. It deletes the forks and stops the sandbox of the workspace. The
    workspace stays in the org.

The events must have consecutive numbers, with no gap and no duplicate.
Each answer must stream text, and its turn must finish. The
[first-start measurement guide](../runner/sdk-helper/scripts/README.md) describes
`measure.mjs` and `compare.mjs`.

### Output and secrets

The check writes these files to its output folder, and prints the folder:

- `summary.json`: whether the Boat API was real, the results, the IDs, and
  the error of a failed run. `cleanupNeeded` lists each sandbox that the
  check could not delete or stop. `workspaceCleanupNeeded` names a
  workspace whose sandbox the check did not find.
- `home.jsonl` and `system.jsonl`: one timing sample for each resume.
- `comparison.json`: the median of each placement, and the faster one.

More facts:

- `comparison.json` names a faster placement only after three resumes of
  each placement. The check does not move the installed runner.
- When `LIVE_BOAT_API` replaces Boat, `summary.json` says
  `local-fake-endpoints`. Such a run does not prove a real sandbox.
- The check writes no Boat key, cookie, login, response body, or agent
  answer to its output or its files.
- Each fork gets `LIVE_AGENT_LOGIN` in its resume env. So a fork holds a
  real login, unlike a workspace sandbox, which holds only turn tokens.
  Clean up each sandbox that `cleanupNeeded` lists at once.

## Development

- `npm run typecheck` does not check these TypeScript files. Check them
  with `npx tsc -p image/tsconfig.json`.
- The lint and format checks of `npm run check` include these files. Lint
  includes the file-length limit.
- No test runs these scripts.

## Key code

- [`package-system.sh`](package-system.sh): packages the system part.
- [SDK helper packager](../runner/sdk-helper/scripts/package.mjs): packages the SDK helper part.
- [`live-check.mjs`](live-check.mjs): bundles the check and runs it.
- [`live-main.ts`](live-main.ts): runs the steps, writes `summary.json`,
  and cleans up the sandboxes.
- [`live-input.ts`](live-input.ts): reads and checks the variables.
- [`live-app.ts`](live-app.ts) and [`live-stream.ts`](live-stream.ts): the
  app requests of the chat steps, and the checks of the event stream.
- [`live-boat.ts`](live-boat.ts): the fixed Boat requests, pinned to
  `LIVE_BOAT_ORG`.
- [`live-measure.ts`](live-measure.ts): the forks, the timed resumes, and
  the comparison.
