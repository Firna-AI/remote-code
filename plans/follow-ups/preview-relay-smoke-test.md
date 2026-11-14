# Smoke-test the preview relay in a real sandbox

- **Severity:** Medium. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Post-merge task.
- **Added:** 2026-11-10, from branch `calummoore/port-preview-error-v2`, the post-merge tasks of the plan for the preview relay.
- **Location:** `crates/cnd-relay/src/headers.rs`, `worker/previews/relay.ts`, `image/release/conductive-preview-relay.service`, and `image/conductive-preview-relay.socket`.
- **Reason:** The check needs the deployed Worker, a published release with the relay, and a real test sandbox.

- **Terms:**
  - **Preview relay:** the service `conductive-preview-relay.service` in each sandbox with current software. It listens on `127.0.0.1:7682`, and it gives each previewed server `Host: localhost:<port>`.
  - **Org image:** the saved snapshot that each new sandbox of an org starts from. A build installs the current release. An existing sandbox also gets the relay through an automatic update at a later runner start.
- **Background:**
  - A dev server with a Host check refuses a `Host` that is not local. Before the relay, `mokly serve` answered every preview request with 403 `{"code":"forbidden","message":"Use the local catalogue address."}`. Vite blocks such requests with "Blocked request. This host is not allowed."
  - The user chose the relay on 10 November 2026. The user also chose that a sandbox without a running relay refuses previews with 409 `preview_relay_unavailable` and the message "Previews need newer cloud computer software. Start a new workspace after an admin runs Build computer."
  - The relay answers only a request whose `Host` matches `<label>-7682.on.boat.dev`. Boat's hosting docs tell Vite users to allow `.on.boat.dev`, so that hostname should reach the sandbox. No test runs against the real Boat edge, so this is still an assumption.
  - The relay adds `X-Conductive-Relay: 1` to each of its answers. The Worker replaces each answer without the mark with its own unavailable error.
- **Task:**
  1. After deployment, confirm that the current release is active in a disposable test workspace. Use an automatic update at a later normal start, or a new workspace from a new build.
  2. In that workspace, run `mokly serve` on `127.0.0.1:4173`, and a Vite dev server with its default settings.
  3. Open a preview of each port. Check that the page loads, that live reload works, and that a form POST or a render request of the Mokly controls works.
  4. Run `systemctl is-active conductive-preview-relay.service` in the terminal. It answers `active`.
  5. Stop `conductive-preview-relay.service` and `conductive-preview-relay.socket` in that disposable workspace. Open a preview and check HTTP 409 `preview_relay_unavailable` with the refusal message above. Restart both units, then confirm that previews work again.
- **Impact if no action:** If Boat sends another `Host` value to the sandbox, the relay refuses every preview with 403, and nobody notices until a user opens a preview.
- **Needs:** The deployed release, a disposable test workspace with its relay active, and permission to stop and restore its relay units.
- **Done when:** Both previews work with the current release. A deliberate relay outage shows the refusal. Restore both units after the check. Then delete this item. If the real Host fails, record its value and fix the pattern in `crates/cnd-relay/src/headers.rs`.
