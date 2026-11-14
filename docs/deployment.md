# Deployment inputs

This guide lists the inputs of a deployment of the Conductive Worker: its
bindings, its public variables, and its secrets. It also says which
settings the Worker gives to each workspace sandbox.
[Architecture](architecture.md) describes the Worker and its hostnames.
The [Worker README](../worker/README.md#routes) lists the routes that the
Worker serves now. [Automatic deploys](automatic-deploys.md) says how each
push to `main` deploys the test deployment. Two linked pages hold the
[model inputs](deployment/models.md) and the
[Conductive releases and software image](deployment/runner-archive.md).

Each input names the routes that read it. A route that does not read an
input works without it. Keep secrets out of the repository and out of
examples.

## How to set the inputs

- Declare the bindings in `wrangler.jsonc`. It already holds `DB`,
  `ASSETS`, `WORKSPACES`, `CHAT_ATTACHMENTS`, `AI`, and `CHATGPT_EGRESS`.
- Set each public variable in the `vars` of `wrangler.jsonc`, or in the
  settings of the Worker in the Cloudflare dashboard.
- `wrangler.jsonc` sets `keep_vars`. So each deploy keeps the variables
  that the settings of the Worker hold and this file does not set.
  Values in `wrangler.jsonc` replace the corresponding dashboard values.
  Set a variable of one deployment in the dashboard, or with `--var` on
  its first deploy.
- `wrangler.jsonc` routes the hostnames of
  [Architecture](architecture.md#hostnames) and each hostname of the
  preview domain. A proxied wildcard DNS record of the preview domain must
  exist, so that each preview hostname reaches the Worker.
- `wrangler.jsonc` turns on Workers Logs, which keeps each warning of the
  Worker and of its Durable Objects. It removes the query string of each
  request URL from the logs, because a query string can hold a sign-in
  code, a preview credential, or the name of an attached file.
- `wrangler.jsonc` also turns on Issues, the error tracking of Workers,
  which is in open beta. Issues groups each uncaught exception, each
  `5xx` reply, and each error log line of the Worker into issues. The
  Worker page of the Cloudflare dashboard lists them under Issues.
  - Each deploy sets Issues from `wrangler.jsonc`. A switch in the
    dashboard alone ends at the next deploy.
  - Cloudflare keeps the details of each occurrence for 7 days.
  - The preview proxy passes each `5xx` reply of a preview through, so
    the failures of the programs in the sandboxes become issues too.
  - Issues sends no alert by itself. An automation in the dashboard sends
    an issue to a chat, an incident tool, a webhook, or a coding agent.
  - Issues shows no cause for an unexpected error that the Worker
    catches. The reply is then `500 internal_error`, and the Worker logs
    no error line.
- Set each secret with `npx wrangler secret put <NAME>`. The command asks
  for the value. Never put a secret in `wrangler.jsonc` or in Git.
- The Worker reads each variable as text. Write a JSON value as one
  string. In the `vars` of `wrangler.jsonc`, a JSON array or object reaches
  the Worker as an object, and the Worker refuses it.
- Local development reads the same names from `.dev.vars`, as
  [Get started](../README.md#get-started) says.

## Bindings

| Name | Kind | Needed by | Value |
| --- | --- | --- | --- |
| `DB` | D1 database | Every route that reads users, orgs, or workspaces | The production database. Apply the migrations with `npx wrangler d1 migrations apply DB --remote`. |
| `ASSETS` | Static assets | The pages of the web app | The client build of `npm run build`. |
| `WORKSPACES` | Durable Object namespace | Chat, the events socket, the runner socket, Mac commands, the workspace routes, the workspace list, the read mark, the git credential route, and image builds | The `Workspace` class of `worker/workspace.ts`. |
| `CHAT_ATTACHMENTS` | R2 bucket | Chat attachments: each upload, each message or create with files, the copy of the files when a turn starts, and their deletion | The bucket `conductive-chat-attachments`, as [The attachment bucket](#the-attachment-bucket) says. |
| `AI` | Workers AI | The title of a workspace that has no name | Workers AI on the Cloudflare account of the Worker, as [The title model](deployment/models.md#the-title-model) says. |
| `CHATGPT_EGRESS` | Service binding | The ChatGPT requests of the model gateway | The Worker `conductive-chatgpt-egress`, as the [ChatGPT egress README](../worker/chatgpt-egress/README.md) says. It must exist before the first deploy of the Worker. |
| `CF_VERSION_METADATA` | Version metadata | The software image route of the deploy run | The ID, the tag, and the creation time of the running Worker version. `wrangler.jsonc` sets it. Without it, the route answers 404, as [The software image](deployment/runner-archive.md#the-software-image) says. |

## Public variables

| Name | Needed by | Value |
| --- | --- | --- |
| `APP_ORIGIN` | Every route of the app hostname | The `https://` origin of the app hostname, with no path. |
| `MARKETING_ORIGIN` | The marketing site | Optional. Without it, the Worker uses `https://conductive.build`. |
| `MACHINE_ORIGIN` | The machine hostname, and each workspace sandbox | The `https://` origin of the machine hostname. `wrangler.jsonc` sets it. |
| `PREVIEW_DOMAIN` | Port previews | The domain of the preview hostnames. `wrangler.jsonc` sets it. |
| `GITHUB_CLIENT_ID` | GitHub sign-in, each refresh of a stored GitHub user token, the GitHub banner and Checks, the workspace refreshes of verified GitHub webhooks, and image builds that copy a repository | The client ID of the GitHub App. |
| `GITHUB_APP_SLUG` | The links to the GitHub App: Install in Get started, Manage on GitHub in the account, and Manage access of the repository lists | Optional. The slug of the GitHub App, as in `https://github.com/apps/<slug>`. Without it, or with a value that is not a slug, the links use `conductive`, and the Worker logs a warning for a wrong value. It is not a secret. |
| `BOAT_ORG_ID` | Each call to Boat | The ID of the app's Boat organization, as [The app's Boat account](#the-apps-boat-account) says. It is not a secret. |
| `CONDUCTIVE_MODELS` | [Model configuration dependencies](deployment/models.md#configuration-failures) | The JSON model list, as [Models](deployment/models.md#models) says. |
| `CONDUCTIVE_DEFAULT_CHOICE` | [Default choice dependencies](deployment/models.md#configuration-failures) | The JSON default choice, as [Models](deployment/models.md#models) says. |
| `CONDUCTIVE_TITLE_MODEL` | The title of a workspace that has no name | Optional. The Workers AI model ID of the title model, as [The title model](deployment/models.md#the-title-model) says. Without it, the app shows "Untitled" until a name is set. It is not a secret. |
| `CONDUCTIVE_RELEASE_SERVER` | Image builds, refreshes, and workspace bootstrap | Optional release base URL. The default is `https://runner.conductive.build`. |
| `CONDUCTIVE_DEPLOY_TOKEN_SHA256` | The software image route of the deploy run | The SHA-256 digest of the deploy token of the deploy run that made the Worker version, as 64 hexadecimal characters. Each deploy from `main` sets it, as [The software image](deployment/runner-archive.md#the-software-image) says. It is not a secret. |
| `CONDUCTIVE_FRAME_SOURCES` | The Desktop tab, through the content security policy of each page of the app | Optional. The trusted HTTPS origins of the desktop streams, separated by spaces, as [Frame sources](#frame-sources) says. It is not a secret. |
| `OPERATOR_GITHUB_IDS` | The operator section and the suspension of users and orgs | Optional. The numeric GitHub user IDs of the operators, separated by commas. It is not a secret. Without it, each operator request gets `403 operator_required`, as the [operator area](../worker/operator/README.md#overview) says. |

- Without `MACHINE_ORIGIN`, the Worker refuses each request on the machine
  hostname. Each sandbox gets the value as `CONDUCTIVE_MACHINE_ORIGIN`. Both
  credential routes refuse every request without it, and a build cannot
  copy a repository.

## Secrets

| Name | Needed by | Value |
| --- | --- | --- |
| `GITHUB_CLIENT_SECRET` | GitHub sign-in, and each refresh of a stored GitHub user token | The client secret of the GitHub App. |
| `BOAT_API_KEY` | Each call to Boat | An API key for the app's Boat organization, and the only Boat credential, as [The app's Boat account](#the-apps-boat-account) says. |
| `SESSION_SIGNING_KEY` | Sign-in, the sign-in of the Mac app, and every signed-in route | 32 random bytes, encoded as Base64. |
| `BOAT_KEY_ENCRYPTION_KEY` | Every route that stores or reads a stored secret | A separate 32 random bytes, encoded as Base64. |
| `GITHUB_APP_PRIVATE_KEY` | The GitHub banner and Checks, the workspace refreshes of verified GitHub webhooks, and image builds and refreshes of an org that chose a repository | The private key of the GitHub App, as PEM. The PEM file from GitHub works as it is. A PKCS#8 PEM works too. |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhooks on the machine hostname | The webhook secret of the GitHub App. The Worker checks each delivery with it. Without it, each delivery gets `503 github_unavailable`. |
| `RESEND_API_KEY` | The invitation emails of the member routes, the approval emails of the operator section, and the feedback emails of `POST /api/feedback` | An API key of Resend that can send from `mail.conductive.build`. The invitations come from `invites@mail.conductive.build`, so Resend must verify that domain. The approval emails come from the same sender. The feedback emails come from `feedback@mail.conductive.build`, on the same domain. A key with sending access only is enough. An `APP_ORIGIN` on `localhost`, `127.0.0.1`, or `[::1]` needs no key. The Worker then writes each invitation link and each feedback email to its log. Without the key, an invite gets `502 invite_email_failed`. The invitation stays pending. A feedback send gets HTTP 502 too. An approval still gives app access, and the app tries its email again for 24 hours, as [The approval email](protocol/waitlist.md#the-approval-email) says. |
| `CHATGPT_EGRESS_URL` | The ChatGPT requests of the model gateway, only when the deployment has no `CHATGPT_EGRESS` binding | The HTTPS address of a fallback egress proxy, as the [model gateway README](../worker/model-gateway/README.md#chatgpt-egress) says. The gateway reads it only together with `CHATGPT_EGRESS_SECRET`. |
| `CHATGPT_EGRESS_SECRET` | The same requests as `CHATGPT_EGRESS_URL` | The shared secret of that proxy, with at least 32 characters. |
| `FEEDBACK_EMAIL` | The feedback emails of `POST /api/feedback` | The address of the team inbox, which gets each feedback email, as [The email](protocol/feedback.md#the-email) says. It is a secret, so that a personal address stays out of the repository. Without it, each send gets HTTP 503, also on a local `APP_ORIGIN`. With it, a local `APP_ORIGIN` writes each feedback email to the log of the Worker, and needs no `RESEND_API_KEY`. Elsewhere, the feedback emails also need `RESEND_API_KEY`. |

- `BOAT_KEY_ENCRYPTION_KEY` encrypts the agent logins, the GitHub user
  tokens, the env vars of each org, and the workspace tokens. It also
  encrypts the start logs, the credentials of each image source copy, and
  the terminal and preview credentials. It encrypts no Boat key. A new key cannot read the values
  that the old key encrypted.

## The attachment bucket

`CHAT_ATTACHMENTS` holds the files that users attach to chat messages, as
[Attachments](protocol/messages-and-attachments.md#attachments) says. One bucket
serves every org.

- Create the private bucket once, before the first deploy that declares
  the binding:
  `npx wrangler r2 bucket create conductive-chat-attachments --location weur`.
  The primary orchestrator does this at the next deployment.
- The location hint puts the bucket in Western Europe, near the production
  database and the workspace objects. A bucket keeps the location of its
  first creation.
- Without the bucket, `wrangler deploy` creates it with no location hint.
  So create it first.
- Keep public access off. Add no custom domain, no `r2.dev` address, and
  no CORS rule. Only the Worker reads and writes the bucket, as
  [Orgs and workspaces](protocol/isolation.md#orgs-and-workspaces)
  says.
- Add no lifecycle rule that deletes files by age. Such a rule would also
  delete the files of sent messages, which stay until the app deletes their
  workspace.
- The copy of each file into a sandbox also needs the `file.write` action
  on the Boat key, as [The app's Boat account](#the-apps-boat-account)
  says.
- Local development and the Worker tests use local R2 storage. They need no
  Cloudflare account and no bucket.

## The GitHub App

Set these values on GitHub, in the settings of the GitHub App. Replace
`<APP_ORIGIN>` and `<MACHINE_ORIGIN>` with the values of the variables
above.

| Setting | Value |
| --- | --- |
| Callback URL | `<APP_ORIGIN>/api/auth/github/callback`. Add one for each app origin that signs in, such as `http://127.0.0.1:5173/api/auth/github/callback` for `npm run dev`. |
| Request user authorization (OAuth) during installation | Off. When it is on, GitHub turns off the Setup URL and sends each install to the sign-in callback, which refuses it. |
| Setup URL | `<APP_ORIGIN>/github/setup`, such as `https://app.conductive.build/github/setup`. GitHub sends the user there after an install. |
| Redirect on update | On, so that a change of an install, such as a new repository, returns to the app too. |
| Webhook URL | `<MACHINE_ORIGIN>/v1/github/webhooks`, as [The GitHub App](protocol/github-banner.md#the-github-app) says. |
| Webhook secret | The value of `GITHUB_WEBHOOK_SECRET`. |

- Subscribe to the webhook events that the
  [GitHub banner backend](../worker/github/README.md#server-integration)
  lists.
- A GitHub App has only one Setup URL. So an install from `npm run dev`
  returns to the deployed app, not to the local app.

## Models

[Models](deployment/models.md#models) gives the model list of
`CONDUCTIVE_MODELS` and the default choice of `CONDUCTIVE_DEFAULT_CHOICE`:
their shape, the operations that need them, and their configuration failures.

## The title model

[The title model](deployment/models.md#the-title-model) gives the model
that `CONDUCTIVE_TITLE_MODEL` names, and what happens without it.

## Conductive release files

[Conductive release files](deployment/runner-archive.md#conductive-release-files)
gives the release server and parts.

### The release in each deploy

[The release in each deploy](deployment/runner-archive.md#the-release-in-each-deploy)
gives the public paths and publication order.

### The software image

[The software image](deployment/runner-archive.md#the-software-image) describes
the software image that each deploy builds.

## Frame sources

`CONDUCTIVE_FRAME_SOURCES` lists the origins that the pages of the app can
show in a frame, in addition to the port previews. The Desktop tab shows
the desktop stream of a sandbox in such a frame.

- The value is a list of HTTPS origins, separated by spaces. An origin is
  `https://`, a host, and an optional port, with no path. A host can start
  with `*.` to cover each subdomain.
- List the desktop stream hosts as `https://*.on.boat.dev`, the domain of
  Boat's sandbox hosts. Boat's [desktop guide](https://docs.boat.dev/desktop-streaming/urls-and-security)
  shows the stream host only as `<sandbox-desktop-host>`, and Boat
  generates it for each running sandbox. A list of exact hosts was
  rejected, because it fails for each new workspace.
- The wildcard also lets the pages of the app frame any other page on a
  Boat sandbox host, also a page of another Boat customer. To use this, an
  attacker first needs a way to put HTML into a page of the app.
- A desktop URL carries its token in the fragment. Put no token or other
  secret in the value.
- The Worker gives each page of the app a content security policy. Its
  frame sources are the page's own origin, `https://*.<PREVIEW_DOMAIN>`,
  and each origin of the value. The Worker leaves out each entry that is
  not an HTTPS origin, such as an `http://` address or an address with a
  path.
- Without the variable, a page frames only its own origin and the port
  previews. The Desktop tab then cannot show a stream.
- The Mac build reads its own `CONDUCTIVE_FRAME_SOURCES`, as the
  [Mac app README](../desktop/README.md#development) says. It does not add
  the preview domain itself. So give the Worker and the Mac build the same
  value: `https://*.<PREVIEW_DOMAIN> https://*.on.boat.dev`. The Worker
  lists the preview origin only once.

## Settings of each workspace sandbox

The Worker gives each workspace sandbox its settings at each start, as
[Start in a workspace](../image/README.md#start-in-a-workspace) says. One
of them comes from this guide: `CONDUCTIVE_MACHINE_ORIGIN` is
`MACHINE_ORIGIN`.

The computer tools need no deployment input. Boat writes the entry of the
`computer` server into each sandbox at its start. It names a local server
with no URL and no credential, and the runner reads it, as
[What it does](../runner/README.md#what-it-does) says.

`CONDUCTIVE_DEFAULT_BRANCH` needs no deployment input. A create or a resume
gives the default branch of the repository of the workspace, from its
queued start. A disk retention restart gives the current default branch of
that repository.

`CONDUCTIVE_WORKSPACE_BRANCH` needs no deployment input either. A create, a
resume, and a disk retention restart give the workspace branch that the
Worker's record of the workspace names. The runner names that branch in
the [agent instructions](protocol/agent-instructions.md#the-branches).

## The app's Boat account

Every cloud computer of every org runs in the app's own Boat organization.
No org has a Boat key, and the Worker stores no Boat key in D1.

- `BOAT_API_KEY` is the only Boat credential. Set it as a Worker secret.
- `BOAT_ORG_ID` names that organization on every Boat call. It is not a
  secret. Set it in the `vars` of `wrangler.jsonc`, next to
  `MACHINE_ORIGIN`.
- Both are settings of the Worker only. The key never goes to the browser,
  into a sandbox, into a log, or into a saved snapshot, as
  [Access and security](protocol/isolation.md#the-apps-boat-key)
  says.
- [The app's Boat account](../worker/sandbox/README.md#the-apps-boat-account)
  says how to make the organization and the key.
- The key must also allow the `file.write` action. The Worker uses it to
  copy each attached file into a sandbox. The primary orchestrator
  supplies that action at the next deployment.
