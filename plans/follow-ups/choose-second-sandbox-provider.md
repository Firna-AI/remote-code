# Choose the second sandbox provider after the launch

- **Severity:** Medium. **Effort:** Large. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-09, the post-merge task of decision 213 of `plans/sandbox-provider-groundwork.md`, branch `calummoore/vercel-sandbox-provider`.
- **Location:** `worker/sandbox/accounts.ts`, `worker/sandbox/client.ts`, `worker/sandbox/provider.ts`, and `worker/sandbox/provider-contract.test.ts`.
- **Reason:** On 9 November 2026, the user chose to pick the provider from the launch data, and that data exists only after the launch.

- **Terms:**
  - **Provider account:** an account with a sandbox provider. Each D1 record of a sandbox or a saved snapshot names its account.
  - **Provider kind:** the type of a provider account. Today it has one value, `boat`.
- **Background:**
  - Goal: a second sandbox provider for outages, for overflow, or for both. Today a Boat outage stops every start, build, and refresh, and the app cannot add capacity past Boat's plans.
  - On 9 November 2026, the user chose to do the groundwork with Boat as the only provider, and to choose the second provider after the launch, from the real peak and from Boat's record. That choice replaced the user's choice of 8 November 2026 to add E2B as a cold standby, in `plans/e2b-backup-provider.md` on branch `calummoore/e2b-backup-sandbox-provider`. The groundwork took the place of the shared work of that plan.
  - The groundwork gives these seams. No second adapter exists.
    - `worker/sandbox/accounts.ts` holds `ProviderKind` and the account configuration. Each switch over the kind is exhaustive, so the type check finds each place that a new kind must handle.
    - `providerForAccount` and `orgProviderForAccount` in `worker/sandbox/client.ts` give the client of a stored account. Production configures only `boat`, from `BOAT_API_KEY` and `BOAT_ORG_ID`.
    - The port credential of `worker/sandbox/provider.ts` can carry a provider header in place of Boat's cookie.
    - `org_images` holds one org image for each org and provider account.
    - `worker/sandbox/provider-contract.test.ts` runs the shared `SandboxProvider` contract. A new adapter supplies its own contract factory and driver, as "Provider contract suite" in `worker/sandbox/README.md` says.
  - Calls of 9 November 2026 that the chosen provider must revisit:
    - Only Boat's side of each seam exists. A header credential, command output in files, and a service start by command wait for a provider that needs them.
    - New builds and refreshes use the account `boat`. A new workspace takes the account of its org image. One org runs one build at a time, with one image coordinator. Each account's image record has its own refresh times, but the Cron repair covers only the default account. The provider work decides parallel builds, the refresh of each account, and the placement of new workspaces.
    - The image scripts write the env file to `/run/ascii-secrets/env.sh` and use systemd. A provider whose `/run` is on the saved disk must keep that file off the saved disk.
    - The `hydrated` field of a sandbox is an optional Boat detail. The contract suite leaves out `fork`, because no production code calls it.
  - Other Boat coupling, found on 9 November 2026: systemd services and `apt-get` in `image/install.sh` and `worker/terminal/service.ts`, the env file in `image/runner-start.sh`, `image/git-credential-helper.sh`, and `worker/terminal/scripts.ts`, the promised base image in `src/shared/base-image.ts`, Boat's desktop stream and computer tools, and the restart near day 14 that keeps a Boat disk.
  - Current owners after the Rust software port: `image/install-system.sh` and `image/release/` own the systemd services. `worker/lifecycle/image-software.ts` and `worker/terminal/service.ts` own apt packages. `crates/cnd-cli/src/environment.rs` replaces the deleted credential launcher as a saved-settings reader. `image/runner-start.sh` and `worker/terminal/scripts.ts` still read the env file.
  - A second provider changes provider facts of the legal pages, `src/marketing/terms.ts` and `src/marketing/privacy.ts`: the account, the provider's country, its regions, and the transfer safeguards.
  - Dated research of 9 November 2026. Each fact needs a new check before any choice:
    - **E2B**, for outages only: E2B Pro ran only 100 sandboxes at once.
    - **Vercel Sandbox**, for outages and overflow: 10,000 sandboxes at once on Pro since 5 August 2026. A 4 vCPU and 8 GB sandbox cost about $0.17 an hour idle and $0.27 at 20% CPU, against about $0.036 on Boat. Exposed ports are public, with no auth, so a proxy must guard them. There is no systemd, a stop ends every process, and each resume boots a new machine, so the Worker must start the runner and the terminal at each resume. `/run` is on the saved disk. Sessions last at most 24 hours on Pro. The Acceptable Use Policy of 21 April 2026 bans making "the Services available to any third party", so Vercel must confirm the use in writing. Sources: <https://vercel.com/docs/sandbox/pricing>, <https://vercel.com/changelog/vercel-sandbox-now-supports-10-000-concurrent-sandboxes-and-5-000-vcpus-per-minute>, <https://vercel.com/docs/sandbox/concepts>, <https://vercel.com/docs/sandbox/concepts/images>, <https://vercel.com/docs/sandbox/concepts/persistent-sandboxes>, and <https://vercel.com/legal/acceptable-use-policy>. The saved `/run` came from a first-hand check in a Vercel sandbox on the same day.
    - **Superserve**, for outages and overflow: private ports with a token in a header or a signed link, and paused sandboxes kept with no time limit. Developer cost $20 a month for 100 at once, and Pro $250 a month for 2,000 at once. A 4 vCPU and 8 GiB sandbox cost $0.3312 an hour, about 9 times Boat's price. Commands have no reattach and no offsets. The company had 3 to 5 people, no published regions, and no confirmed SOC 2. Its Terms of Use of 19 August 2026, section 1.3 (a), ban hosting or otherwise commercially exploiting the Services, so it must confirm the use in writing. Sources: <https://www.superserve.ai/pricing/>, <https://docs.superserve.ai/sandbox/lifecycle.md>, <https://docs.superserve.ai/sandbox/preview-urls.md>, and <https://docs.superserve.ai/commands/sessions.md>.
    - **Sprites on Fly.io**, for outages and overflow: a Sprite keeps its disk, and an idle Sprite pays only for storage. Its Hero plan ran 100 at once. The limits of larger plans and the port access were not confirmed.
    - **An own fleet** of sandbox machines: no vendor terms and no hourly markup. Cost: weeks of work, and servers and on-call duty to run.
    - **A second Boat organization** as a second provider account: isolation and a real second account. Cost: a second key, a second organization ID, a second Boat plan, and a protocol change while two organizations exist.
    - Left out on 9 November 2026: two new providers together, because one provider can fill both roles. More Boat organizations only for their limits, because a seat on Boat's $2000 plan added full limits with no code. Daytona, because its largest self-serve tier pooled 500 vCPU, about 125 sandboxes at 4 vCPU. Modal, because a check of 5 November 2026 found about 13 times Boat's price. Cloudflare's sandboxes, because their Docker storage did not survive a sleep, and a sandbox held at most 20 GB of disk. Portable workspaces alone, because they need a second provider to move to.
    - On 5 November 2026, the app chose Boat over E2B, Vercel Sandbox, Daytona, and Modal for its price.
