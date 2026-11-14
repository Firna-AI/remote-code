# Components

This page describes each component of Conductive, its responsibilities, and
its boundaries. It uses the terms of the
[architecture doc](../architecture.md#terms). The [flows page](flows.md)
describes how the components work together. A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says.

## Marketing site

The [marketing site page](marketing-site.md) gives the responsibilities and boundaries of the public site.

## Web app

- A React app, built with Vite, that uses the `@firna/ui` components.
- It lives on `app.conductive.build`, behind the GitHub sign-in.
- It shows the orgs, the workspaces, the routines, the chat, the files, the tools, and
  the org settings. It follows the phone and the desktop layouts of the
  [mockups](../mockups/README.md) (decision 15).
- For an operator, it also shows the operator section at `/operator`. The
  section gives counts across every org. It finds any org or user, and it
  suspends or lifts it. It also approves people who wait, makes and
  disables codes, pauses sign-ups, and turns the waitlist off and on.
  [Operator section](../protocol/operator-section.md) states its rules.
- Tabs are links, so each tool and each file view has its own address.
- The browser stores only the panel sizes and the last workspaces. The
  panel sizes are the widths of the sidebar and the right column, and the
  split of the right column. The last workspaces are the address of the
  last workspace page of each org, as
  [Opening an org](../protocol/org-rail-order.md#opening-an-org) says. All
  other state comes from the Worker. A tab keeps the chats that it showed in memory, as
  [Chat and events](../protocol/chat-and-events.md#events) says.

## Mac app

- An Electron shell for macOS, as [Mac app](../protocol/desktop-app.md) says.
- Its packages and updates come from the GitHub releases of the public source repository, as
  [Packages and updates](../protocol/desktop-packages-and-updates.md) says.

## Worker

- One Cloudflare Worker serves the web app, the marketing site, the API,
  the proxies to sandboxes, and the GitHub webhook endpoint.
- It holds the GitHub App key, the Boat key, the key that signs the session
  cookies, and the key that encrypts the stored secrets. The browser never
  holds them.
- It runs the model gateway. The gateway takes the model requests of the
  agent programs in a sandbox, with the
  [turn token](../protocol/model-gateway.md#terms) of their turn. It adds the
  agent login of the turn, and forwards each request to Anthropic, to
  OpenAI, or to the endpoint of an own endpoint login, as
  [External services](#external-services) says.
  [Model gateway](../protocol/model-gateway.md) states its rules.
  It sends the requests of a ChatGPT sign-in through the
  [ChatGPT egress Worker](#chatgpt-egress-worker).
- It reaches Boat through one provider adapter, so that a later change can
  add another provider. It calls only a fixed list of Boat routes.
- It calls each sandbox and each saved snapshot through the client of its
  provider account. It takes that account from its own records, as it
  takes the sandbox or the saved snapshot.
- It runs one gate for each hostname before every route and every
  WebSocket upgrade. [Access and security](../protocol/access-and-security.md)
  states the gates.
- It writes to GitHub only as a member. A merge from the pull request bar
  uses the GitHub token of the member who clicks, as
  [Merge as the member](../protocol/github-tokens.md#merge-as-the-member)
  says.

- Two Cron Triggers run the timed work. One runs every 15 minutes for
  deleted orgs, lifecycle repairs, and pending approval emails. One runs
  every minute for due routine runs and runs that stayed queued.

## ChatGPT egress Worker

- A second Cloudflare Worker owns the egress container. It has no route
  and no public address. Only the Worker reaches it, through a service
  binding.
- The egress container sends the ChatGPT requests of the model gateway to
  OpenAI, because OpenAI refuses them from a Worker.
  [Requests and answers](../protocol/model-gateway.md#requests-and-answers)
  states its rules.
- It sees a ChatGPT login only in transit and keeps no copy.
- Each push to `main` that changes its code deploys it, before the
  Worker, as [Automatic deploys](../automatic-deploys.md) says.

## D1

- D1 holds the records of the app: users, orgs, members, sections,
  repositories, workspaces, routines and their runs, settings, the active preview hostnames, and the
  records of attached files. D1 also holds app access, codes and their uses,
  the sign-up pause, the waitlist switch, and the state of approval emails.
- The record of each workspace holds a copy of its
  [GitHub state](../protocol/github-banner.md#the-github-state).
  A list read takes this copy from D1. The GitHub summary adds no Durable
  Object read or GitHub call.
- Boat labels alone cannot hold these records, because a label is fixed
  after a create or a fork.

## Workspace Durable Object

- One Durable Object for each workspace. It runs in Western Europe, near
  Boat's machines.
- It holds the open tabs, the connection of the agent runner, and the
  messages that wait for the sandbox.
- It gives each turn its turn token. For each model request, it tells the
  model gateway whether the token still works and which login the turn
  uses.
- It also holds the start steps, the stop timer, the delete timer of an
  archived workspace, and the banner state.
- After each GitHub refresh, it copies the GitHub state from its banner
  state into the workspace record in D1. It copies in the order of its
  refreshes, from the banner state that it holds at that moment. So a
  replay of an older GitHub delivery cannot write an older state.
- A failed copy fails the refresh, so that a retry copies it again.
- It runs the trusted jobs of its sandbox: the fetch of a create, and the
  branch change of Continue.
- For each start, it keeps the provider account with the org image and the
  sandbox. So the start continues after a restart.
- Its storage keeps the chat history, so a stopped or archived workspace
  still shows its chat.
- It revokes the preview hostnames of its workspace.

## Attachment storage

- One R2 bucket holds the bytes of the files that users attach to chat
  messages, and D1 holds their records (decision 132). The bucket holds the
  files of every org, so the Worker's own records keep the orgs apart, as
  [Access and security](../protocol/isolation.md#orgs-and-workspaces)
  says.
- Only the Worker reads and writes the bucket. The browser sends each file
  as raw bytes in one request, and the Worker streams it into the bucket
  (decision 144).
- Before the agent runner gets a message, the Worker copies the files of
  the message into the sandbox, through an upload address that Boat gives
  for each file.
- [Chat and events](../protocol/messages-and-attachments.md#attachments) states how
  long a file stays.

## Boat

- Boat runs the sandboxes and keeps the saved snapshots (decision 2).
  Sprites on Fly.io was the other option. Boat costs less, and it already
  has forks, saved snapshots, port URLs, desktop streams, and environments.
- Every org runs in the app's Boat account (decision 80). That account
  holds every org image and every sandbox of every org. Its plan limits
  apply to all orgs together.
- Boat is the only provider for now, and the app's Boat account is the
  only provider account (decision 213). The records still name the account
  of each sandbox and saved snapshot. So a second provider can come later,
  and each existing one keeps working in its own account.
- The app does not depend on Boat webhooks. The agent runner reports when
  a sandbox is ready. The Worker reads the state of a sandbox from Boat's
  API when it needs it.
- A stop ends every process. Boat keeps the disk and the enabled system
  services, and restarts those services after each resume and fork.

## Sandbox software

The [sandbox software page](sandbox-software.md) describes the app's own
software in each sandbox: its two programs, its releases and updates, and
the software image.

## External services

- **GitHub App:** one app gives the sign-in, the repository access, and the
  webhooks of every org.
- **Anthropic and OpenAI:** the model use of each turn on a subscription
  token or an API key bills to the own Claude or OpenAI account of the
  starter of its session. The model requests of a turn reach them through
  the model gateway of the Worker. A settings file in the repository can
  send the requests of Claude to another address instead. The gateway
  keeps no copy of a request or an answer.
- **Own endpoints:** an own endpoint is a gateway or a proxy that a user
  chose, such as a proxy that pools subscriptions. A user can connect one
  as the agent login of Claude or of Codex. For each turn on such a login,
  the model gateway forwards the model requests of the turn to the
  endpoint, with the key that the user saved. So the endpoint gets the
  messages, the files, and the command results of those turns. No sandbox
  gets the address or the key.
  [Own endpoint logins](../protocol/own-endpoint-logins.md)
  and [Own endpoints](../protocol/model-gateway-requests.md#own-endpoints)
  state the rules.
- **Workers AI:** the Cloudflare model service writes a title for a
  workspace that has no name, from its first message. Its use bills to the
  Cloudflare account of the app (decision 184).
- **Boat:** the app's Boat account pays for every sandbox and every saved
  snapshot. Use of the app is free, as
  [Orgs and members](../protocol/orgs-and-members.md#orgs) says.
- **Resend:** the email service sends every email of the app, from
  `mail.conductive.build`. These are the org invitations, the approval
  emails, and the feedback emails. The Worker sends each feedback email,
  with its screenshots, to the team inbox. The email provider of the
  operator hosts that inbox. The app keeps no copy of feedback, as
  [Feedback](../protocol/feedback.md) says.
