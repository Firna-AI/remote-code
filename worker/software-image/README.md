# Software images

This area builds the shared sandbox software image for each app software
version. The image holds the provider's base image and the app software.
It holds no repository, org data, or credential.
Its build receives no app environment variable.
The [org lifecycle](../lifecycle/README.md) owns org builds and their pins.

## Responsibilities

- Compute the version from the release version and the exact release install command.
- Install the workspace CLI and MCP server as part of the release program.
- Keep each attempt, phase, resource intent, command offset, and output in D1.
- Build one image at a time in the default provider account.
- Recover resource requests and detached commands after a lost reply.
- Remove failed resources and old images that no unfinished org build pins.

## Deploy route

`POST /v1/deploy/software-image` runs on the machine origin.
Its JSON body supplies `tokenDigest`. Its Bearer header supplies the deploy
run's token. The gate refuses browser headers. It checks the digest against
`CONDUCTIVE_DEPLOY_TOKEN_SHA256` and accepts the token for 30 minutes after
`CF_VERSION_METADATA.timestamp`.
A valid request reads the newest sandbox release and advances its build. It returns
`state`, `phase`, `version`, and new `output`. A failed attempt also returns
`error` and `keptOutput`. Responses disable caching.

The Worker reads `releases/latest/conductive/x86_64-unknown-linux-musl`.
`CONDUCTIVE_RELEASE_SERVER` sets the base URL and defaults to `https://runner.conductive.build`.
The saved job captures the verified program URL, digest, release version, and server.
The build uses the program for check, apply, and initial confirmation.
It installs `gh`, `ttyd`, and `tmux` separately with apt.
A release lookup failure fails the deploy request with a clear software-release error.

A ready image is reused. An older unfinished version fails before the new
version starts. A failed attempt restarts only for another token digest.
The command journal keeps a repeated start attached to its original run.
The snapshot contains no command journal.

## Cron work

The scheduled Worker entry advances unfinished attempts in the default
account after lifecycle repairs. It enforces the 60-minute build limit and
retries resource cleanup. It also deletes older ready images after all
unfinished org jobs release their pins. A software image error logs a fixed
warning and does not stop other scheduled work.

## Development

Run `npm run test -- worker/software-image worker/lifecycle/software-image-start.test.ts`
from the repository root with Node 24.
The tests use local D1 and the lifecycle fake provider.

### Key Code

- [version.ts](version.ts): the hash of the release version and software command.
- [route.ts](route.ts) and [deploy-gate.ts](deploy-gate.ts): the machine route and token gate.
- [build.ts](build.ts): admission, version replacement, and resumable advancement.
- [steps.ts](steps.ts): sandbox readiness, commands, snapshot, and publication.
- [resources.ts](resources.ts): persisted allocation and snapshot requests.
- [data.ts](data.ts): D1 queries and writes guarded by phase and revision.
- [cleanup.ts](cleanup.ts): attempt cleanup and guarded old-image deletion.
- [repair.ts](repair.ts): Cron advancement and cleanup.

### Related Docs

- [Org image](../../docs/protocol/org-image.md): requirements for first builds and shared software.
- [Automatic deploys](../../docs/automatic-deploys.md): the deploy run and its result.
- [Sandbox software](../../image/README.md): the installed software.
- [Migrations](../../migrations/README.md): the records and org-job pin.
