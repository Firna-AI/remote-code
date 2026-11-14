# Idle-boundary wait has no deadline

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-11, from peer review of PR #245, finding 1.
- **Location:** `crates/cnd-runner/src/engine/background.rs`, `crates/cnd-runner/src/engine/input.rs`, `crates/cnd-runner/src/engine/results.rs`, and `crates/cnd-runner/src/engine/actor.rs`.
- **Reason:** The failure is Rare and Medium, and the fix has no migration or other cost that grows after merge.

- **Terms:**
  - **Idle signal:** the program's message that no reply runs. The adapter uses it to protect a queued notification reply.
  - **Hold:** the runner keeps the turn after a reply while it waits for that signal.
- **Background:** A live-work wait sets a deadline and timer. A hold after the live work ended can set neither. An earlier timer also requires `waiting` to be true before it ends the turn.
- **Problem:** If no later idle signal arrives, this hold can run without a bound. Work that started and ended inside the first reply leaves the deadline null.
- **Impact if no action:** The active turn can keep its sandbox and turn token until Stop or shutdown. The Worker's running-turn heartbeat prevents the normal idle stop.
- **Root question:** How does a held turn end within a bound when the runner never learns that the agent is idle?
- **Options:**
  - **A.** Add a short grace, such as 60 seconds, and finish if the hold remains. It adds an end rule not covered by the approved contract. Effort: Small.
  - **B.** Count this state as a wait under the existing 30-day rule. Set `waiting`, deadline and timer through a common path. Use the existing limit end reason. Effort: Small.
  - **C.** Do A and log the missing signal. It has the same new boundary policy and can cut a queued reply that sent no running signal. Effort: Small.
  - **D.** End after a chosen quiet period, with any program output cancelling the timer. It needs adapter progress events and a new approved time value. Effort: Medium.
  - **E.** Add an absolute ceiling after the limit plus a chosen margin, including active replies. It bounds every hold but changes the approved no-cut rule. Effort: Medium.
- **Left out:** Immediate completion at a result can kill a queued notification reply. The SDK's internal ten-minute ceiling sends no host event or process close for this open input stream.
- **Wider fix:** E bounds every hold, but it changes an approved requirement and needs a user decision. C guards one state and adds a log.
- **Previous examples:** None found.
- **Recommendation:** B. It uses the existing count and end rule. The peer review recommended C before the options check.
- **Action:** fix after merge, apply B. The bug is Rare and Medium, and its fix costs the same after merge.

## Evidence and limits

- A result with live work sets the deadline and arms the timer.
- When work was observed but already ended, `reply()` can return `wait` without setting `waiting`, a deadline, or a timer.
- A running turn keeps the Worker's five-minute heartbeat. It does not reach the thirty-minute idle stop.
- The SDK ceiling defaults to ten minutes, but its expiry closes stdin only for a string prompt. The runner uses an open `ClaudeInputWindow` iterable.
- The ceiling therefore sends no host event and does not close this process or bound this hold.
- The exact SDK pin is 0.3.318. Its real-program proof received every expected idle signal.
- Missing idle with this pin was not reproduced. A lost event or a future internal state-flag change is the failure assumption.
- The protocol already allows the limit end when no live work remains after a reply. Option B uses that approved rule.
- A/C add a new short end. D adds a quiet-period policy. E permits a reply cut after a margin. Those changes need a user decision before implementation.

## Related cases to verify during future work

- Location: `runner/sdk-helper/src/providers/claude-background.ts:22`, `runner/sdk-helper/src/providers/claude-events.ts:41`, and `crates/cnd-runner/src/engine/background.rs` and `crates/cnd-runner/src/engine/results.rs`.
  A static reading suggests a queued notification reply can follow the result after a task ended inside that first reply.
  If so, `waited` is false, its result is ignored, its Stop hook clears `replied`, and final idle cannot end the hold.
  No real run reproduced this order. Do not treat it as a confirmed defect without that evidence.
- Location: `crates/cnd-runner/src/engine/background.rs` and `crates/cnd-runner/src/engine/actor.rs`.
  The same static reading suggests a reply can send no new running frame.
  Then `waiting` might stay true and allow the deadline to cut that reply.
  No real run reproduced that order. It remains unconfirmed.

The Rust port keeps this wait path. `Background::reply` returns `Wait` when work was observed and idle is false, without setting `waiting` or a deadline. The actor arms the background timer only when `waiting` is true. The two related cases above still need a real-program reproduction. Future work must keep the approved same-turn notification and no-cut rules.
