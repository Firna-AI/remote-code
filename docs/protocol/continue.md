# Continue

This doc holds the requirements and the decisions in force for Continue:
the action that moves a workspace to its next task after its pull request
merged. [After the merge](github-banner.md#after-the-merge) states where
the pull request bar offers it. The terms are those of the
[architecture doc](../architecture.md#terms). A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says.

## One task after another

- After the merge of its pull request, Continue moves a workspace to a new
  branch from the latest default branch of its repository (decision 223).
- The workspace keeps its sandbox, with its files, its installed software,
  and its running processes. It keeps its sessions, and their agents keep
  their context.
- A workspace has one branch at a time. The new branch takes the place of
  the earlier branch in the record of the workspace.
- The workspace keeps its name. Reason: a member can have given that name,
  and no automatic name replaces it, as
  [Workspace and session names](agents-and-sessions.md#workspace-and-session-names)
  says.
- The workspace keeps the software that the install script of its org
  image installed, for each later task. The app's own software in the
  sandbox updates itself, as [Updates](sandbox-software.md#updates) says.
- Reason: Continue keeps the context of the agents and the warm sandbox, as
  in Conductor.
- These ways were rejected (decision 223):
  - Continue in a new workspace from the latest default branch. Its
    sandbox starts cold, and its agents start without the earlier context.
  - Continue in a new workspace that forks the sandbox. Its sessions start
    new, and it needs one more start on the app's Boat account.
  - Archive only. After each merge, the member then waits for a new
    sandbox, and the new agent starts without the earlier context.
  - More work on the merged branch. After a squash merge, a new pull
    request from that branch shows the earlier commits again. The bar also
    finds the merged pull request of that branch, so Create PR
    never shows.

## Who may continue

- Every member of the org may continue each workspace of the org
  (decision 224), as
  [Members and roles](orgs-and-members.md#members-and-roles) says.
- Reason: every member can go on with the work after a merge, and Continue
  deletes no work. The changed files move to the new branch, and the
  commits stay in the sandbox.
- Continue only for the workspace owner and the admins, as for Archive, was
  rejected (decision 224). Archive keeps that rule (decision 42).

## When Continue runs

- The app accepts Continue only when the pull request of the workspace
  branch merged.
- The app refuses Continue in an archived workspace and in a workspace of
  a suspended org.
- The app refuses Continue while a turn runs in a session of the
  workspace. The bar then shows Continue as not available, and says that
  it waits for the agent.
- Reason: a branch change under a running agent can mix its edits into the
  new branch.
- Continue starts a stopped sandbox first, because the branch change runs
  in the sandbox.

## Local work

- Before the branch change, Continue checks the sandbox for local work.
  The check counts the changed files, also untracked files, and the
  commits that no remote branch holds, on every local branch.
- When the check finds local work, a question lists it. The member can
  continue anyway or cancel.
- Reason: the member sees the work before it leaves the current branch.
- The changed files move to the new branch. The commits stay on their
  local branches in the sandbox.
- When Git cannot move the changed files to the new branch, Continue
  stops, keeps the earlier branch, and names the reason.
- Reason: a forced move can lose work.

## The base and the new branch

- Continue fetches the latest default branch with the GitHub access of the
  member who pressed Continue (decision 226), as
  [Continue](github-tokens.md#continue) in GitHub tokens says.
- The new branch starts from that default branch.
- The name of the new branch follows the rule of a new workspace, as
  [The branch and the name](create-a-workspace.md#the-branch-and-the-name)
  says: the current GitHub login of the workspace owner, a city name, and
  four random characters. This holds also when another member presses
  Continue.
- Reason: decision 53 keeps the branches of each person together.

## After Continue

- The pull request bar starts again at the state without a pull request.
  The GitHub events of the workspace follow the new branch.
- The earlier branch stays on GitHub, with its merged pull request.
- Each session shows a note at the place of Continue, as
  [What the chat shows](chat-and-events.md#what-the-chat-shows) says.
- Each session works on the new branch, also a session that starts or
  reopens later, as [The branch line](agent-instructions.md#the-branch-line)
  says (decision 227).
