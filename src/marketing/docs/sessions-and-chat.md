---
title: Sessions and chat
description: Send tasks and follow-up messages, choose models, and manage conversations that share a workspace's files and branch.
group: Work
order: 20
---

## Start a conversation

A session is one agent conversation in a workspace.
The first message of a new workspace creates its first session.
Select **+**, named **New session**, to start another conversation.

Sessions in the same workspace share its cloud computer, files, and branch.
Use a separate workspace when a task needs a separate copy of the files.

You need a connected login for the agent you choose.
Other members can also send messages under the session's login-sharing rules.

An archived workspace offers read-only chat instead of a message box.
Restore the workspace before starting a session or sending another message.
Restore is available for 14 days after Archive while its computer is kept.
Select **Resume** if the restored workspace is already open.

- [Create a workspace](/docs/workspaces#create-a-workspace-from-a-message)
- [Connect an agent login](/docs/agent-logins)
- [Restore an archived workspace](/docs/workspaces#restore-an-archived-workspace)

## Send a message

1. Open the session's tab.
2. Choose a model and effort in the message box.
3. Write your message.
4. Use **Attach files** if the agent needs a file or picture.
5. Select **Send**.

On a computer, **Enter** sends the message.
Use **Shift+Enter** to add a line.
On a phone, **Enter** adds a line.
Your message appears in the chat at once.
The chat scrolls down to it, also when you read an earlier part of the chat.
If it cannot send, it goes back to the message box, and the chat shows the cause.

You can send a message while the workspace's computer starts.
The chat shows the steps of that start.
The workspace keeps accepted messages for the agent.

The org must have a successful build before you create a new workspace.
That first build is separate from the start of an existing workspace's computer.

## Attach files

Use **Attach files** to pick files, or drop files into the message box.
In a workspace chat, you can drop files anywhere on the chat, also on the transcript or the session tabs.
The chat, **New workspace** page, and **New workspace** dialog all accept files.
Each file appears as a file chip, a small box in the text.
The chip shows the file's name and upload state.

A picked file goes at the text cursor, or at the end if the field has no cursor.
A file dropped on the text goes where you drop it.
A drop elsewhere uses the text cursor or the end.
The text cursor then moves after the new chips.

Each file can be up to 100 MB.
Wait for uploads to finish before you send.
If an upload fails, use **Try again** or remove its chip.
Removing a chip takes its file off the draft.
Undo brings back the chip and its file.

To attach a folder, drop it into the message box.
Your browser zips the folder before the upload, so the folder becomes one `.zip` file chip.
The zip holds every file and folder in it, also hidden files.
The zip can be up to 100 MB, as each file can.
If the browser cannot read the folder, use **Attach files** in the notice to pick its files.

Each chip keeps its place in the sent message.
When the message reaches the agent, select its file chip to open the copy.
The copy opens in the workspace's file view.
This can start a stopped cloud computer.
Restore an archived workspace before opening its attached files.

Attached files arrive in `.context/attachments/` in the workspace's repository folder.
Each file keeps the same path when you retry its message.
With current cloud computer software, workspaces also get a `.context/` folder for agent notes, screenshots, and files for other sessions.
Git ignores the folder's files unless your repository already tracks them.
**All files** lists them, so you can open them there.
**Changes** does not list them.
An older workspace gets this folder and its file list with an automatic software update at a later start.

- [Read files and pictures](/docs/files-and-changes#read-a-file)

## Use pull request actions in chat

Open the session you want before selecting an agent action in the pull request bar.
The action sends a fixed message from you to the session you viewed last.
It uses that session's model, effort, **Fast** setting, and login rules.
This also works while you view a file or **Checks**.

Your draft, attached files, and uploads stay as they were.
The action's message appears in chat as your message.
During a turn, it follows the same rules as a message you send from the box.
If it cannot send, the chat opens and shows the cause.

- [Choose a pull request action](/docs/pull-requests#read-the-pull-request-state)

## Delegate work to another session

Ask an agent to create or list sessions, send a message, or read a transcript.
It can also inspect one session or message.
Its workspace tools reach every workspace of the same org.
Agents can also rename, stop, and close sessions there.
Closing a running session through the tools can stop its turn.
Use a separate workspace when the delegated task needs separate files and a branch.

Messages from agent tools end with a `---` line and **Sent by:** with a link to the sending session.
This also applies to the first message when an agent creates a workspace or session.
The link shows the workspace's state, number, a session icon, and the session title in a small box.
A session without a title shows **Untitled**.

Select the link to open that session.
A closed or unknown session opens the workspace page without reopening the session.
If that workspace is already open, its selected tab stays.
The title of a session in another workspace updates when the chat loads.
Session links also show as small boxes in agent answers and pasted message drafts.
A member can type the same **Sent by:** line, so it does not prove who wrote a message.

An agent can read archived workspaces and closed sessions.
It cannot send messages to an archived workspace or a closed session.
Use **Stop** in each affected session if agents keep replying to each other without useful work.

- [Get the current workspace tools](/docs/cloud-computer#apply-setup-changes)
- [Understand what agents can reach](/docs/security#understand-what-agents-can-reach)

## Choose a model

Each session has its own model and effort picker.
A different model of the same agent keeps the conversation in that session.

A model of the other agent opens a new session when the session has messages.
Your draft moves to it.
The earlier conversation stays in its original session.
The new session starts without a copy of that conversation.
In a session with no messages, a model of the other agent stays in that session.

Some models offer **Fast** at the end of the picker's menu.
Turn it on for faster output.
Fast output can cost more on the session's login.
The picker then shows **Fast** after the effort.
Press **⇧⌘E** on a Mac or **Ctrl+Shift+E** on another computer to turn it on or off.
**Fast** stays on for later messages in the session until someone turns it off.
Choosing a model without **Fast** turns it off.

A turn with **Fast** on can still run at standard speed, for example when the agent reaches its fast limit.
The turn then continues, and its end shows **Standard speed** with the cause.
**Fast** stays on, so later turns run fast when the cause ends.

If the chosen agent has no usable login, the message box offers **Connect** for that agent.
Connect the login in **Account** before you send.

For your own endpoint login, your pickers hide app models that its last successful model list does not name.
They show all app models for the agent before the first successful read, or when the list names none of them.
The session keeps its current model.
Other members' pickers still show all app models.

- [Refresh an endpoint's model list](/docs/agent-logins#keep-the-model-list-current)

## Guide or stop a running agent

Send another message to guide the agent while it works.
When your message uses the session's available login, it joins the running turn.
A turn is one period of work by the agent.

An agent powered by Claude can leave work running in the background, such as a command that watches pull request checks.
After its reply, the turn stays open while background tasks or scheduled wake-ups remain.
The chat shows **Working**, and **Stop** stays available.
When a task ends or a wake-up arrives, the agent continues in the same turn.
The turn ends when the agent finishes and no background work remains.

The time limit is 30 days from the start of the first wait.
The agent's work after a notification also counts toward that limit.
A message that joins the turn during a wait starts the count again from that message.
If the limit passes during a reply, that reply finishes before the turn ends.
At that limit, the turn ends with **Background work stopped at the time limit** above its duration and changed files.
The cloud computer keeps running while the turn waits.
Ask the agent to stop background work that it does not need, such as a dev server.

Select **Stop** to interrupt the turn, including a wait for background work.
The chat records the stop.
You can send another message to continue the conversation.

A stop through an agent's tools shows **Stopped from** and a link to the sending session.
The link uses the same small box as the **Sent by:** line.
A close through the tools that stops a turn uses the same stop line.

The agent's earlier work folds into a line when a turn ends.
Select that line to inspect its messages and tool calls.
The answer stays visible beside it.

## Read replies and tables

Agent replies can contain headings, paragraphs, lists, code, and tables.
A wide table scrolls sideways inside the message.
The text around it keeps the width of the chat.
To copy a code block, select **Copy code** in its top corner.
With a mouse, the button shows when you point at the block.
**Code copied** confirms the copy.

While a reply arrives, the chat shows its headings, text, and table rows as they arrive.
In the folded work of a turn, open a message line to read its table.

## Manage session tabs

Use a tab's menu to rename or move it, or to copy its link.
Open the menu with a right click on a computer.
You can also use **Shift+F10** while the tab has focus.
On a phone, use a long press.

- **Rename session** changes the tab's title.
- **Copy link** copies a link that opens the workspace with that session shown.
- **Move left** and **Move right** move it one place.
- Drag a tab to place it elsewhere in the row.

File and diff tabs share the row on a computer.
A phone shows the session tabs there.

Each tab in the row keeps your place when you open another tab or another workspace.
A session tab returns to the message you read.
If you were at the end of the chat, it shows the newest messages.
Closing a tab or reloading the page forgets these places.

Closing a session keeps its conversation in **Session history**.
If its agent is working, closing asks first because it stops the turn.
Open **Session history** to reopen the conversation.

After a merge, **Continue** keeps these sessions and their conversation context on the workspace's new branch.
Each session shows a note with the member who continued, the new branch, and its starting branch.
With current agent software, later messages tell the agent the current branch names when they change.

- [Continue after a merge](/docs/workspaces#continue-after-a-merge)

## Copy a transcript

Copy a session's whole conversation as Markdown for another agent or a document.

1. Open the session tab's menu with a right click.
   On a phone, use a long press.
2. Select **Copy concise transcript** or **Copy full transcript**.
3. Paste the text where you need it.

**Copy concise transcript** keeps the default folds closed.
While the agent works, its newest run of tool calls stays open.
After a turn ends, a run outside its folded work stays open if one of its calls stopped or failed.
**Copy full transcript** includes the messages and work inside every fold.
The copy uses each attached file's name where its chip appears.

Agents can read the same transcript text through their workspace tools.
The read uses the concise text by default and can request the full text.
A long read returns part of the transcript, with its line range and a way to read earlier lines.
For a stop through an agent's tools, the transcript gives **Stopped from** and the sending session's link.

You can copy another tab's conversation without changing the selected tab.
Both options work in archived and other read-only workspaces.

For a closed session, reopen it from **Session history** before copying.

If the copy fails, open the menu again.
Select the same copy option within one minute to retry.

## Know whose account a session uses

The member who starts a session supplies its agent login.
A subscription token or provider API key bills model use to that member's connected account.
On an own endpoint login, model use bills where the endpoint's owner runs it.
The endpoint gets the messages, files, and command results of each turn on that login, whoever sent the message.

If that member shares the login, other members' messages use it too.
The message box names that member's login when you use it.
It uses the same login label for an own endpoint.
The chat does not show the endpoint's host.

If the login is private or unavailable, your message starts a new session on your own login.
That session links back to the earlier conversation.
It has no copy of the earlier history.

Any member who can send in a session can change its model, effort, and **Fast** setting.
That choice also applies to the messages of the member whose login the session uses.

GitHub operations follow the person whose message started the running turn.
Commits name that person as both author and committer.
In a workspace with older cloud computer software, agent commits name the workspace owner.
Mac command requests go to that same person's connected Mac.
They can differ from the member whose agent login the session uses.
The agent can identify the member who sent each message.
Another member's message during a turn does not change its GitHub account, commit author, or receiving Mac.

An agent tool creates a session or sends a message as the sender of its calling turn.
That sender must still belong to the org.
A new session uses their login.
A message to an existing session follows the same login-sharing rules as a message they send themselves.

- [Choose who can use an agent login](/docs/agent-logins#choose-who-can-use-your-login)
- [Understand account and credential access](/docs/security)

## Recover from an error

If the chat or session history does not load, use its **Try again** action.
If a turn fails, read its error before retrying.
**Try again** retries the newest failed request of that session.

A login or membership change can stop a waiting message from running.
Reconnect the needed login or send a new message under your own login.
Another member's retry can start a new linked session when the earlier login is unavailable.

If a turn says **Changed files unavailable**, inspect **Changes**.
That notice means its changed-file summary is missing.
It does not mean the agent changed no files.

- [Inspect files and changes](/docs/files-and-changes)
