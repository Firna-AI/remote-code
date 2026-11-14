# Try again repeats a model that failed

- **Severity:** Medium. **Likelihood:** Common. **Effort:** Small. **Confidence:** Medium. **Harder later:** No.
- **Kind:** Outside the scope.
- **Added:** 2026-11-10, from the quick mockup of option G of decision 10 of the own endpoint plan on branch `calummoore/cli-proxy-setup`.
- **Location:** `retryMessage` in `worker/chat/send-message.ts`, which sends the message again with `previous.choice`, and the failure text of `failureCause` in `runner/sdk-helper/src/providers/failure.ts`.
- **Reason:** the own endpoint change does not change how Try again picks its model, and a fix changes what Try again does for every failed turn.

- **Terms:**
  - **Try again:** the action on a failed turn in the chat. It sends the same message again.
  - **Choice:** an agent, a model, and an effort, which together say how a turn runs.
- **Background:**
  - When the agent's service refuses the model of a turn, the runner ends the turn with "The selected model is unavailable. Choose another model."
  - The failed turn offers Try again. `retryMessage` sends the message again with the choice of the failed message.
  - So a user who reads the text, picks another model in the picker, and presses Try again gets the same model and the same failure.
  - The quick mockup of option G of decision 10 shows a failure on an own endpoint with the same advice: "The endpoint of this login does not serve claude-fable-5-1. Choose another model."
- **Problem:** The failure text asks for another model, but Try again ignores the model that the user then chooses.
- **Impact if no action:** The user presses Try again, sees the same failure, and must type the message again with a new model.
- **Root question:** When a turn fails because of its model, how does the user send the same message again with another model?
- **Options:**
  - **A.** Try again uses the choice that the composer shows now, also when it differs from the failed message. Cost: a Try again after a change of the picker for another reason also changes the model. Effort: Small.
  - **B.** Only a failure of the model makes Try again use the composer's choice. Other failures keep the choice of the message. Effort: Small.
  - **C.** A model failure shows "Choose a model" in place of Try again, which opens the picker and then sends the message again with the chosen model. Cost: a new action and a mockup state. Effort: Medium.
  - **D.** Change the failure text so that it does not advise another model before Try again, such as "Try again, or choose another model and send the message again." Cost: the user still types the message again. Effort: Small.
- **Left out:** Change nothing, because the text and the action then contradict each other.
- **Wider fix:** B. It ties the model of a Try again to the cause of the failure, also for new causes.
- **Previous examples:** None found.
- **Recommendation:** B. It keeps Try again as it is for every other failure, and it does what the text asks for a model failure.
- **Action:** ask the user, because each option changes what Try again does or says, and no requirement covers its model.
