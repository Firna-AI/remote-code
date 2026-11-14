# Require the Rust gate in the ruleset

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-14, from branch `calummoore/porto-vtqz`, PR #342.
- **Location:** The GitHub ruleset `Protect main` of `Firna-AI/conductive`, and `AGENTS.md` ("CI").
- **Reason:** Only an admin can change the ruleset, and the agent had no admin step.

- **Background:** The change added the CI job `Rust gate`, which checks the Rust format, clippy, tests, the generated types, and the static program build. `AGENTS.md` says that `Protect main` requires both `Complete gate` and `Rust gate`. User decision 7 B of the change chose a required job.
- **Task:** As an admin, add the status check `Rust gate` to the required checks of the ruleset `Protect main`.
- **Impact if no action:** A pull request with a failing Rust check can merge, and the `AGENTS.md` sentence stays wrong.
- **Needs:** An admin of `Firna-AI/conductive`.
- **Done when:** The ruleset lists `Rust gate` as a required check.
