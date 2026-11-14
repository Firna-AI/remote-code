# Names from the workspace tools

This doc holds the requirements and the decisions in force for the names
that the workspace tools give: the name of a workspace and the title of a
session. It belongs to [Agent tools](agent-tools.md).
[Workspace and session names](agents-and-sessions.md#workspace-and-session-names)
states the names that the app gives on its own. The terms are those of the
[architecture doc](../architecture.md#terms). A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says.

## Where the rule applies

- The Worker cleans each of these names with [the name rule](#the-name-rule):
  - the name of the new workspace of `create_workspace`
  - the title of its first session
  - the title of a new session of `create_session`
  - the name of `rename_workspace`
  - the title of `rename_session`
- The reply of each of these calls holds the stored name.
- In a create, a name or a title that is blank after the rule counts as no
  name. The app then shows "Untitled", as
  [Create a workspace](create-a-workspace.md#the-branch-and-the-name)
  says.
- A rename with a name that is blank after the rule gets HTTP 400 with the
  error code `invalid_input`, as the rename routes of the app do. Reason: a
  rename must name something.
- No automatic name replaces a name from these calls, as
  [Workspace and session names](agents-and-sessions.md#workspace-and-session-names)
  says (decision 182). So a rename from an agent stays, as a rename in the
  app does.

## The name rule

- The rule has four steps:
  1. It keeps only the first line that has text.
  2. It makes each run of white space one space.
  3. It removes one final full stop, but it keeps an ellipsis.
  4. It cuts a name over 60 Unicode code points at its last space within
     the limit. When the first word is longer than the limit, it cuts the
     name at the limit.
- A name does not change the branch. The branch keeps its rule: the GitHub
  login, a city name, and four random characters.
- Reason: a name that sandbox code sends reaches the workspace list of
  every member. A short name on one line keeps each list readable.
- For a create, a refusal of a blank or long name was rejected, because
  the agent then gets an error for a name that the rule can clean.
- For the name, the CLI help and the description of `create_workspace`
  say: "Use plain words separated by spaces. Avoid underscores unless the
  user tells you to add them."
- The rule keeps each underscore of the name (decision 256). Reason: only
  the agent knows whether the member asked for underscores.
- A rule step that changes each underscore to a space was rejected, because
  the agent could then not keep underscores that a member asked for. A
  field that marks a name from the member was rejected, because no agent
  name showed the risk, and the agent must still set the field.
- A step that keeps only the underscores of words from the member's
  messages was rejected, because a request in other words, such as "use
  snake case", then loses its underscores. A rule that an agent names a
  workspace only when a member names it was rejected, because agents then
  name fewer workspaces.
- Risk: an agent that ignores the text still adds underscores. The text
  follows the [sandbox software update rules](sandbox-software.md#updates).
