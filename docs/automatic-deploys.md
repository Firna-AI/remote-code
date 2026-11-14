# Automatic deploys

Each push to `main` deploys the test deployment at `conductive.build`. The
GitHub Actions workflow `Deploy`, in `.github/workflows/deploy.yml`, runs
the deploy. This guide gives its triggers, its GitHub settings, its
Cloudflare token, and its steps. It also says how to recover from a failed
deploy. [Deployment inputs](deployment.md) lists the bindings, the
variables, and the secrets of the Worker.

## When it runs

The workflow runs on each push to `main`. You can also start a run from
`main` with the Run workflow button in GitHub Actions. Start one to deploy
again, for example after you change a Cloudflare setting. The workflow
does not wait for CI. So a commit on `main` goes live also when its CI run
fails. [CI](../AGENTS.md#ci) says how a commit reaches `main`.

- Deploys run one at a time. A new push never cancels a running deploy.
- A run that waits for a new software image keeps the next run waiting,
  for up to 15 minutes more, as [Steps of a run](#steps-of-a-run) says.
- GitHub keeps only the newest waiting run. So a burst of merges deploys
  the newest commit.
- Each run first checks that its commit is still the head of `main`.
  GitHub does not keep runs in push order. So a run of an older commit,
  also a re-run, deploys nothing. It starts a new run on `main` instead,
  and that run deploys the head with the head's own steps.
- When a run cannot look up the head of `main`, it warns and deploys its
  own commit.
- A re-run of only some jobs, such as Re-run failed jobs, also deploys
  nothing. It starts a new run on `main`, because a re-run keeps the
  outputs of the jobs that passed. Re-run all jobs retries the deploy in
  the same run. Both also retry a software image that was not ready.
- GitHub sends a failure alert to the person who starts a run. A run that
  the workflow starts has no such person. So after a re-run, look at the
  new run in GitHub Actions.

## GitHub settings

The deploy job uses the GitHub environment `production`. A GitHub
environment is a deploy target in the settings of the repository. It holds
its own secrets and variables.

| Name | Kind | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret of the environment | The Cloudflare API token, as [The deploy token](#the-deploy-token) says. |
| `CLOUDFLARE_ACCOUNT_ID` | Variable of the environment | The ID of the Cloudflare account of the Worker. It is not a secret. |

- The deploy job has the GitHub token permission `deployments: write`,
  so that it can record each complete egress deploy in the environment
  `chatgpt-egress`. That environment holds no secret.
- The deployment branch rule of `production` allows only `main`. So a
  workflow run on another branch cannot use the token.
- Create the environment with that rule before the first run. GitHub
  creates a missing environment with no rule at the first run that names
  it.
- When neither setting exists, the run warns and deploys nothing. The run
  succeeds. So you can add the secret and the variable after you create
  the environment.
- The settings check runs in its own job, which makes no deployment
  record. So the history of `production` lists only the runs that
  deployed.
- When only one of the two settings exists, the run fails.
- The jobs run on the GitHub-hosted runner `ubuntu-24.04`.

## The deploy token

`CLOUDFLARE_API_TOKEN` needs these permissions. A user token and an
account-owned token both work.

| Permission | Scope | Resource | What uses it |
| --- | --- | --- | --- |
| Workers Scripts Edit | Account | The account of the Worker | `wrangler deploy`: the Worker, its assets, its cron trigger, its URL settings, and its custom domains |
| D1 Edit | Account | The account of the Worker | The D1 migrations |
| Workers R2 Storage Edit | Account | The account of the Worker | The upload of Conductive release files |
| Workers Routes Edit | Zone | `conductive.page` | The route `*.conductive.page/*` |
| Zone Read | Zone | `conductive.page` | Wrangler finds the zone of that route by its name |
| Containers Edit | Account | The account of the Worker | The image and the instances of the [ChatGPT egress Worker](../worker/chatgpt-egress/README.md) |

- With Workers Routes Edit on all zones of the account, Wrangler sets the
  route in one call and needs no Zone Read.
- The zone `conductive.build` needs no permission. Its custom domains use
  Workers Scripts Edit.
- The deploy needs no user permission, because the run gives Wrangler the
  account ID.
- The template "Edit Cloudflare Workers" holds more permissions, such as
  Workers KV Storage and Workers Tail, but no Zone Read. With the template
  and specific zones, add Zone Read on `conductive.page`.
- A missing permission makes the run fail. The Wrangler error names the
  Cloudflare API request that failed.

Workers R2 Storage Edit also lets the token write to every other bucket of
the account. To limit R2 to the bucket `conductive-runner`, make the token
through the API. Give it the same permissions, with two changes:

- Leave out the account group `Workers R2 Storage Write`.
- Add the bucket group `Workers R2 Storage Bucket Item Write` on the bucket
  `conductive-runner`.

The S3 key pair of the upload then reaches only that bucket.
[The release in each deploy](deployment/runner-archive.md#the-release-in-each-deploy)
describes that upload. The API names each Edit permission with Write, as
in `D1 Write`.

## Steps of a run

Each run takes these steps, in this order:

1. It installs the packages with `npm ci` and `npm ci --prefix runner`.
2. It builds the app with `npm run build`, which also runs the typecheck.
3. It packages the system and SDK helper parts, and builds the musl program
   with its version and three-part list embedded.
4. It uploads each missing immutable release file and checks its public size, as
   [The release in each deploy](deployment/runner-archive.md#the-release-in-each-deploy)
   says.
5. It applies the D1 migrations with
   `npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc`.
6. It deploys the [ChatGPT egress Worker](../worker/chatgpt-egress/README.md)
   with Docker, unless the last complete egress deploy had the same inputs
   and its version is still live.
   - The inputs are the files of `worker/chatgpt-egress` and
     `tools/chatgpt-egress` without the tests and the README, and the
     current digest of the base image of the Dockerfile. A new base image
     therefore deploys at the next run. A failed read of an input stops
     the step, except the digest, which then counts as changed.
   - The step tags the new version with a hash of the inputs.
   - After a complete deploy, the step writes a GitHub deployment of the
     environment `chatgpt-egress`. It holds the version ID and the tag. The
     next run compares that record with the live version.
   - A failure of this deploy gives a warning and does not stop the run.
     The next run deploys the egress Worker again.
7. It makes a new random deploy token, and deploys the Worker with
   `npx wrangler deploy`. A `--var` option sets the SHA-256 digest of the token. The deploy
   also publishes the model list and app default from `wrangler.jsonc`.
8. It checks that `https://app.conductive.build/api/health` answers
   `{"status":"ok"}`. When that answer does not come within about a
   minute, the run fails.
9. It publishes the newest-version JSON only for a higher version. It reads
   the current JSON directly from R2 and checks the public size after upload.
10. It asks the Worker for the
   [software image](protocol/org-image.md#the-software-image) of the new
   version, with the deploy token, and waits for it for up to 15 minutes.
   The log of the run shows the output of the build. When the image of
   that version is already ready, the step ends at once. When the image is
   not ready at the end of the step, a later job fails the run, and the
   summary names the cause.

A failed step stops the run, except a failed deploy of the egress Worker.
An app build error stops the run before it changes anything live.

- The `--var` option sets only `CONDUCTIVE_DEPLOY_TOKEN_SHA256`.
  The token itself stays in the deploy job. The values in `wrangler.jsonc`
  replace the corresponding Worker variables. This includes
  `CONDUCTIVE_MODELS` and `CONDUCTIVE_DEFAULT_CHOICE`, as
  [Models](deployment/models.md#models) says. Other dashboard variables stay on
  the Worker, because `wrangler.jsonc` sets `keep_vars`. The deploy changes
  no secret.
- The deploy tags the new Worker version with the short commit hash. So
  the Cloudflare dashboard shows which commit is live.
- The summary of each run names the commit, the release version and publication result, the result of the egress deploy, and the result
  of the software image.
- The health route reads no D1 data and gives no version. So the check
  proves only that the Worker answers. Wrangler names the deployed version
  in the log of the run.

## When a deploy fails

A failed run does not roll back.

- A failed deploy of the egress Worker warns, and the run goes on. The
  next run deploys it again, because no record of a complete deploy names
  the live version. A failure before the upload leaves the last egress
  version live. A failure after the upload leaves the new version live,
  with the image of its own version. A missing Containers Edit permission
  is the usual cause.

- A run can fail after the new Worker is live, when its software image is
  not ready at the end of the wait. The Worker stays live. Builds of an
  org without an org image then install the app's own software, until a
  later run makes the software image. Re-run all jobs or Re-run failed
  jobs tries again with a new deploy. The next push also tries again.
- Between the migrations and the Worker upload, the old Worker runs on the
  new schema. A failed upload leaves the old Worker on the new schema until
  the next deploy.
- [`npx wrangler rollback`](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
  restores an earlier version of the Worker. Without a version ID, it
  restores the version before the newest one.
- A rollback does not undo a D1 migration. It cannot go back across a
  Durable Object migration.
- `migrations/202611092305_org_images.sql` is for the time before the
  launch only, while no real user depends on the app. It copies the six org
  image fields of `settings` to `org_images`, then drops them, with no
  bridge for an older Worker. A Worker version from before it reads those
  fields, so that version cannot use the new schema, after a failed upload
  or after a rollback to it. To recover, deploy a fix forward. Or restore
  D1 with Time Travel to a minute before the migration, together with a
  Worker rollback to a version from before it. That restore loses each D1
  write after that minute.
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  restores the database to an earlier minute. Run
  `npx wrangler d1 time-travel restore DB --timestamp=<time>`, with a Unix
  timestamp or an RFC 3339 time.

## Deploys from other branches

Only `main` deploys. A Worker deploy by hand from another branch stays live
only until the next merge. A migration, a D1 write, or a secret change by
hand stays after that merge.
