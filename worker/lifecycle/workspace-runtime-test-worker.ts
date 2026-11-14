import type { UserMessage } from '../../src/shared/generated/UserMessage'
import { Workspace } from '../workspace'
import { providerForAccount } from '../sandbox/client'
import { DEFAULT_PROVIDER_ACCOUNT } from '../sandbox/account-identity'
import { ProviderError } from '../sandbox/errors'
import { GitHubClient } from '../security/github'
import { refreshGitHubTokens } from '../security/github-refresh'
import { installationToken } from './image-sources/github-app'
import { HttpError } from '../http'
import type { LifecycleEnvironment } from './runtime'
import type { StoredWorkspaceStartJob } from './start-job-codec'
import { START_JOB_KEY } from './start-storage'
import { DISK_KEEPALIVE_MS, IDLE_MS } from './durable-types'
import type { FirstWorkspaceMessage } from './workspace-runtime'
import {
  failAfterFirstMessageAdmission,
  holdMachineCheckpoint,
  holdResumeCompletionCheckpoint,
  readCompletionCheckpoint,
} from './runtime-checkpoint-test-support'
import type { ImageCoordinatorState } from './image-timers'
import { ManualChatClock } from '../chat/chat-clock.test-support'
import { CONNECTION_CHECK_MS } from '../security/connection-access'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { authenticateWorkspaceToken } from './tokens'
import { advanceScheduledAlarms } from './scheduled-alarms.test-support'
import { exerciseRepairBudget } from './repair-budget-native-test-support'
import { fakeAttachments } from '../test-support/attachments'

/** Test transport only. Every start and stop runs the actual Workspace implementation. */
export class WorkspaceRuntimeFixture extends Workspace {
  private heldMachine: ReturnType<typeof holdMachineCheckpoint> | undefined
  private heldCompletion:
    ReturnType<typeof holdResumeCompletionCheckpoint> | undefined
  private readonly clock: ManualChatClock
  private readonly chatIds: string[]

  constructor(context: DurableObjectState, env: LifecycleEnvironment) {
    const clock = new ManualChatClock(Date.now())
    const chatIds: string[] = []
    super(context, env, clock.now, {
      randomId: () => chatIds.shift() ?? crypto.randomUUID(),
      scheduleBrowserCheck: clock.schedule,
      resolveAttachments: async (_userId, _workspaceId, ids) => {
        const attachments = await fakeAttachments(ids)
        return {
          attachments,
          paths: attachments.map((file) => ({
            attachmentId: file.id,
            relativePath: file.path,
          })),
        }
      },
      prepareAttachments: async () => null,
    })
    this.clock = clock
    this.chatIds = chatIds
  }

  nextChatIds(ids: string[]): void {
    this.chatIds.push(...ids)
  }

