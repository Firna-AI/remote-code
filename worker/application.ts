import { API_PATHS } from '../src/shared/api'
import { MACHINE_PATHS } from '../src/shared/agent-tools'
import {
  GITHUB_INSTALL_PATH,
  GITHUB_SETUP_PATH,
} from '../src/shared/github-setup'
import { HEALTH_PATH, type HealthResponse } from '../src/shared/health'
import { SITE_FOLDER } from '../src/shared/site-build'
import type { AppDependencies, AppEnv } from './env'
import { githubInstallResponse, githubSetupResponse } from './github-setup'
import { hostStub, hostSurface, marketingResponse } from './hosts'
import {
  errorResponse,
  HttpError,
  previewResponse,
  privateResponse,
} from './http'
import { requestBodyEntry } from './http/request-body'
import { chatGptEgress } from './model-gateway/egress'
import { routeModelGateway } from './model-gateway/route'
import { gatewayWorkspaceAllowed } from './model-gateway/workspace-access'
import { route, routeDevice } from './routes'
import { workspaceBinding } from './app-api/workspace-state'
import { routeChat, routeRunner } from './chat/router'
import { isDeviceAppPath, isDeviceMachinePath } from './devices/paths'
import { routeMacCommand } from './tools/mac-command'
import { appOrigin } from './security/app-origin'
import { handleGitCredential } from './lifecycle/machine'
import {
  handleImageSourceCredential,
  IMAGE_SOURCE_CREDENTIAL_PATH,
} from './lifecycle/image-sources/credential'
import { imageRuntime, workspaceRuntime } from './lifecycle/runtime'
import { repairLifecycleAlarms } from './lifecycle/repair'
import { repairSoftwareImages } from './software-image/repair'
import {
  handleSoftwareImage,
  SOFTWARE_IMAGE_PATH,
} from './software-image/route'
import { finishSignIn, startSignIn } from './security/auth'
import { appContentSecurityPolicy } from './security/content-security'
import { cookie, OAUTH_COOKIE } from './security/cookies'
import { randomToken } from './security/crypto'
import { finishDesktopSignIn } from './security/desktop-auth'
import { DESKTOP_EXCHANGE_PATH } from './security/desktop-contract'
import { desktopCors, desktopPreflight } from './security/desktop-origin'
import { checkOrigin, sessionGate } from './security/gate'
import { membersGate } from './members/gate'
import { productionMembersHooks } from './members/composition'
import { cleanupDeletedOrgs } from './members/cleanup'
import { routePreview, routeWorkspaceFeatures } from './features/router'
import { productionAgentTools } from './tools/composition'
import { isAgentToolPath } from './tools/lists'
import { productionGitHubWebhook } from './github/composition'
import { appFrameSources } from './configuration'
import { latestSoftwareRelease } from './lifecycle/software-release'
import { appSiteResponse } from './marketing/assets'
import { retryApprovalEmails } from './operator/approval-email'
import { freshCodexLogin } from './codex-auth/renew'
import { codexTaskOwner } from './codex-auth/tasks'
import { failCodexAccessToken } from './codex-auth/failure'
import { waitForCodexRotation } from './codex-auth/rotation'
import { cleanupCodexDevices } from './codex-auth/device-store'
import { warnWorker } from './warnings'
import { routineRunRuntime } from './routines/run-runtime'
import { scanRoutineSchedules } from './routines/schedule-scan'

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const dependencies: AppDependencies = {
    fetch: (request) => fetch(request),
    now: Date.now,
    randomToken,
    ...overrides,
  }
  const application = {
    async fetch(
      request: Request,
      env?: AppEnv,
      execution?: Pick<ExecutionContext, 'waitUntil'>,
    ): Promise<Response> {
      const codexTasks = codexTaskOwner(execution)
      const path = new URL(request.url).pathname
      const upgrade = request.headers.has('Upgrade')
      const health =
        path === HEALTH_PATH && request.method === 'GET' && !upgrade
      let appApi = false
      const respond = (response: Response) => {
        privateResponse(response)
        return appApi ? desktopCors(request, response) : response
      }
      try {
        // A binding-free health call also supports the bootstrap smoke check.
        if (!env && health) return healthResponse()
        if (!env)
          throw new HttpError(
            503,
            'service_unavailable',
            'The app is not available. Try again.',
          )
        const origin = appOrigin(request, env)
        if (origin !== env.APP_ORIGIN) env = { ...env, APP_ORIGIN: origin }
        const surface = hostSurface(request, env)
        appApi = surface === 'app' && path.startsWith('/api/')
        if (surface === 'marketing') {
          return await marketingResponse(request, env, dependencies.now())
        }
        if (surface === 'preview')
          return previewResponse(await routePreview(request, env, dependencies))
        if (surface === 'app') {
          checkOrigin(request, env)
          if (appApi && !upgrade) {
            const preflight = desktopPreflight(request)
            if (preflight) return privateResponse(preflight)
          }
          if (upgrade && !appApi)
            await sessionGate(request, env, dependencies.now())
          const read =
            (request.method === 'GET' || request.method === 'HEAD') && !upgrade
          if (path === GITHUB_INSTALL_PATH && read) {
            return respond(githubInstallResponse(request, env))
          }
          if (path === GITHUB_SETUP_PATH && read) {
            return respond(await githubSetupResponse(request, env))
          }
          if (!path.startsWith('/api/') && env.ASSETS) {
            const asset = path.startsWith(`/${SITE_FOLDER}/`)
              ? await appSiteResponse(request, env.ASSETS)
              : await env.ASSETS.fetch(request)
            const response = new Response(asset.body, asset)
            response.headers.set(
              'Content-Security-Policy',
              appContentSecurityPolicy(env.APP_ORIGIN, appFrameSources(env)),
            )
            return response
          }
        }
        if (surface === 'machine' && isDeviceMachinePath(path)) {
          return respond(await routeMacCommand(request, env))
        }
        if (surface === 'machine') {
          if (path === SOFTWARE_IMAGE_PATH)
            return respond(
              await handleSoftwareImage(request, env, dependencies),
            )
          if (isAgentToolPath(path))
            return respond(
              await productionAgentTools(request, env, dependencies),
            )
          if (path === MACHINE_PATHS.githubWebhook)
            return respond(
              await productionGitHubWebhook(
                request,
                env,
                dependencies,
                execution,
              ),
            )
          if (path === MACHINE_PATHS.gitCredential) {
            const machineEnv = env
            const runtime = workspaceRuntime(
              {
                ...machineEnv,
                get WORKSPACES() {
                  return workspaceBinding(machineEnv)
                },
              },
              dependencies,
            )
            return respond(await handleGitCredential(request, runtime))
          }
          if (path === IMAGE_SOURCE_CREDENTIAL_PATH)
            return respond(await handleImageSourceCredential(request, env))
          const gatewayEnv = env
          const gatewayResponse = await routeModelGateway(request, {
            codexTasks,
            ...workspaceRuntime(
              gatewayEnv,
              chatGptEgress(gatewayEnv, dependencies),
            ),
            previewDomain: gatewayEnv.PREVIEW_DOMAIN,
            workspaceAllowed: (id) =>
              gatewayWorkspaceAllowed(gatewayEnv.DB, id),
            codexLogin: (userId, failed) =>
              freshCodexLogin(
                gatewayEnv,
                userId,
                dependencies,
                codexTasks,
                failed,
              ),
            codexLoginFailed: (userId, failed) =>
              failCodexAccessToken(gatewayEnv, userId, failed),
            codexWaitForRotation: (userId, failed, pending) =>
              waitForCodexRotation(
                gatewayEnv,
                userId,
                failed,
                dependencies,
                pending,
              ),
          })
          if (gatewayResponse) return respond(gatewayResponse)
          const runnerResponse = await routeRunner(request, env)
          if (runnerResponse) return respond(runnerResponse)
        }
        if (surface !== 'app' || !path.startsWith('/api/')) {
          return privateResponse(hostStub(surface))
        }
        if (health) return respond(healthResponse())
        if (
          request.method === 'GET' &&
          !upgrade &&
          (path === API_PATHS.githubSignIn || path === API_PATHS.githubCallback)
        ) {
          return respond(
            await (path === API_PATHS.githubSignIn
              ? startSignIn(env, dependencies, request)
              : finishSignIn(request, env, dependencies)),
          )
        }
        if (
          path === DESKTOP_EXCHANGE_PATH &&
          request.method === 'POST' &&
          !upgrade
        ) {
          return respond(await finishDesktopSignIn(request, env, dependencies))
        }
        if (isDeviceAppPath(path))
          return respond(await routeDevice(request, env, dependencies.now()))
        const chatResponse = await routeChat(
          request,
          env,
          dependencies.now,
          dependencies.randomToken,
        )
        if (chatResponse) return respond(chatResponse)
        const featureResponse = await routeWorkspaceFeatures(
          request,
          env,
          dependencies.now(),
        )
        if (featureResponse) return respond(featureResponse)
        const context = await membersGate(request, env, dependencies.now())
        return respond(
          await route(
            request,
            env,
            context,
            dependencies,
            codexTasks,
            execution,
          ),
        )
      } catch (error) {
        const response = errorResponse(error)
        if (path === API_PATHS.githubCallback) {
          response.headers.append('Set-Cookie', cookie(OAUTH_COOKIE, '', 0))
        }
        return respond(response)
      }
    },
  }
  return {
    fetch: requestBodyEntry(application.fetch),
    async scheduled(event: ScheduledController, env: AppEnv): Promise<void> {
      if (event.cron === '* * * * *') {
        await scanRoutineSchedules(routineRunRuntime(env, dependencies))
        return
      }
      if (event.cron !== '*/15 * * * *') return
      await cleanupCodexDevices(env.DB, dependencies.now())
      await cleanupDeletedOrgs(
        env,
        dependencies,
        productionMembersHooks(env, dependencies),
      )
      await repairLifecycleAlarms(
        workspaceRuntime(env, dependencies),
        imageRuntime(env, dependencies),
        () => latestSoftwareRelease(env, dependencies.fetch),
      )
      try {
        await repairSoftwareImages({ env, dependencies })
      } catch {
        warnWorker({ kind: 'software_image_repair_failed' })
      }
      // Last, so that a slow or failed email never holds back the repairs.
      try {
        await retryApprovalEmails(env, dependencies)
      } catch {
        warnWorker({ kind: 'approval_email_retry_failed' })
      }
    },
  }
}

function healthResponse(): Response {
  const body: HealthResponse = { status: 'ok' }
  return privateResponse(Response.json(body))
}
