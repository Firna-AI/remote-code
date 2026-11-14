# Retained diffs fail after a default rename

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-10, from checked review finding 4 on `calummoore/github-status-bar-actions`.
- **Location:** `worker/files/handlers.ts`, `worker/files/data.ts`, `worker/files/content.ts`, `worker/files/runner.test.ts`, `worker/lifecycle/continue-data.ts`, and `crates/cnd-runner/src/repository/changes.rs`.
- **Reason:** This rare defect has a Worker-only fix that reaches every runner image at the next deploy and costs the same later.

- **Terms:**
  - **Continue:** The action that starts a new branch after a merge while keeping the workspace's cloud computer and sessions.
  - **Runner:** The program in a cloud computer that supplies file reports and diffs.
  - **Changes report:** The stored file changes and comparison-base name of one workspace.
  - **D1:** The database that stores workspace and repository records.
  - **Branch target:** The local `branch.<name>.gh-merge-base` value that names the current workspace branch's target.
- **Background:** Each workspace has its own repository copy and runner. Workspaces of one repository in an org share one D1 repository row. Explicit PR-run bases and completed Continue bases now live in `workspaces.base_branch`. Manual, schedule, Run now, and legacy null rows still use the shared repository default. Continue updates that default and only its own repository copy. Current runners keep an active branch target, while each Changes report keeps its selected base name.
- **Problem:** Start workspaces A and B while the default is `main`, with A's stored base null. Rename the GitHub default to `trunk`. Continue B, which updates the shared default to `trunk`. A's current runner still selects its local `main` target and returns a valid diff with `baseBranch: "main"`. The Worker requests `trunk`, so `parseDiff` returns HTTP 502 `file_unavailable`. An older runner instead tries to resolve `trunk`, which its copy lacks, and returns HTTP 503 `file_unavailable`. Changes stays readable in both cases. Explicit non-null workspace bases do not have this shared-row cause.
- **Impact if no action:** A's file diffs remain unavailable until its local reference or request context changes. Members must inspect diffs through Terminal or GitHub. A shorter mismatch also occurs in the continued workspace between its move and publication.
- **Root question:** How does each workspace open its diffs against the same base as its Changes list after the repository's default branch changes?
- **Options:**
  - **A.** Accept a selected base name and match replies through the request ID, path, connection, and type. This removes the existing name equality check and its live mismatch assertion. It requires approval before selection. Effort: Small.
  - **B.** Send the base name from this workspace's stored Changes report. Keep the resolved workspace base as the fallback when no report exists; a null stored base still resolves through the shared default. Keep the existing reply equality check and legacy mismatch assertion. A local base change can still briefly precede its next report. Effort: Small.
  - **C.** Add a requested-fallback echo to new runner replies, separate from the selected comparison base. Validate the echo while preserving legacy reply checks. An echo may only widen acceptance, so a different echo falls back to the legacy rule. This closes the new-runner mismatch but leaves older runners unable to resolve `trunk`. Effort: Medium.
  - **D.** Pin each diff to the base commit of the stored Changes report. Send that commit with its base name. New runners compare that commit. Older runners use the name, as in B. This also closes B's short window, but changes the stored report and both runner messages. It needs a fallback when the commit is unavailable. Effort: Medium.
- **Left out:** Keeping the current code rejects a valid result. Reporting the request name while comparing another branch gives a false base label. Updating every computer adds credentialed work and misses stopped copies. The existing workspace-base column isolates explicit bases but does not remove the shared fallback of null rows. Browser retries cannot repair the Worker request context.
- **Wider fix:** B. Each workspace's report supplies its request context, so another workspace cannot change that context through the shared repository row. D also closes the short same-workspace window at a larger scope.
- **Previous examples:** The shared comparison resolver and selected-base reply entered with commit `f3cfe87c`. The existing `worker/files/runner.test.ts` mismatch case requests `trunk`, receives `main`, and expects HTTP 502. Earlier repository-selection writes could also leave old copies unable to resolve a new default name.
- **Recommendation:** B. It fixes the retained workspace on both old and current runner images without a runner contract change.
- **Action:** fix after merge, apply B, because this rare Worker-only fix is independent and does not get harder after merge.

Keep the shared repository update and the explicit workspace base written by Continue. Agent target-branch context resolves the workspace base before the repository fallback. Keep Continue's fetch inside its own sandbox. Preserve the one comparison resolver, the active branch target, local branches, and the merge-base comparisons required by the current Base branches protocol. That protocol supersedes the earlier plain-tip requirement of this record.

Captured main `d39e64eb1ee3949f4ddd905f890adce3a544169a` adds the workspace-base column without backfilling null rows. The remaining fallback appears in `worker/lifecycle/workspace-data.ts`, `worker/files/data.ts`, `worker/chat/branch-data.ts`, shell reads, Resume, and disk retention. Incoming main narrows this issue but does not close it. No additional base policy or deferred fix was applied during integration.

Preserve the D1 fallback in the file-handler tests when no Changes report exists. Preserve every connection, request ID, type, path, byte-budget, and legacy base-mismatch assertion. Add the renamed-default case through the normal HTTP diff path with two workspaces. Check current and older replies. Assert the actual base name and diff content. Add no sleep, retry, timeout increase, or prose test.
