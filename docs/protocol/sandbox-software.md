# Sandbox software

This doc holds the requirements and the decisions in force for the
[sandbox software](../architecture.md#terms), the app's own software in
each sandbox. It covers the releases, the updates of each sandbox, the
install in a build, and the software image that a first build starts from.
It belongs to [Workspaces and sandboxes](workspaces-and-sandboxes.md).
[Sandbox software](../architecture/sandbox-software.md) in the
architecture docs describes its parts. The terms are those of the
[architecture doc](../architecture.md#terms). A decision number names a
dated record, as [Decision numbers](../architecture.md#decision-numbers)
says. A sandbox software decision number, such as sandbox software
decision 5, names a decision of the change that makes the sandbox software
update itself.

## Releases

- A release is one version of the sandbox software. It holds the program
  `conductive` and the other parts that the program installs.
- Each deploy from `main` publishes a release (sandbox software decision
  6). Reason: the runner then keeps matching the Worker.
- A release only with each release of the Mac app was rejected, because
  the runner then lags the Worker until that release.
- The release files live in the R2 bucket `conductive-runner`. The bucket
  serves them at `https://runner.conductive.build` (sandbox software
  decision 4).
- The newest release of each platform is one JSON file at
  `releases/latest/conductive/<target>` under that address. `<target>`
  names the platform of the program, such as `x86_64-unknown-linux-musl`.
- The JSON file has the format that the `cli-updater` crate of
  `futex-ai/cli-release` reads. It gives the version, the download address,
  and the SHA-256 digest of the program. It always gives the digest.
- Reason: the HTTP client of `cli-updater` reads these static files with
  no change. The files need no server. A later release server can serve
  the same paths with no change in any sandbox.
- Worker routes, a release server, and one JSON file in each GitHub
  release were rejected.
- The newest release never goes back to an older version. A deploy of an
  older commit does not change it.
- The other files of a release never change after the deploy writes them.
- Each sandbox trusts each writer of the bucket `conductive-runner` as it
  trusts the Worker deploy, because a release from the bucket becomes the
  software of each sandbox at its next start (sandbox software decision
  10). Today the only writer is the deploy token, which can also deploy
  the Worker. So a writer of the bucket gets no access that the deploy did
  not already give.
- Reason: a write to the bucket then adds no new attacker. A signature of
  each release, with a key that the deploy holds and a public key in the
  program, was not chosen for now. It becomes the better guard if any key
  other than the deploy token can write to the bucket.
- A digest that the Worker gives to each sandbox was rejected, because it
  needs a Worker route, as the rejected Worker routes above do.

## Updates

- The program `conductive` updates itself and the other parts of the
  sandbox software in its sandbox (sandbox software decision 1). Reason: a
  fix then reaches each sandbox with no new workspace and no manual
  install.
- The program checks for a newer release each time that the agent runner
  starts, such as at each start of the sandbox. It also checks every hour
  while the runner runs (sandbox software decision 5).
- It downloads a newer release in the background. A start never waits for
  a download.
- An update downloads only the parts that changed since the release that
  the sandbox runs.
- The program installs only a release with a higher version than the
  release that the sandbox runs.
- It refuses a release whose JSON file gives no digest. It also refuses
  each downloaded file whose digest does not match. Reason: each deploy
  writes the digest, so this refuses only a broken release.
- A failed check or download changes nothing in the sandbox. The program
  logs a warning. The next check tries again. Reason: the sandbox keeps
  working on its current release.
- A download never changes the files of the release that runs. Reason: a
  tool call and the running runner then never mix two releases.
- The next start of the agent runner applies the newest complete download,
  before the runner starts its work.
- The program never restarts the software to apply an update. Reason: a
  restart during a session stops each running turn.
- The sandbox keeps the previous release. When the software of a new
  release fails to start, the next start runs the previous release again.
- A sandbox without the program gets the program at its next start. That
  start changes nothing else. The program then updates the rest of the
  software by these rules.
- Reason: such a sandbox has no other way to get its first updater.
- A sandbox can run an older runner until an update applies. So the Worker
  serves each runner protocol version that a live sandbox can hold, as
  [The agent runner](agent-runner.md#the-agent-runner) says.
- An install of the newest software at each start was rejected, because a
  start then takes longer and can fail in a new way. A start that
  downloads only the changed parts was rejected for the same reason.
- A separate updater service and updates over the runner connection were
  rejected. Reason: the program itself then holds the one update path of
  each part.
- A check at each command was rejected, because each command then waits
  for a request to the release address.

## Installs in a build

- Each build of an org image installs the newest release. A software image
  build does the same. Reason: each build and each sandbox then install the
  software in the same way.
- Each refresh of an org image also installs the newest release, through
  the same software step (sandbox software decision 15). It still runs no
  install script. Reason: each refreshed image then holds current
  software, so a new workspace needs no first update.
- When no release is available, the refresh fails, and the org keeps its
  last good image. A refresh that keeps the installed release was
  rejected, because a new workspace then runs older software until an
  update applies at a later start.
- The terminal scripts and their units are parts of each release (sandbox
  software decision 1). So an update brings a fix of the terminal to each
  sandbox.
- The image build still installs the terminal packages `ttyd` and `tmux`.
  Reason: Ubuntu owns these packages.

## The software image

- The software image is a saved snapshot of the base image with the app's
  own software installed. That software is a release of the sandbox
  software, the terminal packages, and the GitHub CLI.
- It holds no org data and no secret, because every org uses it.
- One software image belongs to each version of the app's own software. A
  change of any install step of that software makes a new version.
- A build of an org without an org image starts from the ready software
  image of the current version. It copies the repositories, installs the
  newest release, then runs the install script. A later build and a
  refresh start from the last org image.
- Reason: the first build of a new org then installs only the parts that a
  newer release changed.
- In place of the software image, a skip of the parts that each org image
  already holds was rejected. It does not make a first build faster.
- Without a ready software image of the current version, such a build
  starts from the base image. It copies the repositories, installs the
  app's own software, then runs the install script. A missing software
  image slows a build and never fails it.
- Each deploy run asks the Worker to build the software image of the
  deployed version, and waits for the result. A deploy run whose version
  has a ready software image waits for nothing.
- A Worker cron job that builds it by itself, and a build at the first org
  build after a release, were rejected. Reason: the deploy run then shows
  the result.
- The deploy run proves itself with a token of its own, as
  [Hostnames and gates](access-and-security.md#hostnames-and-gates) says.
- The deploy run fails unless the software image is ready when its wait
  ends. The new Worker stays live. Reason: one rule covers a failed build,
  a wait that ends first, and a refused request. A warning in the summary
  of the run was rejected, because it hides the failure.
- One software image build runs at a time. A build of a newer version ends
  an unfinished build of an older version.
- A failed build starts again only for a later deploy run. So a re-run of
  the deploy builds again.
- A software image build has a time limit of 60 minutes. A build that
  outlasts the wait of its deploy run goes on until it ends or reaches
  that limit.
- When a new software image is ready, the app deletes each older one that
  no running build still starts from. A rollback of the Worker then finds
  no software image of its version, so builds install the app's own
  software until the next deploy run builds one.
