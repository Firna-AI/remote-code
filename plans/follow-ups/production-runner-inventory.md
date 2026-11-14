# Check deployed runners and org images

- **Severity:** Low. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-12, from the removal of legacy runner support on branch `calummoore/oslo-o65g`.
- **Location:** The deployed Worker, workspace Durable Object connection records, D1 `workspaces`, and D1 `image_builds`.
- **Reason:** This workspace has no authenticated production database access.

**Terms:**

- **Runner:** The program in each cloud computer that runs agents and connects to the Worker.
- **Org image:** The saved setup from which new cloud computers start.
- **Version pin:** The lowest runner protocol version a workspace accepts, in `workspaces.runner_protocol_version`.

**Background:** Cal approved removal of runner protocol version 1 on 12 November 2026 because nobody uses it anymore.
The Worker now accepts the supported protocol independently of each workspace pin.
An old pin alone does not show which runner currently connects.
A full image build installs the current runner. Existing computers can replace it through automatic software updates at a later start.
An image version or workspace pin does not prove the release of a running process.
This change neither rebuilds org images nor moves workspaces.
`CI=true npx wrangler whoami` reported: "You are not authenticated. Please run `wrangler login`."
No production query ran.

**Task:** Run a read-only inventory through an authenticated, authorized production route.
Check actual runner connection versions where available.
Check latest successful org image build versions, including missing recorded versions.
Report affected workspace and org counts separately from version pin counts.
Record any old images that need an admin to build them again.
Check whether compatible earlier running processes exist for the separate deployed hibernation and context-attachment checks.
`plans/follow-ups/verify-deployed-hibernation-compatibility.md` needs a still-running protocol 2 process from before hibernation deployed.
`plans/follow-ups/context-attachments-live-older-runner.md` needs a still-running protocol 2 process from before context-folder support.
Those items retain their checks. This inventory does not drop them.
Do not treat a pin of 1 as proof of a live unsupported runner.
Do not rebuild an image, change stored data, or move a workspace as part of this inventory.

**Impact if no action:** An unused old image can still create a cloud computer whose runner Conductive refuses.

**Needs:** Read-only access to production D1 and the available runner connection records.

**Done when:** A report gives the counts of unsupported connections and old org images, with each missing source stated.
