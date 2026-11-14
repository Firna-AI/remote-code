# Workspaces and sandboxes

This doc holds the requirements and the decisions in force for workspaces
and their sandboxes, for the org image that every sandbox starts from, and
for the app's own software in each sandbox.
[Workspace tools](workspace-tools.md) covers the tools of a workspace. The
terms are those of the [architecture doc](../architecture.md#terms). A
decision number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

These docs belong to this doc:

- [Org image](org-image.md): its builds, refreshes, and first build.
- [Sandbox software](sandbox-software.md): the releases of the app's own
  software, the updates of each sandbox, the install in a build, and the
  software image.
- [Create a workspace](create-a-workspace.md): New workspace as a page or
  as a dialog, the create, the branch, and a failed first start.
- [Repository folders](repository-folders.md): the folder and the shell
  variable of each repository in a sandbox, and the context folder of each
  workspace.
- [Life of a workspace](workspace-life.md): the start steps, the time
  limits, the states, the stop and resume, the archive, the restore, and
  Continue.
- [Continue](continue.md): the next task of a workspace after a merge, on
  a new branch with the same sandbox and sessions.
- [Workspace menu](workspace-menu.md): the menu of a workspace row, which
  moves, reassigns, renames, and archives the workspace, and copies its
  link.
- [Tools of a workspace](workspace-tools.md): the files and changes, the
  terminal, the port previews, and the desktop.

## The provider

- Boat runs every sandbox (decision 2).
- Every sandbox and every org image of every org runs in the app's own
  Boat account (decision 80). That account pays for all use.
- No user needs a Boat account or a Boat key.
- A Boat key for each org was rejected. Users then needed their own Boat
  account, and the app had to name Boat to them.
- All orgs share the plan limits of the app's Boat account, such as the
  number of sandboxes at once and of starts in a day.
- [Access and security](isolation.md#the-apps-boat-key) states
  how the Worker keeps the app's Boat key.
- User-facing text never names Boat (decision 80). It says "cloud
  computer" or "sandbox". This holds in the app, the Mac app, the
  marketing site, Get started, and the legal pages.
- Reason: the user asked that the provider stays hidden, so that the app
  can move to another provider later.
- Each workspace has its own sandbox with its own clone of its repository
  (decision 4). One worktree for each workspace in a shared sandbox was
  rejected, because each workspace gets its own sandbox.
- Every sandbox has one machine size for now: Boat's default size, with
  4 vCPU and 8 GB.

## Disk flushes

- A sandbox sends no disk flush to its host (disk decision 1). So `fsync`
  returns when the host has the data, not when the host's disk has it.
  Disk decisions are the decisions of the change that added this section.
- Reason: a flush on a Boat disk took about 22 ms. Tools that sync each
  write ran many times slower. For example, a page of the app under
  `npm run dev` took 30 seconds or more, and about 4 seconds without
  flushes.
- E2B and Superserve sandboxes also send no flush.
- Risk: a crash or a power loss of the host can lose recent writes, and
  can damage the file system of the sandbox. A crash of a program or of
  the sandbox, and a normal stop, lose nothing.
- Boat takes a snapshot of the disk each minute. After a machine failure,
  Boat restores the last good snapshot, so a failure already loses up to a
  minute of writes. So flushes add little protection.
- A sandbox with flushes was rejected, because its previews of dev servers
  were too slow. A wait for faster Boat storage was rejected, because its
  date is unknown.
- The rule is a part of each release of the sandbox software. So an update
  brings it to an older sandbox, as
  [Updates](sandbox-software.md#updates) says. Such a sandbox keeps its
  flushes until a start after that update.

## The org image

[The org image](org-image.md#the-org-image) holds its builds and refreshes.

### The first build

[The first build](org-image.md#the-first-build) holds the first and added builds of a new org.

## Sandbox software

[Sandbox software](sandbox-software.md) holds the releases of the app's
own software in each sandbox, and the rules by which each sandbox checks
for, downloads, and applies an update.

## Repository folders

- [Repository folders](repository-folders.md) gives the folder and the
  shell variable of each repository in a sandbox (decision 94).

## Startup script and env vars

- The startup script runs in the sandbox of each workspace at each start
  and at each resume.
- Bash runs the startup script.
- The startup script starts in the folder of the workspace's repository
  (decision 94).
- [Folder variables](repository-folders.md#folder-variables) says which
  scripts get the variable of each repository folder.
- Only an admin changes the install script, the startup script, the env
  vars, and the repositories (decision 57). Other members see them
  read-only.
- Each sandbox gets the org's env vars at create and at each resume
  (decision 17). A changed value applies at the next start.
- The app's own variables replace an org env var with the same name.
- The sandbox gets no org env var with the name of a value that the agent
  runner gives each agent process for its turn. These are the turn ID and
  the four Git author variables of
  [Commit author](github-tokens.md#commit-author) (decision 233). Reason: a
  shell that loads the sandbox's variables again would then replace the
  values of the turn.
- Builds and refreshes get none of the env vars, and no saved snapshot
  holds them. Reason: a saved snapshot keeps every file.
- The app gives each sandbox its values itself, because every sandbox
  starts with no secrets of a Boat environment.
- [Access and security](tokens-and-secrets.md#secrets-that-users-enter)
  says how the app keeps the values.

## Create a workspace

- [Create a workspace](create-a-workspace.md) holds the requirements of the
  page, the dialog, the create, the branch, and a failed first start.

## Base branch

- [Base branches](base-branches.md) states the base branch of each
  workspace and the branch of a pull request run (decisions 505 A and 507 G).

## Workspace numbers and links

- The workspace header omits the branch name on desktop and on a phone.
  Reason: this keeps the header compact.
- Each workspace has a number in its org (decision 212). The numbers of an
  org count up from 1, in the order in which its workspaces were created.
- The app never gives a number twice in one org. This holds also after a
  failed first start and after a Restore of the org.
- Reason: a person who said `W-12` must not find another workspace there
  later.
- The label of a number is `W-` and the number, such as `W-395`, in every
  org. Org initials before the number, such as `AC-395`, were rejected,
  because the label then changes when an admin changes the initials.
- A part of the workspace ID or of the branch name in place of a number
  was rejected, because people cannot easily say it.
- The label shows on the [Copy link](workspace-links.md#copy-link) button
  of the workspace header and in each [chip](workspace-links.md#chips). A
  [search of the command palette](command-palette.md#search) that matches
  the label shows it too.
- The rows of the workspace list show no label. A label in each row was
  rejected, because the names then lose room in the sidebar and on a
  phone.
- Each workspace has a link: the web address of its page at the app
  origin, such as
  `https://app.conductive.build/orgs/<org ID>/workspaces/<workspace ID>`.
- The link names the org and the workspace by their IDs, never by a number
  or a name. So the label and the name can change later (decision 212).
- The workspace record gives the number in `number` and the link in
  `link`. Copy link, the chips, and the agent tools use this link.
- Reason: the page of the Mac app runs on its own origin, and a sandbox
  does not know the app origin.

## The workspace menu

- [Workspace menu](workspace-menu.md) holds the requirements of the menu
  of a workspace row: Move to section, Reassign to, Rename, Copy link, and
  Archive.

## Tools of a workspace

- [Workspace tools](workspace-tools.md) holds the requirements of the
  tools of a workspace.

### Files and changes

- [Files and changes](workspace-tools.md#files-and-changes) states the
  file lists of a workspace and the file reports of the runner.

### Terminal

- [Terminal](workspace-tools.md#terminal) holds the requirements of the
  shell of a workspace.

### Port previews

- [Port previews](workspace-tools.md#port-previews) holds the
  requirements of the previews of the ports of a sandbox.

### Desktop

- [Desktop](workspace-tools.md#desktop) holds the requirements of the
  live desktop of a sandbox, which the app hides for now.

## Start steps

[Start steps](workspace-life.md#start-steps) holds these workspace requirements.

## Time limits of builds and starts

[Time limits of builds and starts](workspace-life.md#time-limits-of-builds-and-starts) holds these workspace requirements.

## Workspace states

[Workspace states](workspace-life.md#workspace-states) holds these workspace requirements.

## Stop and resume

[Stop and resume](workspace-life.md#stop-and-resume) holds these workspace requirements.

## Archive

[Archive](workspace-life.md#archive) holds these workspace requirements.

## Continue

[Continue](workspace-life.md#continue) holds these workspace requirements.
