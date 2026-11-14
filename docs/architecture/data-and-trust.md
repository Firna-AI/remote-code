# Data and trust boundaries

This page gives where the data of the app lives, and the trust
boundaries between the components of the
[architecture doc](../architecture.md). It uses the terms of that doc. A
decision number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

## Hostnames

[Hostnames](../architecture.md#hostnames) gives the role of each hostname
and the separate preview domain.

## Where data lives

| Data                                                                         | Home                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| Users, orgs, members, sections, workspaces, settings, suspensions, and lifts | D1                                       |
| App access, the codes and their uses, and approval email states              | D1                                       |
| The pause and the waitlist switch                                            | D1                                       |
| Routines and their runs | D1 |
| The org and the provider account of each sandbox and each saved snapshot     | D1                                       |
| Env var values and agent logins                                              | The Worker's storage, encrypted          |
| The host of each own endpoint login | D1 |
| The Boat key and the other keys of the Worker                                | Worker secrets                           |
| Chat history and banner state                                                | The workspace Durable Object             |
| A copy of the [GitHub state](../protocol/github-banner.md#the-github-state) of each workspace, for the lists | D1 |
| Files attached to chat messages | The attachment storage, an R2 bucket |
| The records of attached files | D1 |
| The repository, the files, and the agent sessions                            | The home folder of the sandbox           |
| The prepared repositories and the installed software                         | The org image, in the app's Boat account |
| The releases of the [sandbox software](sandbox-software.md) | An R2 bucket, public at `runner.conductive.build` |
| Panel sizes                                                                  | The browser, or the Mac app              |
| The address of the last workspace page of each org                           | The browser, or the Mac app              |

## Trust boundaries

- The org is the boundary between tenants. A request reaches an org only
  for a member of that org. An operator is the one exception, as
  [Orgs and workspaces](../protocol/isolation.md#orgs-and-workspaces)
  says.
- The one Boat key reaches the sandboxes and the saved snapshots of every
  org (decision 80). So the Worker's own records keep the orgs apart, as
  [Access and security](../protocol/isolation.md#orgs-and-workspaces)
  says.
- The Boat key never goes to the browser, into a sandbox, into a log, or
  into a saved snapshot.
- Sandbox code is untrusted. Agents write and run it, and previews show it
  only on the preview domain.
- Each writer of the R2 bucket of the sandbox software releases is as
  trusted as the Worker deploy, because each sandbox installs the newest
  release from it. Today only the deploy token writes it, as
  [Releases](../protocol/sandbox-software.md#releases) says.
- A sandbox gets none of the secrets of the app's Boat account. At a
  start, it gets only the secrets of its workspace and its org.
- The model gateway is the boundary between each sandbox and the model
  providers. During a turn, a sandbox holds a turn token, not an agent
  login. The token spends the login of the starter of its session only
  through the gateway, and only while the turn runs. The agent logins stay
  in the Worker. A workspace accepts only a runner that uses turn tokens,
  as [Runner versions](../protocol/version-pins.md#runner-versions) says.
  A ChatGPT login passes through the egress container of the
  [ChatGPT egress Worker](components.md#chatgpt-egress-worker) in
  transit, and the container keeps no copy.
- An own endpoint is a server outside the app that a user chose. For each
  turn on its login, the gateway sends it the key and the model requests,
  with the messages, the files, and the command results of the turn. Its
  address and its key never reach a sandbox.
- The gateway calls an own endpoint only at a public https address. So a
  saved address cannot point the Worker at a private network, at the app,
  or at a preview, as
  [Own endpoint logins](../protocol/own-endpoint-logins.md)
  and [Own endpoints](../protocol/model-gateway-requests.md#own-endpoints) say.
- The members of one org can reach the turn token in a sandbox, as
  [Access and security](../protocol/isolation.md#agent-logins-in-a-sandbox)
  says.
- A routine run acts as its owner while no person watches. It uses the
  owner's agent login and GitHub token, and the org's env vars. Its
  sandbox follows the same gateway boundary above. Other GitHub accounts
  can write text that its agent reads, as
  [Risks that stay open](../protocol/routines.md#risks-that-stay-open) says.
