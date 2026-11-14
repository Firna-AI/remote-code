# Check the first automatic deploys

- **Severity:** High. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-09, from branch `calummoore/deployment-on-merge-to-main`, PR #82.
- **Location:** `.github/workflows/deploy.yml`, `image/package-system.sh`, `runner/sdk-helper/scripts/package.mjs`, `crates/cnd-release/`, and `docs/automatic-deploys.md`.
- **Reason:** The remaining checks need a later deploy run and a signed-in person in the app.

- **Background:**
  - The workflow `Deploy` deploys each push to `main`. It publishes the Rust program, SDK helper, private Node, system part, and parts list.
  - The upload step in `.github/workflows/deploy.yml` uploads digest-named files to the R2 bucket `conductive-runner` through the S3 API. It skips upload when the object already exists. It then checks that the public size matches the local file.
  - The deploy token supplies the S3 key pair. Its ID is the key ID, and the SHA-256 of its value is the secret key.
  - The workflow writes the latest-release JSON last, at `releases/latest/conductive/x86_64-unknown-linux-musl`. An older deploy must not move this pointer backwards.
  - It applies D1 migrations, deploys the Worker, and checks `https://app.conductive.build/api/health`. The Worker no longer needs runner-archive URL and digest variables.
  - The first real deploy ran on 9 November 2026: run 42554229564 of commit `9ad3d121`, started by hand from `main`. Every step passed. It uploaded `runner-9c823dc293ffebb3078daf42804099d1e8d7137e209a565f36ea95718b5faff8.tar.gz` of 334,647,869 bytes in about 11 seconds, with the AWS CLI checksum settings `when_required`. It applied the migration `202611080100_agent_login_reuse.sql`, deployed Worker version `6ded0e98-4345-40d8-9488-3398084b687d` with its route, its three custom domains, and its cron trigger, and passed the health check.
  - The token is an account-owned token, so that run read its ID from `/accounts/<account>/tokens/verify`.
  - After that first run, no run had yet reused an archive or started another run through the dispatch.
  - That old archive run does not prove reuse or activation of the current release format.
- **Task:**
  1. Check a deploy that keeps one or more release parts unchanged. Compare object metadata before and after the run. Confirm that unchanged digest-named files keep their modification times and receive no second upload.
  2. Read the public latest-release JSON. Confirm its version, program digest, archive size, and corresponding parts list against the deploy output.
  3. Confirm that an older deploy leaves the latest-release pointer unchanged.
  4. Open `https://app.conductive.build`, sign in, and send a message in a workspace running that release.
  5. Fix each error in a new branch and pull request.
- **Impact if no action:** A broken publish step can stop software updates or image builds while the app deploy appears healthy.
- **Needs:** A later deploy run, public release metadata, and a person who can sign in to the deployed app.
- **Done when:** A later run reuses unchanged parts, preserves release ordering, publishes valid metadata, and an agent answers in the deployed app. Then delete this item.
- **Related:** `plans/follow-ups/runner-archive-from-deploy-check.md` checks release installation in an image build. `plans/follow-ups/provider-groundwork-deployed-smoke.md` also checks a deploy run and a message, so one session can run both items.
