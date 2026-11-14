# Tool detail cuts precede env filtering

- **Severity:** High. **Effort:** Large. **Confidence:** High. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-10, from the second review check of preview port detection, outside its scope.
- **Location:** `crates/cnd-runner/src/filter/service.rs`, `crates/cnd-runner/src/limits.rs`, `crates/cnd-runner/src/link/connection.rs`, and `worker/chat/runner-output.ts`.
- **Reason:** This is the existing tool-detail path, which the port-report change does not alter.

- **Source:** Review.
- **Category:** Security.
- **Terms:**
  - **Runner:** The program in a workspace cloud computer that sends agent output to the Worker.
  - **Worker:** The backend that filters and stores workspace events.
  - **Marked env value:** An org env var value marked secret at the last cloud computer start.
  - **Tool detail:** The text of a tool update, such as command output, in `tool.updated`.
- **Background:** The runner hides known workspace tokens and agent logins before it bounds tool details. The Worker separately hides marked env values. The runner does not receive the private list of marks. `docs/protocol/tokens-and-secrets.md` requires the Worker to hide exact secret values before it stores or sends displayed output.
- **Problem:** The runner calls `limits::bound_event` before the Worker sees an event. Its `detail_prefix` helper keeps a prefix within the 64 KiB tool-detail budget. A marked env value can cross that cut. The Worker then receives only its prefix and cannot match the complete value. That app-created fragment can enter workspace history and browser output.
- **Evidence:** `FilteredEmitter` in `crates/cnd-runner/src/filter/service.rs` filters known runner credentials. The link in `crates/cnd-runner/src/link/connection.rs` then calls `limits::bound_event` before it saves the event. `detail_prefix` in `crates/cnd-runner/src/limits.rs` bounds `tool.updated.detail`. `worker/chat/runner-output.ts` applies the captured marked env values only after receipt. For example, a complete value `secretpass` that starts five characters before the retained detail ends leaves `secre`. The exact-match filter cannot match `secretpass` in that prefix. Place the value relative to the helper's retained byte boundary, including its JSON-string byte accounting.
- **Impact if no action:** The app can store part of a marked secret in tool history and send it to every authorized browser replay.
- **Root question:** How can large tool details keep exact marked values protected before displayed excerpts?
- **Options:**
  - **A.** Carry complete tool-detail source through a private bounded stream. Apply the Worker's exact secret filter across private chunks. Then keep the required displayed prefix and omitted-byte count. Preserve envelope bounds, order, replay, and failure recovery. Effort: Large.
  - **B.** Deliver the captured marks and secret values to the runner, filter complete details there, and keep Worker filtering. This changes the rejected runner-mark design and needs a user decision. Effort: Large.
  - **C.** Mask possible secret prefixes at the retained boundary. This can hide ordinary text and changes exact-copy masking behavior. It needs a user decision. Effort: Large.
- **Left out:** Dropping every large detail loses the required longest prefix. Keeping the early cut leaves the defect. A fixed fragment length still misses shorter fragments.
- **Wider fix:** A. A complete-source private stream keeps secret matching before every displayed tool-detail excerpt.
- **Previous examples:** The workspace-title path once cut before filtering. The preview-port change found and corrected the same order in its new label path. This item concerns the unchanged tool-detail path.
- **Related:** [Credential fragments](credential-parts-in-runner-output.md) records arbitrary parts of credentials known to the runner. This item concerns the later Worker filter for marked org values. They share an early-cut cause but have different secret sources and transport needs.
- **Recommendation:** A. It preserves exact matching, displayed details, and the existing separation of runner and Worker secret sources.
- **Action:** fix after merge, apply A, because this existing path needs a separate change with its own private-stream design and checks.
