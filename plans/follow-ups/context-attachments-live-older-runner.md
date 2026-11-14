# Check attached files with an older runner

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-10, from the post-merge follow-up of the plan `plans/repository-context-folder.md`, branch `calummoore/repo-context-attachments`.
- **Location:** the section Attachments of `docs/protocol/messages-and-attachments.md`, the section The context folder of `docs/protocol/repository-folders.md`, the deployed app, and a cloud computer whose running protocol 2 runner predates context-folder support.
- **Reason:** the check needs the merged Worker on the deployed app, and a still-running protocol 2 runner without context-folder support. An older image does not prove the active runner version.

- **Terms:**
  - **Context folder:** the folder `.context` at the top of the workspace's repository folder. Attached files go to its folder `attachments`.
  - **Runner:** the agent runner, the program of the app in each cloud computer. It runs the agents and reports the files of the workspace.
  - **Org image:** the prepared cloud computer image of an org. Each build installs the newest runner. Automatic software updates can replace the runner at a later start.
  - **Older runner:** a running process from before context-folder support. It does not know the context folder. It must use runner protocol version 2, because a workspace refuses each other version, as `docs/protocol/version-pins.md` says. So the build must come after the runner moved to version 2 on 10 November 2026.
- **Background:**
  - On 10 November 2026, the user chose that the Worker copies each attached file into the repository folder of the workspace (decision 242).
    [Attachments](../../docs/protocol/messages-and-attachments.md#attachments)
    states the rules.
  - When a turn starts, the Worker copies each file to `<repository folder>/.context/attachments/<digest>/<safe name>`. The digest has 32 lowercase hexadecimal characters, from the IDs of the message and the file.
  - The safe name keeps ASCII letters, digits, dots, underscores, and hyphens. One hyphen replaces each run of other characters. The extension is in lowercase. So `Context Check.TXT` becomes `Context-Check.txt`.
  - The Worker sends the absolute path of each file to every runner, also to an older runner.
  - Before the first file of each copy, the Worker writes `.context/attachments/.gitignore` with the one rule `*`. The user chose this so that Git ignores the files also under an older runner.
  - At each start, a new runner adds `/.context/` to the local Git exclude file and makes the folders, as [The context folder](../../docs/protocol/repository-folders.md#the-context-folder) says. An older runner does neither. It also adds no read line and no size to a message with files.
  - So under an older runner, the provider makes `.context/`, `.context/attachments/`, and the digest folder at the first upload. Only the `.gitignore` of the Worker keeps the files out of Changes.
  - All files and Changes leave out each file that Git ignores. Members find such files in the Terminal.
  - The Worker tests use fake upload servers that model no folders. So they do not prove that the real provider makes missing folders.
  - A message that a workspace accepted before the deploy keeps its old hidden path in the home folder. Its copy fails once, and Try again gives it the new path. So send each test message after the deploy.
  - Under an older runner, a note that an agent writes in `.context/` shows in Changes. This is an accepted limit, so this item does not check notes.
- **Task:**
  1. Wait until the `Deploy` run of the merge commit passes.
  2. Find a still-running protocol 2 process from before context-folder support. Record its release and process start time. Do not stop, resume, or restart that workspace before this check ends. A later start can bootstrap or activate newer software. If no such process remains, record this case as blocked.
  3. Open a new session in that running workspace. Send a message to a model of either agent, with no file. Keep its cloud computer running.
  4. Open the Terminal tab. Run these commands, and check each result:
     - `pwd` prints the repository folder, such as `/home/user/code/<name>`. This item calls it `<repository folder>`.
     - `grep -c -x -F '/.context/' "$(git rev-parse --git-path info/exclude)"` prints `0`. A `1` shows context-folder support, so choose another running older workspace.
     - `test -e .context && echo present || echo absent` prints `absent`.
     - `git check-ignore -v .context/attachments/probe` prints nothing. So no rule of the repository hides the folder.
  5. On the device that uploads the file, make the file `Context Check.TXT` with one line: `The code word is <word>.` Choose a new `<word>`, such as `marigold-47`.
  6. Record the SHA-256 and the size in bytes of that file. On a Mac, use `shasum -a 256` and `stat -f %z`. On Linux, use `sha256sum` and `stat -c %s`.
  7. In the session of step 3, attach the file with **Attach files**. Send: "What is the code word? Then quote, word for word, each line of this message after my words." Check these results:
     - The answer gives the code word. Only the file holds it, so the agent read the file.
     - The quote gives one file line with the path `<repository folder>/.context/attachments/<digest>/Context-Check.txt`. The digest has 32 lowercase hexadecimal characters.
     - The quote has no read line and no `sizeBytes`. This shows that the runner is older.
  8. In the Terminal, check these results:
     - `find .context` prints `.context`, `.context/attachments`, `.context/attachments/.gitignore`, the digest folder, and the file.
     - `cat .context/attachments/.gitignore` prints `*`.
     - `sha256sum` and `stat -c %s` of the file give the SHA-256 and the size from step 6.
     - `git check-ignore -v <file path>` names the rule `*` in `.context/attachments/.gitignore`.
     - `git status --porcelain --untracked-files=all -- .context` prints nothing.
     - Record the owner and the mode of each folder and of the file with `stat -c '%U %a %n'`. The provider made them, and no rule names their owner.
  9. In the app, open **Changes** and **All files**. Check that neither lists `.context` or a file in it.
  10. Save the replies, the command output, and the deployed commit under `.context/` of the workspace that runs this check. Leave out each credential.
- **Impact if no action:** Workspaces from older org images get attached files at the new path at once after the deploy. If the provider does not make the missing folders, each message with files fails its turn there. If the `.gitignore` of the Worker does not work, attached files show in Changes, and a commit of all changes can take them in.
- **Needs:** The merged change, deployed to `conductive.build` by the `Deploy` workflow. A test org with a still-running protocol 2 runner without context-folder support and one repository that has the GitHub App. A Claude or Codex login of the test account. A device that can make the test file and compute a SHA-256.
- **Done when:** Every check of steps 4 and 7 to 9 passes on the deployed app. A failed check gets its own follow-up item, and this item stays open until a rerun of that check passes. Then delete this item.
- **Related:** `plans/follow-ups/context-folder-live-new-runner.md` checks the same files with current software. Run this older-process check before any software activation in that workspace. Record the active release and process start time as evidence.
