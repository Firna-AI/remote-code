# Formatting marks leave an empty heading

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Small. **Confidence:** High. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-11, from branch `calummoore/markdown-heading-support`, review round 2, finding 3.
- **Location:** `src/chat/components/AgentText.tsx:48`, `src/chat/components/MessageLine.tsx:103`, and `src/chat/components/MessageLine.tsx:149`.
- **Reason:** A lasting case needs unusual text or a stop inside a heading, and the fix costs the same later.

- **Source:** Review. **Category:** Product bug.
- **Terms:**
  - **Heading block:** The parsed heading value that the chat answer and message line render.
  - **Message line:** The control that opens an agent message in the folded work of a finished turn.
  - **Inline reader:** `chatParts` in `src/chat/links/chat-parts.ts`, which reads bold marks, code, and workspace links.
- **Background:**
  - Conductive draws Markdown headings in agent messages.
  - `docs/protocol/chat-markdown.md` requires a heading with no text to show nothing and still end the paragraph above it.
  - The reason also covers the time while the agent writes.
  - An open message line keeps a readable name when its first visible content sits below the line, such as a table.
- **Problem:**
  - The three empty checks compare source text with `''` before `LinkedText` formats it.
  - For `## **`, the heading reader returns level 2 with the text `**`.
  - The inline reader returns no parts, so the answer draws `<h2></h2>`.
  - For `` ## ` ``, the answer draws an empty code box inside its heading.
  - `**` above `---` creates the same empty heading through `Paragraph.underline`.
  - Before a table, these headings also stop the message line from adding its hidden control name.
- **Impact if no action:** A screen reader can meet an empty heading or an unnamed message control.
- **Root question:** How does a heading remain absent until it has readable content?
- **Options:**
  - **A.** Check formatted content separately at each empty check. Extend the existing empty-heading tests. Effort: Small.
  - **B.** Share heading preparation between both renderers and the control-name fallback. Each reader calls it to decide emptiness. Effort: Small.
  - **C.** Show formatting-only heading source literally until readable content arrives. This changes how incomplete inline formatting appears. Effort: Medium.
  - **D.** Decide emptiness where the chat parser makes each heading block. Give the block empty text when the inline reader finds no readable text. Effort: Small.
- **Left out:**
  - Changing nothing fails the requirement.
  - CSS cannot name the open line, and `:empty` misses an empty code box.
  - Changing unclosed formatting in every block adds unrelated behaviour changes. C gives the same heading result without those changes.
  - The shared heading reader cannot apply this chat-only rule, because the file preview reads `**` as literal text.
- **Wider fix:** D. Correct heading blocks keep every later reader from drawing an empty heading.
- **Previous examples:** None found in the focused history and follow-up search. Commit `712afd8f` added the earlier block-count name check.
- **Related:**
  - `plans/follow-ups/markdown-line-endings.md` changes line splitting near the same hash-heading branch. Either fix can go first.
  - `plans/follow-ups/chat-quote-end-hides-heading.md` changes `Paragraph.add`. D changes `Paragraph.underline`, so the changes do not overlap.
  - The Markdown library option of the quote follow-up also prevents this case, but reverses a recorded user choice. This work need not wait for it.
  - `plans/follow-ups/message-line-unreadable-name.md` covers the older control-name gap for paragraphs and code blocks. D fixes only heading values.
- **Recommendation:** D. Correct the value where the parser creates it, so the renderers and name check need no change. The first review recommended B.
- **Action:** fix after merge, apply D, because a lasting case needs unusual text or a stop inside a heading.

Apply D in `parseLines` of `agent-text.ts` and in `Paragraph.underline` of
`agent-paragraph.ts`. Keep an empty heading block, so it still closes the
paragraph and preserves list layout. Check readable text, not only the
number of inline parts, because an empty code part still exists.

Add the bold-only, backtick-only, and underline cases to
`agent-text.test.ts`. Add the heading-before-table case to
`MessageLine.dom.test.tsx`. Update `src/chat/agent-text.md` with the
prepared heading value. The review confirmed the paths by reading the
code and did not run a reproduction.

The runner sends live text in batches of 40 ms, from
`crates/cnd-runner/src/engine/output.rs`. A bold-only prefix can appear for one update.
`WorkFold` shows the work of ended turns, so the message-line case needs
a complete message with this unusual text.
