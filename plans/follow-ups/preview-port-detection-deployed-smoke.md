# Check deployed Preview port detection

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-10, from the Preview port detection work in PR #154.
- **Location:** `crates/cnd-runner/src/ports/proc.rs`, `crates/cnd-runner/src/ports/sockets.rs`, `worker/chat/port-reports.ts`, and `src/previews/PreviewTool.tsx`.
- **Reason:** This check needs the deployed feature and a workspace running the current release. The manual fallback also needs a still-running older protocol 2 runner.

- **Terms:**
  - **Cloud computer:** The sandbox of one Conductive workspace.
  - **Org image:** The prepared software and repositories that new workspaces use.
  - **Port report:** The runner's complete list of eligible listening servers, sent through workspace events.
- **Background:**
  - Preview lists detected servers with a short program name and an optional repository folder.
  - A row opens the same private preview path as manual port entry.
  - An org image build installs a new runner.
  - Existing workspaces receive automatic updates at a later runner start. Until activation, an older running runner must retain manual entry when no report exists.
  - A preview also needs the preview relay. A workspace without it refuses previews and asks for a new workspace after Build computer.
  - The list excludes the terminal, preview relay, ascii-agent, and Sunshine services.
  - The runner filters known credentials from complete labels. The workspace filters marked org values before stored or displayed cuts.
- **Task:**
  1. After deployment, find a still-running protocol 2 runner without port reports. Record its release and process start time. Do not stop, resume, or restart it before its fallback check. An older image alone does not prove that the running software is old.
  2. Use another test workspace with the current release active. Either let its downloaded update apply at a later normal start, or create it from a new build. Record the active release.
  3. Start a normal web development server in a repository subfolder. Use a known port and record the start signal.
  4. Open **Preview**. Confirm that the server appears with its port, name, and relative folder within five seconds.
  5. Select that row. Confirm that its private preview opens and that its tab has the short program label.
  6. Before any restart, confirm that the older workspace shows its manual port field when its runner supplies no report. With a running relay, open a server there by typing its port. In a separate disposable test workspace, stop the relay service and socket. Confirm HTTP 409 `preview_relay_unavailable` and its current recovery message. Restore both units after the check.
- **Impact if no action:** Local tests and CI do not prove the deployed sandbox release, image build, workspace event connection, and browser flow together. A rollout defect could hide the list or break the manual fallback.
- **Needs:** The deployed release, a signed-in test account, and a workspace with that release active. The older-runner case needs a still-running protocol 2 process without port reports. Record a blocker if none remains.
- **Done when:** The updated workspace lists and opens the server within five seconds with the expected name and folder. An older running workspace retains manual entry. A deliberately unavailable relay returns the required recovery message. Record release versions, process start times, and results.

The requirements live in [Port previews](../../docs/protocol/workspace-tools.md#port-previews) and [Listening ports](../../docs/protocol/agent-runner.md#listening-ports).