  tickRunnerAccess(): Promise<void> {
    return this.tick(this.clock.now() + CONNECTION_CHECK_MS)
  }
  holdMachineCheckpoint(): void {
    this.heldMachine = holdMachineCheckpoint(this.ctx.storage)
  }
  failAfterFirstMessageAdmission(afterLifecycleWrite = false): void {
    failAfterFirstMessageAdmission(this.ctx.storage, afterLifecycleWrite)
  }
  async machineCheckpointReached(): Promise<void> {
    if (!this.heldMachine) throw new Error('No held machine checkpoint')
    await this.heldMachine.entered
  }
  holdResumeCompletion(attempt: string): void {
    this.heldCompletion = holdResumeCompletionCheckpoint(
      this.ctx.storage,
      attempt,
    )
  }
  async resumeCompletionReached(): Promise<void> {
    if (!this.heldCompletion) throw new Error('No held resume completion')
    await this.heldCompletion.entered
  }
  completionCheckpoint() {
    return readCompletionCheckpoint(this.ctx.storage, this.clock.now())
  }
  async acceptFirstFixtureMessage(
    first: FirstWorkspaceMessage,
  ): Promise<UserMessage> {
    return this.acceptLifecycleFirstMessage(first)
  }
  async tick(at?: number): Promise<void> {
    const target =
      at ??
      Math.max(
        this.clock.now(),
        (await this.ctx.storage.getAlarm()) ?? this.clock.now(),
      )
    await advanceScheduledAlarms(
      {
        now: this.clock.now,
        setTime: (value) =>
          this.clock.advance(Math.max(0, value - this.clock.now())),
      },
      target,
      () => [
        {
          storage: this.ctx.storage,
          fire: async () => {
            await this.alarm()
            await this.settledAlarms()
          },
        },
      ],
    )
  }
  async fireScheduledAlarm(): Promise<boolean> {
    if ((await this.ctx.storage.getAlarm()) === null) return false
    await this.tick()
    return true
  }
  async makeDiskRetentionDue(): Promise<void> {
    const state = await this.readLifecycle()
    if (state?.state !== 'stopped') throw new Error('No stopped lifecycle')
    const nextDiskKeepaliveAt = this.clock.now() - 1
    const stoppedAt = nextDiskKeepaliveAt - DISK_KEEPALIVE_MS
    await this.ctx.storage.put('lifecycle:state', {
      ...state,
      stoppedAt,
      nextDiskKeepaliveAt,
    })
    await this.env.DB.prepare(
      'UPDATE workspaces SET stopped_at = ?, next_disk_keepalive_at = ? WHERE id = ?',
    )
      .bind(stoppedAt, nextDiskKeepaliveAt, state.workspaceId)
      .run()
    await this.ctx.storage.setAlarm(nextDiskKeepaliveAt)
  }
  alarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }
  async lifecycleAlarmAt(): Promise<number | null> {
    return (await this.ctx.storage.get<number>('alarm:lifecycle')) ?? null
  }
  async browserAlarmAt(): Promise<number | null> {
    return (await this.ctx.storage.get<number>('alarm:browser')) ?? null
  }
  imageSchedule(): Promise<ImageCoordinatorState | undefined> {
    return this.ctx.storage.get('org-image:coordinator')
  }
  repairBudget(now: number) {
    return exerciseRepairBudget(this.env, now)
  }
  checkpoint(): Promise<StoredWorkspaceStartJob | undefined> {
    return this.ctx.storage.get(START_JOB_KEY)
  }
  async passTime(target: number): Promise<void> {
    let next = await this.ctx.storage.getAlarm()
    while (next !== null && next <= target) {
      await this.tick(Math.max(this.clock.now(), next))
      next = await this.ctx.storage.getAlarm()
    }
    await this.tick(target)
  }

  async becomeIdle(): Promise<void> {
    const state = await this.readLifecycle()
    if (!state) throw new Error('No workspace lifecycle')
    await this.passTime(
      Math.max(this.clock.now(), state.lastActivityAt + IDLE_MS),
    )
  }
}

export default {
  async fetch(request: Request, env: LifecycleEnvironment): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === MACHINE_PATHS.runner) {
      const bearer = request.headers
        .get('Authorization')
        ?.match(/^Bearer (.+)$/i)?.[1]
      const identity = await authenticateWorkspaceToken(env, bearer ?? '')
      return env.WORKSPACES.getByName(identity.workspaceId).fetch(request)
    }
    const chat = path.match(
      /^\/api\/orgs\/[^/]+\/workspaces\/([^/]+)\/(?:events|history|sessions)(?:\/|$)/,
    )
    if (chat)
      return env.WORKSPACES.getByName(decodeURIComponent(chat[1])).fetch(
        request,
      )
    const send = (request: Request) => fetch(request)
    try {
      switch (new URL(request.url).pathname) {
        case '/boat':
          await providerForAccount(env, send, DEFAULT_PROVIDER_ACCOUNT).get(
            'bx_one',
          )
          break
        case '/signin':
          await new GitHubClient(send).authorize(
            'private-code',
            'private-verifier',
            env,
          )
          break
        case '/refresh':
          await refreshGitHubTokens(env, 'private-refresh', {
            fetch: send,
            now: Date.now,
          })
          break
        case '/installation': {
          const keys = await crypto.subtle.generateKey(
            {
              name: 'RSASSA-PKCS1-v1_5',
              modulusLength: 2048,
              publicExponent: new Uint8Array([1, 0, 1]),
              hash: 'SHA-256',
            },
            true,
            ['sign', 'verify'],
          )
          if (!('privateKey' in keys))
            throw new Error('RSA key pair unavailable')
          const encoded = await crypto.subtle.exportKey(
            'pkcs8',
            keys.privateKey,
          )
          if (!(encoded instanceof ArrayBuffer))
            throw new Error('PKCS#8 key unavailable')
          const privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(encoded)))}\n-----END PRIVATE KEY-----`
          await installationToken(
            send,
            env.GITHUB_CLIENT_ID,
            privateKey,
            {
              id: 'source',
              orgId: 'org',
              fullName: 'example/source',
              defaultBranch: 'main',
              githubRepositoryId: 1,
              installationId: 91,
            },
            Date.now,
          )
          break
        }
      }
      return Response.json({ result: 'unexpected_success' })
    } catch (error) {
      if (error instanceof ProviderError)
        return Response.json({ error: error.kind, status: error.status })
      if (error instanceof HttpError)
        return Response.json({ error: error.code, status: error.status })
      if (
        error instanceof Error &&
        error.message === 'Installation access is not available'
      )
        return Response.json({ error: 'installation_refused' })
      return Response.json({ error: 'unexpected_runtime_error' })
    }
  },
}
