# Org NODE_OPTIONS reach the SDK helper

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-11, from the check of finding 5 in review round 1 of the branch `calummoore/github-push-failure`.
- **Location:** `image/runner-start.sh`, `crates/cnd-runner/src/helper/process.rs`, and `runner/sdk-helper/src/providers/environment.ts`.
- **Reason:** This environment policy remains outside the Rust software port's behavior changes.

- **Terms:**
  - **Saved settings:** The org and workspace variables in `/run/ascii-secrets/env.sh`.
  - **Private Node:** The release's Node runtime, which runs only the SDK helper.
- **Background:**
  - `runner-start.sh` exports saved settings before it starts the Rust runner.
  - `NodeHelpers::port` starts the private Node with the runner's inherited environment. It does not remove `NODE_OPTIONS`.
  - An org can set `NODE_OPTIONS` for its project, for example to preload a module with `--require` or `--import`.
  - The runner, workspace tools, and Git credential command are Rust programs. Node options no longer change those commands directly.
  - The SDK helper still loads under Node before its provider environment filter can run.
- **Problem:** The SDK helper inherits the org's `NODE_OPTIONS`. A project preload or an unsupported Node option can stop it before an agent starts.
- **Impact if no action:** Agent turns can fail during helper startup. The project setting gives no clear explanation in the app.
- **Root question:** Which org variables may change the private Node that runs Conductive's SDK helper?
- **Options:**
  - **A.** Remove `NODE_OPTIONS` at the `NodeHelpers::port` child-process boundary. Add a startup case with a project preload. Effort: Small.
  - **B.** Give the private Node a fixed environment. Pass the org variables needed by agent tools separately when the helper starts an agent. This also covers `NODE_PATH`, but needs a larger helper boundary change. Effort: Medium.
  - **C.** Refuse an org variable named `NODE_OPTIONS` in settings. This adds a rejection and stops the org using it for its own project. Effort: Small.
- **Left out:** Removing the variable inside the helper runs too late for a Node preload. Removing it in the runner launcher also removes it from the environment used by agent tools.
- **Wider fix:** B. It separates the private runtime environment from the project environment.
- **Previous examples:** The replaced Node tools launcher removed `NODE_OPTIONS` before it started the private Node.
- **Related:** `crates/cnd-cli/src/environment.rs` now owns saved settings for both Rust commands. `plans/follow-ups/org-env-turns-off-agent-tls-checks.md` covers variables that reach the agent programs.
- **Recommendation:** A. It protects helper startup at the boundary that owns the private Node.
- **Action:** ask the user, because the original finding remains outside its feature scope and the user chooses when to change this environment policy.
