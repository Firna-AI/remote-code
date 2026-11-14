# Verify deployed hibernation with existing clients

- **Severity:** Medium. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-10, from branch `calummoore/workspace-open-error`, a post-merge task of its change to hibernate workspace connections.
- **Location:** `worker/native-sockets.ts`, `worker/workspace-lifecycle.ts`, `worker/chat/browser-connections.ts`, `worker/chat/runner-connections.ts`, `worker/chat/runner-channel.ts`, `worker/devices/native-sockets.ts`, `worker/devices/broker-lifecycle.ts`, `worker/features/workspace-alarm.ts`, and the deployed app at `app.conductive.build`.
- **Reason:** This check needs the merged change on the test deployment, an installed Mac app, and a cloud computer with an older runner.

- **Terms:**
  - **Hibernation:** Cloudflare keeps the accepted client sockets of an idle Durable Object open while the object leaves memory. The next event starts a new instance of the object.
  - **Mac broker:** the Durable Object that relays the Mac commands of one user. It uses the same `Workspace` class as each workspace object.
  - **Older runner:** a still-running agent process from before hibernation deployed. Automatic software updates can replace it at a later start. The runner must use runner protocol version 2, because a workspace refuses each other version, as `docs/protocol/version-pins.md` says.
- **Background:**
  - The workspace object accepts the events socket of each browser tab and the runner socket through the hibernation API. The Mac broker accepts the socket of the Mac app in the same way.
  - At a wake, the object restores each open socket from its saved state. It sends no second history, `welcome`, or `device.connected`.
  - The change kept every wire format and protocol version. So browsers, installed Mac apps, and older runners need no update.
  - While the Mac broker sleeps, the platform answers the exact Mac ping `{"type":"device.ping"}` with `{"type":"device.pong"}`. Only a verified Mac broker object sets that answer.
  - The access checks keep their timing. A tab closes within 30 seconds after its user loses access. The runner checks its token before each message and every 15 seconds while it is idle. The Mac session check runs at least every 10 seconds.
  - An open terminal or preview keeps its workspace object active, because its outbound socket to the cloud computer cannot hibernate. So the idle case needs a workspace with no open terminal or preview.
  - Local Miniflare tests kept the original sockets through a forced wake. They do not prove the behaviour of deployed clients or of older runners.
  - The requirements are in `docs/protocol/chat-and-events.md`, `docs/protocol/agent-runner.md`, `docs/protocol/desktop-app.md`, `docs/protocol/agent-tools.md`, `docs/protocol/access-and-security.md`, and `docs/protocol/operator-actions.md`.
- **Task:**
  1. Find a still-running protocol 2 runner from before hibernation deployed. Record its release and process start time. Do not restart it before steps 2 to 7. Close its terminal and previews. Open it in a browser tab and in the Mac app. If no older process remains, record that case as blocked.
  2. Leave the workspace idle for some minutes. The platform decides when an idle object leaves memory, so this check cannot force a wake.
  3. Send a message. Check that each open tab gets each new event once and in order. Check that the agent answers once.
  4. Open a file and a diff of the workspace. Check that each one opens.
  5. Let the agent ask for a Mac command. Check that the Mac app shows one request. Choose Always allow, and check that the result reaches the agent.
  6. In This Mac of the Mac app, remove that command. Check that This Mac shows the result of the change.
  7. Reload the tab. Check that it gets the history once, then the live events.
  8. Stop and resume the workspace. Record the active release again, because a software update can now apply. Check that chat shows each event once after reconnection. This step checks the resumed release, which can differ from the older process of steps 2 to 7.
  9. Quit and reopen the Mac app while a Mac command request waits. Check that the request ends as not available, and that the new connection gets the next request.
  10. Sign out in the browser. Check that the tab closes within 30 seconds. Sign out in the Mac app, and check that its Mac becomes not available.
  11. With an operator account, suspend the owner of a test workspace. Check that its runner connection closes, and that each open tab of that owner closes within 30 seconds.
- **Impact if no action:** Local native tests stay the only evidence that deployed browsers, installed Mac apps, and older runners work with hibernation.
- **Needs:**
  - The merged change on the test deployment. Each push to `main` deploys it, as `docs/automatic-deploys.md` says.
  - A GitHub account with app access, as `docs/protocol/waitlist.md` says, and an org with a test workspace.
  - The Mac app from a published release before this change, such as `0.3.0`, signed in with that account.
  - A workspace with a still-running protocol 2 runner from before hibernation deployed. Its active version must be checked directly.
  - For the suspension step only, an operator account, which the `OPERATOR_GITHUB_IDS` setting of the deployment names.
- **Done when:** Each step passes on the deployed app. The record names the browser, the Mac app version, the org image build of the cloud computer, the workspace, each action, and its result. Each defect gets its own follow-up item. The record holds no credential, token, or personal data.
- **Related:** [measure-deployed-durable-object-idle-usage.md](measure-deployed-durable-object-idle-usage.md): the other post-merge task of the same change. The two tasks need no fixed order.