- **Task:**
  1. After the launch, collect the launch data: the peak of running sandboxes and of starts, Boat's outages, its capacity refusals, such as `rate_limited`, `limit_reached`, `no_ready_machine`, and `out_of_capacity`, and the cost.
  2. Check each candidate again: its current API and SDK, private ports, persistence, process model, systemd, where the env file can live, commands with offsets, snapshots, limits, prices, regions, security reports, and terms.
  3. Ask each vendor whose terms limit third-party use for written confirmation of the app's use before any build.
  4. Propose the provider as a new decision, with the options layout of the `decisions-and-findings` skill, for outages, overflow, or both. Include the calls above and the computer tools decision of `plans/follow-ups/second-provider-computer-tools.md`.
  5. After the user chooses, write a plan for the adapter: the new kind, its account configuration, its `SandboxProvider`, its contract factory and driver, the multi-account orchestration, and the legal page facts.
- **Impact if no action:** A Boat outage keeps stopping every start, build, and refresh, and the app cannot add capacity past Boat's plans.
- **Needs:** Launch data from the deployed app. Current vendor documents, prices, and terms. Written confirmation from each vendor whose terms limit third-party use. The user's choice.
- **Done when:** The user chose a provider, or chose to keep Boat alone, from a proposal with current facts, and the chosen work has its own plan. Then delete this item.
- **Related:**
  - `plans/follow-ups/second-provider-computer-tools.md`: this decision applies to the provider that this task picks.
  - `plans/follow-ups/launch-capacity-boat-limits.md`: the capacity choices of the Boat account before this task.
  - `plans/follow-ups/capacity-failure-reason.md`: a later provider maps its capacity replies to the same failure, if the user chooses its option F.
