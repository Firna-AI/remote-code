# Terminal Git pushes get no GitHub credential

- **Severity:** Medium. **Likelihood:** Common. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-10, from review round 1 of the branch `calummoore/git-identity-error` (pull request #181).
- **Location:** `crates/cnd-credential/src/service.rs`, `image/github.md`, section "Git credential helper", `src/marketing/docs/terminal-and-previews.md:47` and `:53`, `src/marketing/docs/pull-requests.md:34`, `src/marketing/docs/security.md:36` and `:49`, and the comparison notes in `src/marketing/from-conductor/areas/cloud.ts:72` and `src/marketing/from-conductor/areas/review-and-merge.ts:103` and `:141`.
- **Reason:** the commit author change did not touch the credential helper, and the fix changes who can push from the shared terminal.

- **Terms:**
  - **Cloud computer:** the sandbox of one workspace. The agents, the
    shared terminal, and Git run there.
  - **Credential helper:** `conductive git-credential` in `crates/cnd-credential/`, which the
    image installs as Git's credential helper and as the token source of
    the `gh` wrapper.
  - **Turn ID:** `CONDUCTIVE_TURN_ID`, which the runner sets for each agent
    process. The terminal and scripts do not have it.
- **Background:**
  - In Git credential mode (`get`), the helper writes "Git gets GitHub
    access in an agent turn. Ask an agent to run this command." when
    `CONDUCTIVE_TURN_ID` is missing or empty. It sends no request, and Git
    gets no credential. `image/github.md` states this.
  - In token mode, which the `gh` wrapper uses, an empty turn ID is
    allowed. The Worker then returns the workspace owner's token, as
    `docs/protocol/github-tokens.md` says for `gh`.
  - So in the shared terminal and in scripts outside a turn, `gh` works as
    the owner, but `git push` and `git fetch` over HTTPS get no credential.
  - The public guides say that commands in the shared Terminal use the
    workspace owner's GitHub account, and the terminal guide says that Git
    and the GitHub CLI get GitHub access through Conductive.
  - Three notes of the comparison page at `conductive.build/from-conductor`
    say the same: the terminal uses the owner's account, and Git can push
    from the terminal.
- **Problem:** A member cannot push from the shared terminal with Git,
  while the guides say that terminal commands use the owner's account.
- **Impact if no action:** Members who commit in the terminal cannot push
  without a manual token, and the guides promise more than Git does.
- **Root question:** Can Git in the shared terminal and in scripts push as
  the workspace owner, as `gh` can?
- **Options:**
  - **A.** Keep the refusal. Say in the guides that only `gh` uses the
    owner's account outside a turn, and that Git pushes need an agent turn.
    Effort: Small.
  - **B.** Let the helper's Git mode work without a turn ID, as its token
    mode does. The Worker then returns the owner's token for Git too. This
    widens who can push as the owner from the shared terminal. Effort:
    Small.
  - **C.** As B, but only for the terminal, through a terminal-only marker
    that scripts and other processes do not get. Effort: Medium.
- **Left out:** A separate login of each member in the terminal, because
  the terminal is shared and uses the owner's account outside a turn.
- **Wider fix:** None. The helper has one rule for each mode.
- **Previous examples:** None found.
- **Related:** `plans/follow-ups/commit-author-after-owner-change.md` also
  covers the owner's identity outside a turn.
- **Recommendation:** B. It makes Git match `gh` and the guides, and the
  owner's token is already reachable from the terminal through `gh`.
- **Action:** ask the user, because B changes who can push as the owner
  from the shared terminal, and A changes what the guides promise.
