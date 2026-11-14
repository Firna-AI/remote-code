# First-start measurements

This guide belongs to the [SDK helper](../README.md). Its build writes
the tools into `dist/sdk-helper/`. Run all commands from the repository root.

Build them with `npm --prefix runner/sdk-helper run build`.
Run `node dist/sdk-helper/measure.mjs` or `node dist/sdk-helper/compare.mjs <file>...`.

Two tools measure the time of the first agent start after a resume. The helper part includes both tools. The live check copies that part to
folders inside and outside the home folder for its placement measurements.

- `measure.mjs` reads the `claude` program once and prints one JSON line.
  By default, it starts no agent, and the line says that it measured no
  resume.
- With `CONDUCTIVE_MEASURE_MODE=agent`, `measure.mjs` sends one prompt to
  a real agent. It prints the time from its own start to the first agent
  text. Run it once after each real resume.
- The agent mode gives the agent the developer login of
  `CONDUCTIVE_MEASURE_LOGIN`. Its model requests go straight to Anthropic
  or OpenAI, with no turn token and no model gateway.
  [The measure tool](../../agent-logins.md#the-measure-tool) gives the route of
  that login.
- The agent mode starts one agent adapter directly, not a session of the
  runner. The agent gets empty agent instructions, and the tool saves no
  session state. So the time leaves out the build of the instructions, the
  model's work on their text, and their save in the state file.
- The time also leaves out the profile pair of Claude, and the path of each
  model request through the gateway. Do not read it as the full start time
  of the runner.
- Each agent sample has a placement. `home` is an install folder inside
  the home folder. `system` is an install folder outside it.
- `compare.mjs <file>...` reads the JSON lines of the agent samples. It
  gives the median time of each placement. It names the faster placement
  only when each placement has samples from three or more resumes.
- Local runs cannot choose a placement. Only samples from real resumes,
  with a real login, can.

The agent mode needs these variables:

| Variable                        | Value                                 |
| ------------------------------- | ------------------------------------- |
| `CONDUCTIVE_MEASURE_AGENT`      | `claude` or `codex`                   |
| `CONDUCTIVE_MEASURE_MODEL`      | The model of the prompt               |
| `CONDUCTIVE_MEASURE_LOGIN`      | A real login for that agent           |
| `CONDUCTIVE_MEASURE_LOGIN_KIND` | `token` or `api-key`, for Claude only |
| `CONDUCTIVE_MEASURE_PLACEMENT`  | `home` or `system`                    |
| `CONDUCTIVE_MEASURE_RESUME_ID`  | A label of the real resume            |

`CONDUCTIVE_REPOSITORY` and `CONDUCTIVE_HOME` are optional. Their
defaults are the current folder and the home folder of the user.
