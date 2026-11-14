# Architecture

Conductive is a coding tool at `conductive.build`. Each workspace has its
own cloud computer, a Boat sandbox, and one branch at a time. It can hold
one task after another. Agents powered by Claude and Codex work only in
the sandbox. The user follows them in the browser or in the Mac app, which
shows the web app. Routines also start agents without a person, each run
in a new workspace. This doc describes the components, their
responsibilities, and the boundaries between them. The
[protocol docs](architecture/protocol-docs.md) hold the requirements of
each feature.

## Terms

- **Org:** a group of people that owns workspaces, sections,
  repositories, and an org image.
- **Admin** and **member:** the two roles in an org. Each person in an org
  has one of them.
- **Operator:** the person who runs the app, as opposed to the admin of an
  org. Only an operator can suspend a user or an org, or lift a
  suspension. Only an operator opens the operator section.
- **Suspension:** the block of one user or one org by an operator, until
  an operator lifts it. It stops the sandboxes of the workspaces that the
  user owns, or of every workspace of the org, and blocks new starts. A
  user suspension also ends the sign-in sessions of the user.
- **App access:** the right of a user to use the app: to create or join an
  org, and to start cloud computers. A new account starts without it,
  except during open sign-up.
- **Waitlist:** the users without app access. Each of them sees only the
  waitlist screen until an approval, a code, an org invitation, or open
  sign-up gives app access. The waitlist switch of the operator section
  turns the waitlist off and on.
- **Open sign-up:** the state while the waitlist is off and sign-ups are
  not paused. Each user without app access then gets it at their next
  sign-in or request.
- **Invite code:** a code that an operator makes, with a use limit. Each
  use gives app access to one person who waits.
- **Referral code:** the personal code of each user with app access. It
  gives app access to up to 5 people who wait. The screens of users call
  it an invite code.
- **Workspace:** the work of an org on one repository, one task at a time.
  It has one repository, one sandbox, one or more sessions, and one branch
  at a time. After a merge, Continue moves it on to its next task.
- **Workspace owner:** the person who is responsible for a workspace. It is
  the person who created the workspace, until an admin reassigns it.
- **Continue:** the action after a merge that moves a workspace to a new
  branch from the latest default branch. The workspace keeps its sandbox
  and its sessions.
- **Local work:** work in the sandbox of a workspace that GitHub does not
  have: changed files that are not committed, also untracked files, and
  commits that no remote branch holds.
- **Sender:** the person who sent the message of a turn. The GitHub token
  and the Mac requests of the turn belong to its sender. The agent login
  belongs to the starter of the session, the member who started it.
- **Boat key:** the one key of the app's own Boat account, where every
  sandbox and every org image of every org runs. It is a Worker secret.
- **Provider account:** an account with a sandbox provider. The Worker
  holds its credentials, and reaches it through its own client.
- **Sandbox:** the Boat sandbox of one workspace. The product calls it a
  cloud computer or a sandbox.
- **Org image:** the saved snapshot that every new sandbox of an org starts
  from. It holds a prepared copy of each repository that the org chose
  when the build of the image began.
- **Build:** a run of the install script on a copy of the org image. A
  build also installs the newest release of the sandbox software. An org
  without an org image builds on a copy of the software image. A build
  replaces the org image only when it succeeds.
- **Software image:** the saved snapshot of the base image with the app's
  own software, and no org data. Each deploy run builds the one of its
  version, and a build of an org without an org image starts from it.
- **Refresh:** an update of the org image that fetches the new commits of
  each repository that the org image holds. It does not run the install
  script.
- **Sandbox software:** the app's own software in each sandbox. It is the
  program `conductive` and the parts that the program installs. Each deploy
  from `main` publishes a release of it. Each sandbox updates it by itself,
  as [Sandbox software](protocol/sandbox-software.md) says.
- **Agent runner:** the part of the sandbox software that runs the agents.
  It runs them through the agent SDKs, and it reports the files, the
  changes, and the listening ports of its workspace.
- **Session:** one agent conversation in a workspace. It shows as a tab.
- **Turn:** the work of the agent on a message, from the message to the
  end of the agent's reply. A Claude turn stays open after that reply
  while its background work runs, up to a time limit, as
  [Background work](protocol/agent-runner.md#background-work) says.
- **Background work:** the tasks that a Claude agent runs in the
  background, such as a command or a subagent, and the wake-ups that it
  schedules. A wake-up is a prompt for the agent at a later time.
- **Workspace token:** a secret of one workspace. Its sandbox uses the
  token to call the Worker.
- **Preview hostname:** a random hostname on the preview domain. It shows
  one port of one sandbox.
- **Start:** each create or resume of a sandbox, also the sandbox of a
  build, a refresh, or a software image build. The app's Boat account
  limits the starts of all orgs.

- **Routine:** a saved prompt of an org that runs an agent without a
  person. A schedule, a GitHub pull request event, or Run now starts each
  run. Each run creates a new workspace, the run workspace.
- **Routine owner:** the member whose logins the runs of a routine use. It
  is the member who created the routine, until that member leaves the org.
- **Base branch:** the branch that the work of a workspace targets. Changes
  compares with it, and "Create PR" opens into it.

## Components

The [components page](architecture/components.md) describes each
component and its responsibilities. It covers the apps, the Worker and
its storage, Boat, the sandbox software, and the external services. The
[sandbox software page](architecture/sandbox-software.md) describes the two
programs in each sandbox, their releases, and their updates.

## Hostnames

| Hostname                  | What it serves                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `conductive.build`        | The marketing site, with the public docs and the Terms, Privacy, and comparison pages                                                      |
| `app.conductive.build`    | The web app, the API, the chat sockets, and the terminal                                                                                   |
| `api.conductive.build`    | The GitHub webhooks, the agent tools, the runner, the credential helper, the model gateway, and the software image route of the deploy run |
| `*.conductive.page`       | One random hostname for each open port preview, one level deep                                                                             |
| `runner.conductive.build` | The public files of each [release](protocol/sandbox-software.md#releases) of the sandbox software, from an R2 bucket                       |

`api.conductive.build` is the hostname for machines. Each of its routes has
a path under `/v1/` (decision 102). The preview domain, `conductive.page`,
is a separate registrable domain, so preview code is never same-site with
the app (decision 6).

## Flows

The [flows page](architecture/flows.md) describes how the components work
together for a new workspace, chat, the terminal, previews, the desktop,
GitHub events, a merge, Continue, routine runs, and stops.

## Where data lives

The [data locations](architecture/data-and-trust.md#where-data-lives) give
where each kind of data lives.

## Trust boundaries

The [trust boundaries](architecture/data-and-trust.md#trust-boundaries)
separate the orgs, the Boat key, the model gateway, and the sandboxes.

## Decision numbers

A decision number, such as decision 36, names the dated record of one
decision. The plan of the change that made the decision keeps the record
while that change is open. The pull request of that change keeps the
record after the merge. The decisions of routines use the numbers from
501, so that each number names one record.

A decision of a later change carries the short name of that change, such
as gateway decision 6. The doc that cites it defines the name.

## Protocol docs

[Protocol docs](architecture/protocol-docs.md) lists each protocol doc
and what it covers.
