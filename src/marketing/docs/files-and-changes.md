---
title: Files and changes
description: Read repository files, inspect branch changes, and copy or download the content you need to review an agent's work.
group: Work
order: 30
---

## Open the files of a workspace

Open a workspace that belongs to one of your orgs.
Its file tools use the workspace's selected repository.
If its computer is stopped or starts again, the file lists show their last saved copy.
Opening a file or a change starts the computer again.

On a computer, the file lists sit beside the chat.
On a phone, open the workspace's **Files** view.

- **All files** shows the repository as a tree. With current cloud computer software, it also lists the files in `.context/`.
- **Changes** lists changes against the workspace's base branch.
- **Checks** shows the pull request's GitHub checks.

An automatic software update brings `.context/` support to an older workspace at a later start.

An archived workspace keeps read-only chat, with no file lists or tools.
Its computer and files can stay available for Restore for 14 days after Archive.
Restore the workspace while **Restore** is available.
Then select **Resume** before you use the file tools.

- [Restore an archived workspace](/docs/workspaces#restore-an-archived-workspace)

## Read a file

1. Open **All files**.
2. Open the folders that contain your file.
3. Select the file.

On a computer, a click opens a file in one temporary tab.
Its title shows in italics.
The next click on another file replaces it in the same place.
This applies to **All files**, **Changes**, and file chips in chat.
If a file already has a tab, a click shows that tab.

On a phone, each file opens within **Files**.
Use its back action to return to **All files**.

Text shows line numbers and syntax colours.
Markdown offers **Preview** for its rendered content and **Source** for its text.
PNG, JPEG, GIF, and WebP files show as pictures up to the 5 MiB read limit.
A picture keeps its proportions and fits the view.
SVG files show their source as text.

Other binary files offer **Download** so you can open them with another application.
The file view also offers **Download** if the browser cannot draw an image within the read limit.

These views let you read the files.
Ask the agent to change a file, or use **Terminal**.

You can also open an attached file from its chip in a sent message.
It opens the copy in the workspace's repository folder after the message reaches the agent.
Restore an archived workspace before opening its attached files.

- [Attach files to messages](/docs/sessions-and-chat#attach-files)

## Keep a file open

On a computer, keep a file in a normal tab so that another file does not replace it.
Double-click its row in **All files** or **Changes**.
You can also double-click the tab.

To use the tab menu:

1. Right-click the temporary tab.
   With a keyboard, press **Shift+F10** while the tab has focus.
2. Select **Keep open**.

Moving the temporary tab to another place in the row also keeps it.
A normal tab stays open until you close it.
The next file without a tab opens in a new temporary tab.

In a read-only workspace, use a double-click to keep the tab.

## Inspect changes

1. Open **Changes**.
2. Select a changed file.
3. Review its diff against the workspace's base branch.

The diff shows syntax colours, as a file does.

The base branch is the branch that the workspace's work targets.
A workspace you create uses the repository's default branch.
A run for an opened or pushed pull request uses that pull request's head branch.
A run for a merged pull request uses that pull request's base branch.
After **Continue**, the workspace's base branch is the repository's latest default branch.
The comparison starts at the common commit of the workspace branch and its base branch.
Newer commits on the base branch therefore stay out of **Changes**.

The list includes the branch's committed changes, uncommitted changes, and untracked files.
It covers the workspace branch's work, including work from other sessions.
It is broader than the changed-file summary of one agent turn.

Use the list to check the agent's result before you commit or open a pull request.
A committed file can remain in **Changes** while the branch differs from its base branch.

On an open pull request, files not committed give **Commit and push** priority in the bar.
Commits not pushed, with no files left to commit, give **Push** priority instead.
It replaces Merge and the fix actions until that work is pushed.
Some uncommitted work can exist without a visible diff in this list.
Use `git status` in **Terminal** to inspect it.

## Copy or download content

Use the copy action in a file header to copy its text.
Use **Download** to save its original bytes on your computer.
The header confirms a copy with **Copied**.

If copying or downloading fails, the header asks you to try again.
Read the file successfully before you try its download action.

File reads and downloads have a 5 MiB limit.
Large diffs can also exceed the reader's limit.
Use **Terminal** or ask the agent to inspect a file that is too large.

## Handle unavailable or older data

The file lists update as the workspace reports changes.
If a fresh list is unavailable, a notice can appear beside older saved data.
Before the first successful list, the view can show an unavailable state.

An unavailable list does not prove that the repository is empty.
Use **Try again** when a file read fails.
A file or change that you open while the workspace's computer starts waits for it.
It opens when the computer is ready.
A file or change that already shows stays open.

If a turn says **Changed files unavailable**, open **Changes** to inspect the branch.
That notice describes a missing turn summary.

## Keep secrets out of shared files

Members of your org can open its workspace files.
File content, diff content, and downloads do not hide secret values.
The **Secret** mark on an environment variable does not change this access.

Some file labels can hide an exact secret value on screen.
The browser still receives the real file path.

- [Use Terminal and previews](/docs/terminal-and-previews)
- [Work with pull requests](/docs/pull-requests)
- [Read the security guide](/docs/security)
