# Check that an existing workspace updates itself

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-14, from branch `calummoore/porto-vtqz`, PR #342.
- **Location:** `crates/cnd-cli/src/update/`, `worker/lifecycle/software-bootstrap.ts`, `image/release/conductive-runner.service`.
- **Reason:** The check needs two deployed releases and a workspace that existed before the first one.

- **Terms:**
  - **Release:** one version of the sandbox software, published to the R2 bucket `conductive-runner` at each deploy from `main`.
  - **Bootstrap:** the background step of the workspace startup command that installs the program `conductive` in a sandbox that does not have it.
- **Background:** An existing sandbox has no `conductive` program. At its next start, the startup command installs it in the background. After that, the program checks for a newer release at each start of the runner and every hour, downloads it in the background, and applies it at the next start of the runner. Tests cover each step with temporary folders, a local release server, and a real systemd smoke run, but not across real deploys.
- **Task:** Use a workspace that existed before the first deploy of the change. Stop and resume it, and check that `/opt/conductive/current/conductive` appears. After a second deploy, wait for a check or resume the workspace, then resume it again, and check that `/opt/conductive/current` points to the newer version and that agent turns still work. Also check that a member sees no error during these starts.
- **Impact if no action:** An existing workspace could keep old software with no warning, which is the problem that the change exists to fix.
- **Needs:** Two deployed releases and an existing workspace.
- **Done when:** An existing workspace runs the newest release after two starts, with no manual step.
