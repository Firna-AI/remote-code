# Run the live check with the Rust runner

- **Severity:** Medium. **Effort:** Medium. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-14, from branch `calummoore/porto-vtqz`, PR #342.
- **Location:** `image/developer-scripts.md`, `image/live-check.mjs`.
- **Reason:** The live check needs a deployed release and the ten `LIVE_*` inputs, and no workspace sandbox holds them before the merge.

- **Terms:**
  - **Live check:** the developer script that starts a real sandbox, runs a real agent turn through the Worker, and times the first agent start.
  - **Rust runner:** `conductive runner`, the Rust program that replaced the Node agent runner in each sandbox. It drives the agents through the Node SDK helper.
- **Background:** The sandbox software moved to one Rust program, `conductive`, that updates itself from a release that each deploy from `main` publishes. The Rust runner is covered by unit and integration tests with a fake Worker endpoint and a fake helper. No test runs it with a real agent login, the real model gateway, and real systemd in a real sandbox.
- **Task:** After the first deploy of the change, run the live check of `image/developer-scripts.md` against a new workspace. Check that a Claude turn and a Codex turn complete, that their events reach the chat, and that the first agent start time is in the range of the Node runner. Save the output beside the other measurements.
- **Impact if no action:** A defect that only real agents, the real gateway, or real systemd show can stay hidden until members meet it.
- **Needs:** The deployed change, and the ten `LIVE_*` inputs that `image/developer-scripts.md` lists.
- **Done when:** The live check passes for a Claude turn and a Codex turn with the Rust runner, and its output is recorded.
