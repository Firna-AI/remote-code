# Org image

This doc holds the requirements and the decisions in force for the org
image that every sandbox of an org starts from. It covers the builds and
the refreshes of the org image, the first build of a new org, and the
builds and the notices of a change of the repositories.
[Sandbox software](sandbox-software.md) holds the software image that a
first build starts from. It
belongs to [Workspaces and sandboxes](workspaces-and-sandboxes.md). The
terms are those of the [architecture doc](../architecture.md#terms). A
decision number names a dated record, as
[Decision numbers](../architecture.md#decision-numbers) says.

## The org image

- Each org has one org image (decision 13). The image holds a prepared
  copy of each repository that the org chose when the build of the image
  began.
- One image for each repository was rejected, because each image costs
  its own saved snapshot and starts.
- The Repositories tab of the org settings chooses the repositories
  (decision 10). A change of the repositories takes effect at the next
  build, not at a refresh, as [Repository changes](#repository-changes)
  says.
- The install script prepares the image. It is a script, not a terminal
  session, and it runs only in a build.
- Bash runs the install script.
- The Cloud computer tab lists the operating system and software that the
  base image includes before the install script runs.
- "Build computer" starts a build. A build runs the install script on a
  copy of the image, with every chosen repository cloned (decision 12).
- An add of a repository also starts a build, as
  [Added repositories](#added-repositories) says (decision 240).
- The app also starts some builds by itself, as
  [The first build](#the-first-build) and
  [Added repositories](#added-repositories) say.
- A build replaces the org image only when it succeeds. A failed build
  keeps the last good image (decision 9).
- While a build runs, its log streams on the Cloud computer tab. New
  workspaces keep starting from the last good image.
- A failed build shows the end of its log and Try again. The Settings link
  of the sidebar then shows a mark.
- After a failed build, the app starts no new build by itself
  (decision 12). This also holds for the first build of an org. Reason: a
  broken install script fails again.
- The Cloud computer tab shows the install script notice while the saved
  install script differs from the script that the org image ran
  (decision 241). The notice asks for a build, because the script runs
  only in a build.
- While the org has no image, the script of the newest build takes the
  place of the script that the org image ran.
- A refresh does not end the notice, because a refresh does not run the
  script.
- A change of the repositories shows the
  [repository notice](#the-repository-notice), not the install script
  notice. Reason: each notice then names the change that waits for a
  build.
- One notice with words that fit both changes was rejected, because the
  reader then does not learn which change waits.
- While the org has no good image and a build runs, the install script
  notice asks for no build. It says that one more build runs the script
  when that build succeeds, as [The first build](#the-first-build) says.
- The Cloud computer tab lists the builds, each with its time, its result,
  and its length.
- A push to the default branch of a chosen repository refreshes the org
  image, at most once in 30 minutes. A daily timer refreshes it too. Each
  automatic refresh needs an admin who is not suspended, as
  [Operator actions](operator-actions.md#starts-stops-and-builds) says.
- A refresh fetches the new commits of each repository that the org image
  holds. It does not run the install script, and it adds or removes no
  repository. It installs the newest release of the sandbox software, as
  [Installs in a build](sandbox-software.md#installs-in-a-build) says.
- Reason: a new workspace then needs only a small fetch. The limit of one
  refresh in 30 minutes saves starts, because each refresh is a start.

### The first build

- Create org starts the first build of the org by itself (decision 150 of PR #92).
  Create org requires at least one repository, as
  [Orgs](orgs-and-members.md#orgs) says, so every new org starts its first
  build at create (decision 151 of PR #92).
- Reason: a new org then gets its org image with no manual step.
- Create org starts the build before it answers. A build that the browser
  starts after the create was rejected, because a closed tab could then
  lose the build.
- The first build is a normal build. The person who creates the org, its
  first admin, is the starter of that build. Its log and its result show
  on the Cloud computer tab, as for every build.
- A build of an org without an org image starts from the software image.
  It copies the repositories, installs the newest release of the sandbox
  software, and runs the install script, as
  [The software image](sandbox-software.md#the-software-image) says.
- When the first build cannot start, Create org still creates the org. An
  admin can then start a build on the Cloud computer tab, with Build
  computer or Try again. Reason: the org is valid without a build.
- An org has no org image until its first good build. The first good build
  is the earliest build of the org that succeeds. It can be the first
  build, or a build after a failure.
- Until the first good build, no workspace of the org can start.
  [Create a workspace](create-a-workspace.md#before-the-first-good-build) and
  [Get started](orgs-and-members.md#get-started) say what the app shows in
  that time.
- The repositories or the install script can change during the first good
  build. In that case, the app starts one more build by itself, the added
  build, when that build ends (decision 151 of PR #92).
- Reason: a build holds the repositories and the install script that were
  saved when it began. The added build takes in each change from any
  screen during the first good build. So such a change needs no Build
  computer.
- After the first good build, a build or a refresh gets an added build
  only for a waiting repository, as
  [Added repositories](#added-repositories) says. A failed build gets
  none. Reason: Try again then builds the current settings.
- The added build runs for an admin who is not suspended, as an automatic
  refresh does. An org without such an admin gets no added build. Reason:
  one rule then covers each build that the app starts by itself.
- [Starts, stops, and builds](operator-actions.md#starts-stops-and-builds)
  states what a suspension does to each build.
- When the added build cannot start, the org keeps its first good image.
  The change then waits for the next build.
- After the first good build, a change of the install script and a
  removed repository start no build. They wait for the next build, which
  an admin can start with Build computer (decision 12). This also holds
  for such a change during an added build.
- An added repository starts its own build, as
  [Added repositories](#added-repositories) says (decision 240).

## The software image

[The software image](sandbox-software.md#the-software-image) holds the
saved snapshot of the app's own software that a first build starts from.

## Repository changes

- A job is a build or a refresh of the org image. One job runs at a time
  in each org.
- A waiting repository is a chosen repository that the org image does not
  hold yet. Each other chosen repository is ready.
- A removed repository is a repository that the org image holds, but that
  the org no longer chose.
- Before the first good build, no repository counts as waiting or removed.
  Reason: no workspace can start in that time, and the notices of
  [The first build](#the-first-build) already say why.

### Added repositories

- When no job runs, an add of a repository starts a build at once
  (decision 240). The admin who added it is the starter of that build.
- Reason: the repository is then ready after one build, with no wait for
  an admin who finds Build computer.
- The Repositories tab tells an admin that an add starts a build. The new
  build shows at once on the Cloud computer tab and in the
  [repository notice](#the-repository-notice).
- The add starts its build also when the newest build failed. Reason: the
  add of an admin starts it, as Try again does. The app still starts no
  build by itself after a failed build (decision 12).
- When the build cannot start, the add still saves the repository. The
  repository then waits for the next build.
- While a job runs, an add starts no second job.
- When a job succeeds, and the repositories of that job lack a chosen
  repository, the app starts one added build by itself (decision 240). It
  does so only when the newest build succeeded.
- So the adds during a job share one added build after that job. Reason:
  without it, a repository that an admin adds during a job never builds.
- A failed build gets no added build. A refresh after a failed build gets
  none either. Reason: the app starts no build by itself after a failed
  build (decision 12), and Try again builds the current choice.
- So an add during a refresh after a failed build waits for Try again.
- A job gets at most one added build. So an add during the first good
  build gets one added build, not two.
- The added build runs for an admin who is not suspended, as the added
  build of [The first build](#the-first-build) does.
- A delay that groups several adds into one build was rejected. Reason:
  one add is the common case, and it then has no wait. A burst of adds
  costs one more build.
- A refresh that clones a waiting repository into the org image was
  rejected. Reason: the image would then hold a copy that the install
  script never prepared (decision 13).
- [Waiting repositories](create-a-workspace.md#waiting-repositories) says
  how New workspace shows a waiting repository.

### Removed repositories

- A removal starts no build (decision 240). The org image keeps the
  removed repository until the next build.
- Reason: a removed repository leaves only an unused folder in new
  workspaces until the next build.
- New workspace does not offer a removed repository.
- A build at each removal and at each change of the install script was
  rejected (decision 241). Reason: such a change blocks no new workspace,
  and each build is a start.
- A removed repository that the install script still uses can fail the
  next build. The log of that build then shows the error.
- A warning at the removal, and a sentence about the install script in
  the repository notice, were rejected. Reason: the log of the failed
  build shows the cause.

### The repository notice

- The repository notice shows on the Repositories tab and on the Cloud
  computer tab, for admins and members (decision 241).
- It shows while a repository waits, or while the org image still holds a
  removed repository. So it shows only once the org has an image.
- Its title names the waiting repositories, or the removed ones when no
  repository waits.
- The first state that applies gives its words and its action:
  1. No build runs, and the newest build failed. The notice says that the
     change waits for a build that succeeds, and that the last build
     failed. An admin gets Try again.
  2. A build runs, and a repository waits. The notice says that the
     waiting repositories are ready after the build. It has no button.
  3. In each other case, the notice says that the change waits for the
     next build. An admin gets Build computer. This case covers a running
     refresh, a removal alone, and a build that could not start.
- A refresh never counts as a running build. Reason: the build card of
  the Cloud computer tab does not show a refresh.
- The words say "after the build", not "after this build". Reason: an add
  during a build waits for the added build that follows it.
- On the Cloud computer tab, the notice has no button, also for an admin.
  Reason: the build card under it has the same action. The Repositories
  tab keeps the button.
- A member who is not an admin gets no button. When an admin can act, the
  notice tells the member so. Reason: only an admin builds (decision 57).
- A mark on each row of the repository lists was rejected, because the
  notice names the repositories.
