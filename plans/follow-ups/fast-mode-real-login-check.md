# Fast mode needs a check with real logins

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge check.
- **Added:** 2026-11-13, from the post-merge task of the fast mode plan on branch `calummoore/bern-mapm`.
- **Location:** `runner/sdk-helper/src/providers/claude.ts`, `runner/sdk-helper/src/providers/codex.ts`, `docs/protocol/fast-mode.md`.
- **Reason:** Only the test deployment has real agent logins. The branch checked the requests of both agent programs against a local capture server, with no real model call.

- **Terms:**
  - **Fast mode:** the faster, pricier serving mode of a provider. Claude calls it fast mode. Codex calls it the Fast service tier, `priority`.
  - **Agent login:** the Claude or Codex login of the member who starts a session.
- **Background:**
  - The runner turns on the `fastMode` flag setting of Claude and sends `serviceTierForTurn: "priority"` to Codex for a fast turn.
  - Local runs showed the fast fields in the requests, and fast mode on, for Opus 5.5 and the four Codex models of the app.
  - Some facts stay unchecked: the API price of the Codex Fast tier, how a ChatGPT sign-in prices Fast on GPT-6.1 Terra and GPT-6 Luna, what OpenAI does with Fast under EU data residency, how the live Anthropic API refuses fast mode for an API key without access, and how an own endpoint proxy treats the fast fields.
- **Problem:** No real model call has run with fast mode on.
- **Impact if no action:** A refusal or a price that the local runs did not show can reach members first.
- **Root question:** Does fast mode run, and report its speed, with each kind of real login?
- **Options:**
  - **A.** On the test deployment, send fast messages with real logins: a Claude subscription with and without usage credits, a Claude API key, an OpenAI API key on GPT-6.1 Sol, a ChatGPT sign-in on GPT-6 Luna and GPT-6.1 Terra, and an own endpoint login. Check the speed, the end line, and the cost of each. Effort: Small.
  - **B.** Change nothing. Effort: Small.
- **Left out:** An automated test with real logins. It spends real money on each run, and the gate must not need provider credentials.
- **Wider fix:** None. This is a one-time check after a release.
- **Previous examples:** None found.
- **Recommendation:** A. It is the only check of the real providers.
- **Action:** fix after merge, apply A, because it needs the real logins of the test deployment.
