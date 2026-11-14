# Check the context folder with a new runner

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-10, from the post-merge follow-up of the plan `plans/repository-context-folder.md`, branch `calummoore/repo-context-attachments`.
- **Location:** the section Attachments of `docs/protocol/messages-and-attachments.md`, the section The context folder of `docs/protocol/repository-folders.md`, the section What the instructions hold of `docs/protocol/agent-instructions.md`, the deployed app, and a cloud computer from a new org image.
- **Reason:** the check needs the merged Worker on the deployed app, and a real cloud computer from an org image that a build made after that deploy.

- **Terms:**
  - **Context folder:** the folder `.context` at the top of the workspace's repository folder. Git ignores it. Attached files go to its folder `attachments`.
  - **Runner:** the agent runner, the program of the app in each cloud computer. It runs the agents and reports the files of the workspace.
  - **Org image:** the prepared cloud computer image of an org. Each build installs the newest runner. Existing computers receive newer runners through automatic software updates at a later start.
  - **Local exclude file:** the ignore file of one Git repository, `info/exclude` in its Git folder. Git does not track it.
  - **Read line:** the line that the runner adds after the words of the member in each message with files.
- **Background:**
  - On 10 November 2026, the user chose the rules below.
    [Attachments](../../docs/protocol/messages-and-attachments.md#attachments)
    and
    [The context folder](../../docs/protocol/repository-folders.md#the-context-folder)
    state them.
  - When a turn starts, the Worker copies each attached file to `<repository folder>/.context/attachments/<digest>/<safe name>` (decision 242). The digest has 32 lowercase hexadecimal characters, from the IDs of the message and the file.
  - The safe name keeps ASCII letters, digits, dots, underscores, and hyphens. One hyphen replaces each run of other characters. The extension is in lowercase. So `Context Check.TXT` becomes `Context-Check.txt`.
  - Before the first file of each copy, the Worker writes `.context/attachments/.gitignore` with the one rule `*`.
  - At each start, before its first file report, a new runner adds the line `/.context/` once to the local exclude file (decision 243). Then it makes `.context/` and `.context/attachments/`.
  - The runner runs as the user `user`, as `image/release/conductive-runner.service` says. So that user owns both folders. The provider must then write the copied files into folders that it did not make.
  - The agent instructions of a new session give the absolute path of the context folder. They say that Git ignores it, and that attached files arrive in its attachments folder. They tell agents to keep notes, screenshots, and files for other sessions there.
  - A session keeps the instructions that it started with. So only a new session shows this text.
  - After the words of the member, each message with files gets one read line, then one line for each file (decision 244). The user chose the read line "The sender attached these files. Read each file before you answer."
  - Each file line holds one JSON object with `name`, `mediaType`, `path`, and `sizeBytes`. The path is absolute. `runner/sdk-helper/src/providers/instructions.test.ts` holds the exact text that the runner sends.
  - Codex also gets each image as image input. For a message with an image, its read line adds "Each image is also in this message."
  - Changes leaves out each file that Git ignores. All files still lists each file of the context folder, also the ignored ones.
  - The Worker tests use fake upload servers that model no folders. So they do not prove that the real provider makes the missing digest folder, or that it can write into the folders of the runner.
  - The runner tests use a temporary repository, not a real cloud computer.
- **Task:**
  1. Wait until the `Deploy` run of the merge commit passes.
  2. Sign in at `https://app.conductive.build` as the admin of a test org. On the Cloud computer tab of the org settings, press **Build computer**. Wait until the build succeeds. Check the installed release and context-folder behavior before continuing. Existing computers can also receive this runner through an automatic update.
  3. Create a new workspace from that image. Send its first message to a Claude model, with no file. Wait until the workspace is ready.
  4. Open the Terminal tab. Run these commands, and check each result:
     - `pwd` prints the repository folder, such as `/home/user/code/<name>`. This item calls it `<repository folder>`.
     - `grep -c -x -F '/.context/' "$(git rev-parse --git-path info/exclude)"` prints `1`.
     - `stat -c '%U %n' .context .context/attachments` prints `user` for both folders.
     - `ls -A .context/attachments` prints nothing. No copy ran yet, so the runner made both folders.
  5. On the device that uploads the files, make the file `Context Check.TXT` with one line: `The code word is <word>.` Choose a new `<word>`, such as `marigold-47`.
  6. Record the SHA-256 and the size in bytes of that file. On a Mac, use `shasum -a 256` and `stat -f %z`. On Linux, use `sha256sum` and `stat -c %s`.
  7. Also make a small picture, such as a screenshot, and name it `Screen Shot.PNG`.
  8. In the Claude session of step 3, send: "Which context folder do your instructions name, and what do they say about it?" Check that the answer gives `<repository folder>/.context` and the facts of the background.
  9. In the same session, attach `Context Check.TXT` with **Attach files**. Send: "What is the code word? Then quote, word for word, each line of this message after my words." Check these results:
     - The answer gives the code word. Only the file holds it, so the agent read the file.
     - The quote gives the read line, then one file line.
     - The file line gives the path `<repository folder>/.context/attachments/<digest>/Context-Check.txt`. The digest has 32 lowercase hexadecimal characters.
     - The `sizeBytes` of the file line is the size from step 6.
  10. In the Terminal, check these results:
      - `find .context -type f` prints `.context/attachments/.gitignore` and the file of step 9.
      - `cat .context/attachments/.gitignore` prints `*`.
      - `sha256sum` and `stat -c %s` of the file give the SHA-256 and the size from step 6.
      - `git status --porcelain --untracked-files=all -- .context` prints nothing.
      - Record the owner of the digest folder and of the file with `stat -c '%U %n'`. The provider made them, and no rule names their owner.
  11. In the app, open **Changes**. Check that it lists no file in `.context`. Open **All files**. Check that it lists the attached file in `.context/attachments/`.
  12. In the Claude session, send: "Save a short note for other sessions of this workspace in the context folder. Tell me its path." In the Terminal, check these results:
      - `stat -c '%U %n' <note path>` prints `user` and a path in `.context/`.
      - `git check-ignore -v <note path>` names the rule `/.context/` in `.git/info/exclude`.
      - `git status --porcelain --untracked-files=all -- .context` still prints nothing. **Changes** still lists no file of `.context`.
  13. Start a new Codex session in the same workspace. Send: "Quote the note that another session saved in the context folder." Check that the answer quotes the note of step 12.
  14. In the Codex session, attach `Screen Shot.PNG`. Send: "Describe the picture in one sentence. Then quote, word for word, each line of this message after my words." Check these results:
      - The description fits the picture.
      - The read line also gives "Each image is also in this message."
      - The file line gives the path `<repository folder>/.context/attachments/<digest>/Screen-Shot.png` with a new digest, and a `sizeBytes`.
  15. In the Codex session, attach `Context Check.TXT` again, and send the message of step 9. Check that the answer gives the code word. Check that its read line has no sentence about images.
  16. Save the replies, the command output, and the deployed commit under `.context/` of the workspace that runs this check. Leave out each credential.
- **Impact if no action:** The tests use fakes and a temporary repository. A fault that only the real provider shows can fail each message with files in new workspaces. It can also put attached files and notes in Changes and commits. Nobody sees such a fault until a member attaches a file.
- **Needs:** The merged change, deployed to `conductive.build` by the `Deploy` workflow. The admin of a test org with one repository that has the GitHub App. Claude and Codex logins of that account. A device that can make the test files and compute a SHA-256.
- **Done when:** Every check of steps 4 and 8 to 15 passes on the deployed app. A failed check gets its own follow-up item, and this item stays open until a rerun of that check passes. Then delete this item.
- **Related:**
  - `plans/follow-ups/context-attachments-live-older-runner.md` checks attached files with an older runner. It needs a running protocol 2 runner from before context-folder support, with no intervening software activation. Run it before changing that workspace.
  - `plans/follow-ups/agent-instructions-deployed-smoke-test.md` also checks the agent instructions of new sessions on a new org image. One session can run both items, and each keeps its own checks.
  - `plans/follow-ups/runner-archive-from-deploy-check.md` checks that a new image build installs the verified sandbox release of the deploy. A failure there also fails step 2.
