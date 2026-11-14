# A model failure on an own endpoint can name the wrong model

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Medium. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-11, the wider fix of finding 15 of review round 1 on branch `calummoore/cli-proxy-setup`, which fixed the reported case.
- **Location:** `worker/chat/turn-events.ts` (the text of an own endpoint model failure), `worker/chat/delivery-state.ts` (`turn.endpointModel`), `runner/sdk-helper/src/providers/failure.ts` (`failureCause`), the failure event in `src/shared/runner.ts`, and `docs/protocol/own-endpoint-logins.md`.
- **Reason:** The direct fix reads the model of the failed message. A runner that reports the model of the refused request needs a change of the runner event contract, and each runner on an older image must keep working.

- **Terms:**
  - **Own endpoint login:** an agent login that sends the model requests of an agent to a gateway or a proxy that the user chose, with the user's key, through the model gateway in the Worker.
  - **Turn:** one run of the agent. A message that a member sends during a turn joins that turn.
  - **Runner:** the program in each cloud computer that starts the agents and reports their events to the Worker.
- **Background:**
  - The protocol says that a turn on an own endpoint whose endpoint does not serve its model fails with "The endpoint of this login does not serve <model ID>. Choose another model.", with no host.
  - The runner reports such a failure with the code `agent_model_unavailable`, which `failureCause` finds in the error text of the agent. The Worker writes the text, because the runner sees an own endpoint turn as an API key turn.
  - The Worker names the model of the failed message, through the checked `retryMessageId` of the failure event, with `turn.endpointModel` as the fallback.
  - Claude applies a model change during the turn, and its retry message keeps the first model. A Claude request that already runs when a model change arrives still uses the old model. The agent programs also choose their own models for background work.
  - Codex clears its active turn at `turn/completed`, and the runner handles that result later through its queue. A message that the runner delivers in that window starts a new Codex turn on its own model, while `retryMessageId` keeps the earlier message.
- **Problem:** The failure text can name a model that the endpoint serves, in these rare cases.
- **Impact if no action:** The user gets the wrong advice about which model to choose.
- **Root question:** How does the failure cause of an own endpoint turn get the ID of the model that the endpoint refused, for both agents and after a model change inside the turn?
- **Options:**
  - **B.** The runner provider reports the model of the failed request in the failure event, and the Worker checks it against the models of the turn. Keep the current lookup as the fallback for runners on older images, because the Worker serves each runner version of a live image. Effort: Medium.
  - **C.** The model gateway reads the top-level `model` field of each own endpoint request, and saves it on the turn after an error status of the endpoint. The text names that ID, with the current lookup as the fallback. Cost: a scanner of each request body, one more workspace call, and a change of the protocol rule "The gateway keeps no copy of a model request", which needs the user. Effort: Large.
  - **D.** A Codex message with another model waits as the next turn, so each Codex turn runs one model. Cost: it changes the rule that a message during a turn joins that turn, for every Codex session, and it does not cover Claude. It needs the user. Effort: Large.
- **Left out:** A separate model change event, because B gives the same fact with no second state. Generic failure text, because the protocol requires the model ID. An ID read from the error text of the endpoint, because many endpoints omit it, and that text can carry secrets of the saved address.
- **Wider fix:** C. Only C names the model of the refused request itself, also when an agent program changes how it switches models.
- **Previous examples:** None found.
- **Recommendation:** B. It needs no user decision. C best protects the codebase, but the user must first approve the change to the no-copy rule of the gateway.
- **Action:** fix after merge, apply B, because it changes the runner event contract and must keep the current lookup for older runners.
