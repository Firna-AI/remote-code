# The Node runner of a busy sandbox uses two cores

- **Severity:** Low. **Likelihood:** Rare. **Effort:** Medium. **Confidence:** Low. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-14, from branch `calummoore/porto-vtqz`, PR #342.
- **Location:** The Node agent runner of sandboxes built before the change, `runner/src/` on `origin/main`.
- **Reason:** The change replaces the Node runner, so the cause may go away, and it needs a measurement with the Rust runner first.

- **Background:** On 13 November 2026, the Node agent runner of the sandbox that built this change used 130 to 200 percent CPU on four cores for over an hour, while about eight long agent sessions ran. Moving the Rust `target/` folder out of the repository did not change it. Under that load, the Worker test suite timed out in 140 unrelated files.
- **Problem:** The cause is unknown. One guess is that the runner rewrites its whole state file at each event, and the state of many long sessions is large.
- **Impact if no action:** Busy sandboxes run tests and builds slowly.
- **Root question:** What makes the runner use this much CPU, and does the Rust runner have the same cost?
- **Options:**
  - **A.** Measure the Rust runner in a busy sandbox after the merge, and profile it only if the load stays. Effort: Small.
  - **B.** Profile the Node runner now, before it is replaced. Effort: Medium.
- **Left out:** No change, because the load can come back with the Rust runner.
- **Wider fix:** None.
- **Previous examples:** None found.
- **Related:** None.
- **Recommendation:** A. The Node runner is gone after the merge.
- **Action:** fix after merge, apply A, because the problem is outside the scope of the change.
