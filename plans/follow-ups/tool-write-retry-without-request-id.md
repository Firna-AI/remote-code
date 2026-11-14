# Tool write errors invite a duplicate retry

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-14, from branch `calummoore/porto-vtqz`, PR #342, from the check of review finding 202.
- **Location:** `crates/cnd-tools/src/error.rs:53`.
- **Reason:** The Node tools on `origin/main` had the same text, so the change did not cause it.

- **Terms:**
  - **Request ID:** the retry key of a workspace tool write. The same ID makes the Worker return the first result and not repeat the write.
- **Background:** A workspace tool write, such as `sessions send`, can succeed in the Worker and still fail in the tool, for example when the reply does not arrive. The tool then prints a generic error that ends with "Try again." It does not print the request ID that it generated for the call.
- **Problem:** An agent that follows "Try again." without `--request-id` makes a new ID, so the Worker can apply the write twice.
- **Impact if no action:** A rare failed reply can send a message twice or create two workspaces.
- **Root question:** How does a caller retry a write safely after an unclear failure?
- **Options:**
  - **A.** Print the generated request ID in the failure text of each write, and tell the caller to retry with it. Effort: Small.
  - **B.** Make the tool retry a write itself, with the same request ID, before it reports a failure. Effort: Medium.
- **Left out:** No change, because it keeps the duplicate risk.
- **Wider fix:** A.
- **Previous examples:** None found.
- **Related:** None.
- **Recommendation:** A. It needs no new retry logic and makes each retry safe.
- **Action:** fix after merge, apply A, because the problem exists on `origin/main` and is outside the scope of the change.
