# Check an image build with the deployed release

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-09, from branch `calummoore/deployment-on-merge-to-main`, PR #82.
- **Location:** `.github/workflows/deploy.yml`, `docs/deployment/runner-archive.md`, `image/README.md`, `worker/lifecycle/software-release.ts`, and `worker/lifecycle/image-software.ts`.
- **Reason:** The check needs a published sandbox release and a real org image build.

- **Terms:**
  - **Org image:** The prepared cloud computer image from which an org starts new workspaces.
  - **Sandbox release:** The Rust program and verified private Node, SDK helper, and system parts published at `https://runner.conductive.build`.
- **Background:**
  - Before automatic releases, a person uploaded `runner-a145db0.tar.gz` by hand and set two Worker variables. Those archive settings no longer drive installation.
  - The deploy publishes digest-named release files and the latest-release JSON at `releases/latest/conductive/x86_64-unknown-linux-musl`.
  - The software step reads that metadata, verifies the bootstrap program, downloads the release parts, and applies the complete release.
  - Existing workspaces receive software through background downloads and later activation. This item checks the separate image-build path.
- **Task:**
  1. After a successful deploy publishes a release, record the latest-release JSON, program digest, parts list, and release version.
  2. Start a new build of a test org image in the deployed app. Check the verified download and successful software step in its build log.
  3. Start a workspace on that image. Record its installed release version and complete marker. Confirm that the version matches the release selected for the build.
  4. Send a message and check that an agent answers.
- **Impact if no action:** Wrong metadata, missing parts, or a bad digest can fail new image builds despite a successful Worker deploy.
- **Needs:** A successful release publish, access to its public metadata, and a test org in the deployed app.
- **Done when:** A real image build installs the verified published release and an agent answers in a workspace on it. Then delete this item.
- **Related:** `plans/follow-ups/first-automatic-deploys-check.md` checks publication and reuse first. `plans/follow-ups/provider-groundwork-deployed-smoke.md` also runs an image build and checks an agent answer.
