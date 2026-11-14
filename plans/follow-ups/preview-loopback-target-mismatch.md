# Some suggested loopback servers cannot open

- **Severity:** Medium. **Likelihood:** Rare. **Effort:** Medium. **Confidence:** High. **Harder later:** No.
- **Kind:** Fix after merge.
- **Added:** 2026-11-10, from PR #154, review finding 3.
- **Location:** `crates/cnd-runner/src/ports/sockets.rs`, `crates/cnd-runner/src/ports/proc.rs`, `crates/cnd-relay/src/connect.rs`, and `crates/cnd-relay/tests/relay/http_tests.rs`.
- **Reason:** This needs an unusual server bind address. The two feature fix rounds are used.

- **Source:** Review. **Category:** Product bug.
- **Terms:**
  - **Runner:** The program in each workspace's cloud computer that reports listening ports.
  - **Preview relay:** The program that forwards preview requests to local servers.
  - **Loopback address:** An address that reaches only the same computer, such as `127.0.0.2`.
- **Background:**
  - Conductive lists servers found by the runner. Selecting a row opens the port through the preview relay.
  - The scanner includes same-user wildcard and loopback listeners. It includes all IPv4 `127.0.0.0/8` addresses and their IPv4-mapped forms.
  - `crates/cnd-runner/src/_tests_/proc_ports_tests.rs` supplies `0200007F`, which is `127.0.0.2`. Its expected report keeps that port.
  - Production relay discovery tries `127.0.0.1`, `::1`, and non-internal interface addresses. It does not discover other loopback listener addresses.
  - The report and the preview request name only the port. A click sends the same request as manual port entry.
  - The relay integration tests use an injected connector for upstream servers. They do not exercise production discovery of a server bound only to `127.0.0.2`.
  - An independent Node 24 probe bound a server only to `127.0.0.2`. Every production target gave `ECONNREFUSED`. A direct connection succeeded.
  - The same relay behavior also affects manual port entry on main. It has the same cause and belongs to this fix.
- **Problem:** A web server bound only to `127.0.0.2` appears in the list. Its preview returns HTTP 502 with "The server did not answer." The relay cannot connect to its bind address.
- **Impact if no action:** Users cannot open the suggested server. They must restart it on an address that the relay tries, such as `127.0.0.1`.
- **Root question:** How can every suggested local server open in Preview?
- **Options:**
  - **A.** Limit suggestions to the addresses that the relay currently tries. Update the listening-port requirement. This hides other loopback listeners and needs user approval. Effort: Small.
  - **B.** Extend relay discovery to include the requested port's actual loopback addresses. Keep scanner discovery separate. Add a regression case with production target discovery. The two address rules can diverge again. Effort: Medium.
  - **C.** Share raw local listener discovery between the scanner and relay. Use those addresses for scanner eligibility and relay connection selection. Keep public reports and API requests unchanged. Add the same regression case. Preserve the scanner's owner, address, and internal-port filters. The relay must keep its current targets and must not use those scanner filters. Manual entry must still open ports that the list leaves out. Read the socket tables only after the current targets refuse. Effort: Medium.
- **Left out:**
  - Change nothing: it leaves a suggested server unreachable.
  - Try every address in `127.0.0.0/8`: this searches about 16 million addresses for each request.
  - Pass addresses through runner reports, the Worker, and a relay header: C uses newer data and adds no wire field.
  - Keep the row and explain why it cannot open: the server still cannot open.
  - Let the relay read the runner's last scan: C needs no running runner or extra channel and uses a fresh scan.
  - Add a network rule to the image: it needs root while the computer runs. C reaches the same servers without that rule.
  - Change only the public guide: the listed server still fails.
- **Wider fix:** C. A shared listener source prevents eligibility and relay targets from diverging. The relay must consider every listener address of the requested port.
- **Previous examples:** Commit `0315aa5e` adds the relay connection test with an injected `127.0.0.2` target. No earlier defect was found in the history search.
- **Recommendation:** C. It preserves the approved loopback coverage and prevents separate address rules from diverging.
- **Action:** fix after merge, apply C, because the bind address is unusual and the two feature fix rounds are used.

The relay remains the only preview route. The public report keeps one row for each port, without an address.
An automatic sandbox software update can deliver the correction to existing workspaces at a later runner start.
The Worker currently rewrites redirects only for `localhost`, `127.0.0.1`, and `[::1]`.
A server that writes another bind address into an absolute redirect still sends that address to the browser.

The requirements live in [Listening ports](../../docs/protocol/listening-ports.md), [Port previews](../../docs/protocol/port-previews.md), and [Preview access](../../docs/protocol/terminal-previews-and-desktop.md#port-previews).
