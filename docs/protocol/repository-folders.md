# Repository folders

This doc holds the requirements and the decisions in force for the folder
and the shell variable of each repository in a sandbox, and for the
context folder of each workspace. It belongs to
[Workspaces and sandboxes](workspaces-and-sandboxes.md), which covers the
org image, the startup script, and the start of a workspace. The terms are
those of the [architecture doc](../architecture.md#terms). A decision
number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

## Folder names

- A build puts each chosen repository in its own folder, `~/code/<name>`,
  with the name of the repository on GitHub (decision 94). The folder name
  keeps the case, the dots, the underscores, and the hyphens of that name.
- When two chosen repositories have the same name, with case ignored, the
  folder name of each starts with its owner, such as `acme-storefront`.
- A folder name that is still in use gets `-2`, `-3`, and so on, in the
  order of the repository IDs.
- Reason: the mockups and their sample install script put each repository
  at `~/code/<name>`, and Conductor works the same way. The app's internal
  folders, with one variable for each repository, were rejected, because
  they do not match the mockups.

## Folder variables

- Each folder has a shell variable, `CONDUCTIVE_REPOSITORY_<FOLDER>_DIR`.
  `<FOLDER>` is the folder name in uppercase, with an underscore in place
  of each character that is not an ASCII letter, a digit, or an
  underscore.
- A variable name that is already in use gets `_2`, `_3`, and so on before
  `_DIR`, in the same order. Such a collision does not change the folder
  name.
- The install script and the startup script get the folder variable of
  each repository. A workspace also gets `CONDUCTIVE_REPOSITORY_DIR`, with
  the folder of its own repository.
- The sandbox of a build or a refresh gets only the folder variables, which
  hold no secret. Only the Git command that copies a repository gets a read
  token, as [GitHub tokens](tokens-and-secrets.md#github-tokens) says.

## Folders over time

- A refresh keeps the folders and the variables of the org image.
- A build can move a repository folder to a new name. The move keeps every
  file of the folder, also untracked files such as installed dependencies.
- A workspace keeps the folders and the variables of the org image that it
  starts from. Each resume, and each restart near day 14 of a stop, uses
  them, also after a later build or a change of the chosen repositories.

## The context folder

- Each workspace has a context folder, `.context`, at the top of the
  folder of its own repository (decision 243). Git ignores it. Agents keep
  notes, screenshots, and files for other sessions of the workspace there.
- Its attachments folder, `.context/attachments/`, holds the attached
  files of each message, as
  [Attachments](messages-and-attachments.md#attachments) says
  (decision 242).
- Reason: notes and attached files stay next to the code and out of
  Changes, as in Conductor. One owner, the runner, keeps the folder, its
  rule, and the text that names it to the agents.
- At each start, the runner adds the rule `/.context/` to the local
  exclude file of the repository, such as `.git/info/exclude`. Then it
  makes the context folder and the attachments folder, when they do not
  exist. Reason: the user that runs the agents then owns both folders.
- The runner does both before it reports the files of the workspace. So
  Changes lists no file of the folder that the repository does not track.
- All files lists every file of the folder, also each file that Git
  ignores, such as an attached file. It shows no change mark on such a
  file. So `@` mentions can name these files too, as
  [File mentions](file-mentions.md) says. Reason: agents leave notes and
  screenshots there for the members, who then need no terminal to open
  them. A separate list for the folder beside All files was rejected,
  because it needs a second report and a second view for the same files.
- The exclude file holds the rule once, also after many starts. The rule
  covers only the folder at the top of the repository. A `.context` folder
  deeper in the repository stays visible to Git.
- When a step fails, the runner warns and continues its start.
- Git keeps tracking each file in `.context/` that the repository already
  tracks. It ignores only the other files there.
- The runner leaves a file or a link named `.context` alone. Such a
  workspace cannot take attached files. The turn of each message with
  files fails and names the cause. Reason: such a repository is rare, and
  a second place for the files doubles the path rules.
- A command that deletes ignored files, such as `git clean -fdx`, deletes
  the folder with its notes and attached files. Reason: Conductor has the
  same limit, and the app still stores each attached file outside the
  cloud computer.
- A cloud computer with an older runner gets no rule and no folder at its
  start. Its agents are not told about the folder. Its All files lists no
  file of the folder that Git ignores. An update gives it a newer runner at
  a later start, as [The agent runner](agent-runner.md#the-agent-runner)
  says.
- These ways were rejected:
  - A `.context/` line in the `.gitignore` of each repository. It adds a
    tracked change on every branch.
  - A rule that the build of the org image writes. It does not come back
    after an agent removes it.
  - A global Git ignore file. It covers every repository of the cloud
    computer, and it can clash with an ignore file of the org.
  - A `.gitignore` with `*` as the only rule for the whole folder. It stops
    working when an agent makes the folder again, and it can replace a
    tracked file.
  - Instructions that tell each agent to add the rule. One skipped step
    puts notes in Changes.
  - A notes folder outside the repository folder. Notes and attached files
    then live in two places.
  - A step of the Worker's start command. A defect in it can fail each
    start, and an older runner still does not name the folder.
