# Check a Codex fork that carries the other backend's reasoning

- **Severity:** Medium. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-11, from the live retest of the fork after a login switch on branch `calummoore/openai-subscription-token-support` (pull request #177).
- **Location:** `runner/sdk-helper/src/providers/codex-thread.ts`, and the rule in the section "Agents" of `docs/protocol/agents-and-sessions.md`.
- **Reason:** the live retest of 11 November 2026 had no encrypted reasoning item to carry, so it could not show whether a real backend accepts the other backend's reasoning.

- **Terms:**
  - **Model provider:** a name in the settings of Codex for where it sends model requests. Codex saves it with each conversation. The runner uses `conductive` for an OpenAI API key and `openai` for a ChatGPT sign-in.
  - **Encrypted reasoning:** opaque data that one OpenAI backend puts in a response item, which Codex sends back in later requests.
- **Background:**
  - Codex refuses to resume a conversation under another model provider. After a member switches the Codex login between an API key and the ChatGPT sign-in, the runner forks the conversation under the new provider and continues in the fork.
  - The fork copies the earlier history unchanged, also each encrypted reasoning item of the other backend. A test with a fake OpenAI showed that Codex sends these items.
  - The live retest passed four turns with `gpt-6.1-sol`, through the real API and ChatGPT backends. The word of the first turn came back after each switch. The first turn produced no encrypted reasoning item, so no backend received the other's reasoning.
- **Task:** Run a live retest whose earlier turn produces encrypted reasoning, for example a multi-step task at a high effort. Then switch the login, and continue the conversation in both directions. Record whether each backend accepts the other's reasoning.
- **Impact if no action:** If a backend refuses the other's reasoning, the first turn after a switch fails for each conversation with reasoning, and the member must start a new session.
- **Needs:** a ChatGPT sign-in with usage left, and a temporary OpenAI API key with a low spend limit.
- **Done when:** A live run shows both directions with encrypted reasoning items, or a finding records the refusal and its fix.
