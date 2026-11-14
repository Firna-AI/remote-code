---
title: Terminal and previews
description: Run commands on a workspace's cloud computer and open a running web app by its port.
group: Work
order: 40
---

## Before you use the tools

Open a workspace in an org you belong to.
Its cloud computer must start before the tools can connect.
Select **Resume** if the computer is stopped.

For an archived workspace, use **Restore** first if it is available.
Restore leaves the computer stopped.
Resume it before opening **Terminal** or **Preview**.

Commands in **Terminal** run on that cloud computer.
A preview shows a web server that runs there too.

## Open Terminal

1. Open **Terminal** in the workspace.
2. Select the terminal area to give it focus.
3. Enter the command you want to run.

The shell starts in the workspace's repository folder.
Its prompt shows the current folder name.
Use `pwd` to see the full path.
For a quick check, you can run:

```bash
pwd
git status
```

Use your repository's instructions for dependency installation, tests, and development commands.
The phone terminal adds a row of keys that a phone keyboard lacks.

The shell keeps running when its connection drops.
Reconnect to return to the same shell and running commands.
A stop of the cloud computer ends those commands.
After a resume, start any needed server again.

## Know which GitHub account a command uses

Git and the GitHub CLI, `gh`, get GitHub access through Conductive.
The CLI is ready to use without a separate login step.

| Where the command runs | GitHub account |
| --- | --- |
| In an agent turn | The person whose message started the turn |
| In the shared Terminal | The workspace owner |
| GitHub CLI outside an agent turn | The workspace owner |

Commits name the person in the table as both author and committer.
Commits that a script makes outside an agent turn name the workspace owner.
An `author` or `committer` setting in the repository or in the global Git settings takes priority over the workspace owner's author.
In a workspace with older cloud computer software, agent commits name the workspace owner.
[Apply setup changes](/docs/cloud-computer#apply-setup-changes) says how to get newer software.
Conductive uses their GitHub display name, or their login when the display name is missing or unusable.
Each commit uses their private GitHub no-reply address, `<id>+<login>@users.noreply.github.com`.
Here, `<id>` is their GitHub user ID and `<login>` is their GitHub login.
GitHub links the commit to their account without showing their private email.

Every member connected to that Terminal uses the same owner identity.
An explicit `GH_TOKEN` or `GITHUB_TOKEN` value can replace the supplied CLI login.

The token can reach repositories that both that person and the GitHub App can access.
This can include repositories outside the Conductive org.

**Merge** and **Continue** in the pull request bar use the GitHub account of the member who selects them.
The shared Terminal still uses the workspace owner's account.

- [Use pull request actions](/docs/pull-requests)

## Preview a running app

1. Start your web server with the agent or **Terminal**.
2. Open **Preview**.
3. Select your server in the list.

Each row shows a port and can also show a short program name and repository folder.
The list updates as servers start and stop.
Servers that already have an open preview appear in their tabs.
When the list is empty, the form asks you to start a server in **Terminal** or ask the agent.

To open a server by its port:

1. Note the port that the server reports.
2. Enter it in **Other port** below the list, or **Port** when only the field appears.
3. Select **Open preview**.

For example, enter `3000` if your server reports port 3000.
Use the port of your server when it reports a different one.

An older cloud computer can show only the **Port** field.
Use the manual steps there.
If Preview says it needs newer cloud computer software, an automatic update brings the required preview support at a later start.
An existing workspace also gets the server list with an automatic software update.

- [Understand cloud computer software updates](/docs/cloud-computer#apply-setup-changes)

The preview opens inside the workspace.
Use **Open** to show the app in a new browser tab when it works better there.
This can help when its cookies or sign-in do not work inside the frame.

## Manage previews

Each preview tab shows its port and a program name when available.
The program name uses at most 10 characters, including **…** when shortened.
Its tooltip and screen reader label give the full name and folder.
Use **+**, named **Preview another port**, to choose another server or enter its port.
Use **Reload** to load the selected preview again.
Use the **×** after the name of a preview tab to close that preview.
It shows on the selected tab, and on another tab when you point to it.

A preview expires after 24 hours.
Stopping the workspace's computer also closes its previews.
Open a new preview after the computer resumes.

Preview access follows your sign-in and workspace access.
A copied preview address grants no access by itself.

Ask an agent to list, open, or close previews.
To open a preview, give the agent your server's port.
It can do this in any workspace of the same org.
Previews that agents open need sign-in and workspace access.

## Recover from a connection error

If Terminal cannot connect, check the workspace's start state.
Use **Resume** or **Try again** when the workspace offers it.
Then open **Terminal** again.

If a preview does not open, check that its server is running.
Check the port number.
Try **Reload**, or close the preview before opening it again.
Use **Open** if only the framed view fails.

## Understand access to the computer

The terminal is shared with members of the org.
Its output does not hide secrets.
Members with terminal access can also obtain GitHub credentials available to the workspace.

Conductive offers **Terminal** and **Preview** as workspace tools.
The Mac app provides a window for Conductive and optional Mac command requests.

- [Restore an archived workspace](/docs/workspaces#restore-an-archived-workspace)
- [Change startup commands](/docs/cloud-computer#run-commands-at-startup)
- [Read the security guide](/docs/security)
- [Use the Mac app](/docs/mac-app)
