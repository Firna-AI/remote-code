# Claude attribution names Claude Code

- **Severity:** Low. **Likelihood:** Common. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-09, from the options check of the plan for agent instructions on the branch `conductor/conductor-prompts`.
- **Location:** `runner/sdk-helper/src/providers/claude.ts:59`.
- **Reason:** The change that found it adds the agent instructions, and the attribution of commits and pull requests is a separate setting with its own naming choice.

- **Terms:**
  - **Attribution:** the text that Claude adds to git commits and pull
    request descriptions, such as a `Co-Authored-By` trailer. The Claude
    Agent SDK setting `attribution` controls it.
- **Background:** The agent runner starts Claude through the Claude Agent
  SDK 0.3.318, and it sets no `attribution` setting. The type docs of that
  SDK say that each field of `attribution` defaults to the standard Claude
  Code attribution, and that an empty string or `false` hides it. The
  section "Names in the product" of `docs/protocol/agents-and-sessions.md` says
  that user-facing text never uses "Claude Code" as a name of the product
  or of its features.
- **Problem:** Commits and pull request descriptions that Claude agents
  write can carry the standard Claude Code attribution. Nobody has checked
  whether Claude adds it with the short custom system prompt that the
  runner now sends.
- **Impact if no action:** The repositories of users can show "Claude Code"
  in the commits and pull requests that Conductive agents make.
- **Root question:** What attribution should the commits and pull requests
  of Conductive agents carry?
- **Options:**
  - **A.** Keep the default attribution. Effort: Small.
  - **B.** Set `attribution` to text that follows the naming rules, such as
    a commit trailer and a pull request line that name Conductive and an
    agent powered by Claude. Effort: Small.
  - **C.** Hide all attribution with `attribution: false`. Commits then do
    not show that an agent wrote them. Effort: Small.
- **Left out:** A line in the agent instructions that asks for other
  attribution text, because the setting is the supported control, and the
  line would conflict with the default text that Claude gets.
- **Wider fix:** None, because the fix is one setting in one file.
- **Previous examples:** None found.
- **Recommendation:** B. It keeps the record that an agent wrote the change,
  and it follows the naming rule.
- **Action:** ask the user, because the attribution text is a naming choice
  that no rule settles.
