# Let the owner choose the prompt cache of a Claude own endpoint

- **Severity:** Low. **Effort:** Medium. **Confidence:** High. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-11, from decision 12 of the own endpoint plan on branch `calummoore/cli-proxy-setup`. Cal chose B now and C later: "B - C later (can we add as advanced menu)".
- **Location:** the own endpoint fields of `AgentConnectForm` in `src/shell/account/`, the `agent_logins` table, the turn credential in `src/shared/runner.ts`, `runner/sdk-helper/src/providers/claude.ts`, and "How the agents reach the gateway" in `docs/protocol/model-gateway.md`.
- **Reason:** Cal chose to ship the 1-hour cache for every Claude own endpoint first, and to add the choice later.

- **Terms:**
  - **Prompt cache:** Anthropic keeps the earlier part of a conversation for a time, so that the next request reads it for less money and less use of the limits.
  - **Own endpoint login:** an agent login that sends the model requests of an agent to a gateway or a proxy that the user chose, with the user's key.
- **Background:**
  - Decision 12 B makes Claude ask for a prompt cache of 1 hour on every turn on a Claude own endpoint login.
  - Anthropic charges 2 times the input price to write the 1-hour cache, and 1.25 times for the 5-minute cache.
  - An own endpoint can pool subscriptions, bill a metered API key, or send the request to another cloud. Some endpoints may not accept the 1-hour cache.
- **Problem:** The owner of a metered endpoint, or of an endpoint that refuses the 1-hour cache, cannot turn it off.
- **Impact if no action:** Such an owner pays more for each cache write, or sees each Claude turn fail on the endpoint.
- **Root question:** How does the owner of a Claude own endpoint choose how long its prompt cache lasts?
- **Options:**
  - **A.** Keep the 1-hour cache for every Claude own endpoint. Cost: the owner has no way out. Effort: Small.
  - **C.** Add an advanced part to the own endpoint form, closed by default, with the switch "Keep the prompt cache for 1 hour", on by default. Store the choice with the login, send it in the turn credential, and state it in the protocol. Cost: a mockup, a column, a form field, and a runner command field. Effort: Medium.
- **Left out:** Detection of what is behind the endpoint, because no request or answer shows it reliably. The letters keep those of decision 12.
- **Wider fix:** None. The item adds a choice, and it has no class of defect.
- **Previous examples:** Gateway decision 13, which chose 1 hour for subscription tokens, and decision 12 B of the own endpoint plan.
- **Recommendation:** C. Cal chose it for later.
- **Action:** fix after merge, apply C, because Cal chose it on 11 November 2026 for a later branch, as an advanced menu.
