import {
  Miniflare,
  Response as RuntimeResponse,
  type StructuredLogsHandler,
} from 'miniflare'

import type { AppEnv, HttpFetch } from '../../env'
import { LifecycleBoat } from '../../lifecycle/lifecycle-boat-test-support'
import { withSoftwareRelease } from '../../lifecycle/software-release-test-support'
import { FakeGitHub } from '../../test-support/fake-github'
import { TEST_ORIGIN } from '../../test-support/harness'
import {
  migratedStorage,
  TEST_D1_ID,
} from '../../test-support/migrated-storage'
import { workerLibraryBundle } from '../../test-support/test-bundles'
import { seedOuterRuntime } from './outer-seed.test-support'

export const OUTER_MACHINE_ORIGIN = 'https://api.conductive.test'

type OuterConfiguration = Partial<
  Pick<
    AppEnv,
    | 'CONDUCTIVE_MODELS'
    | 'CONDUCTIVE_DEFAULT_CHOICE'
    | 'GITHUB_APP_PRIVATE_KEY'
    | 'GITHUB_WEBHOOK_SECRET'
    | 'PREVIEW_DOMAIN'
  >
>

export function outerWorkerBundle(
  entryPath = 'worker/index.ts',
): Promise<string> {
  return workerLibraryBundle(entryPath)
}

export async function createOuterRuntime(
  bundle: string,
  options: {
    appOrigin?: string
    appOriginBinding?: string | null
    port?: number
    assetsDirectory?: string
    https?: boolean
    configuration?: OuterConfiguration
    persistencePath?: string
    handleStructuredLogs?: StructuredLogsHandler
    outbound?: (
      request: Request,
      fallback: HttpFetch,
    ) => Promise<Response | RuntimeResponse>
  } = {},
) {
  const appOrigin = options.appOrigin ?? TEST_ORIGIN
  const boat = new LifecycleBoat()
  const github = new FakeGitHub()
  const requests: string[] = []
  const text = (value: string) => ({ type: 'text' as const, value })
  const configuration: Record<string, ReturnType<typeof text>> = {}
  for (const [name, value] of Object.entries(options.configuration ?? {})) {
    if (typeof value === 'string') configuration[name] = text(value)
  }
  // A caller's persistence folder starts empty, so it takes the template.
  // The caller keeps that folder, so dispose removes only an own folder.
  const storage = await migratedStorage(options.persistencePath)
  const ownStorage = options.persistencePath === undefined
  const removeStorage = () => (ownStorage ? storage.remove() : undefined)
  const createRuntime = () =>
    new Miniflare({
      host: '127.0.0.1',
      port: options.port,
      https: options.https,
      enableDevRegistry: false,
      telemetry: { enabled: false },
      cf: false,
      handleStructuredLogs: options.handleStructuredLogs,
      resourcePersistencePath: storage.path,
      workers: [
        {
          config: {
            name: 'outer-chat-tests',
            compatibilityDate: '2026-11-06',
            compatibilityFlags: ['global_fetch_strictly_public'],
            exports: {
              Workspace: { type: 'durable-object', storage: 'sqlite' },
            },
            env: {
              DB: { type: 'd1', id: TEST_D1_ID },
              CHAT_ATTACHMENTS: { type: 'r2', name: 'outer-chat-attachments' },
              WORKSPACES: {
                type: 'durable-object',
                worker: 'outer-chat-tests',
                exportName: 'Workspace',
              },
              ...(options.appOriginBinding === null
                ? {}
                : { APP_ORIGIN: text(options.appOriginBinding ?? appOrigin) }),
              MACHINE_ORIGIN: text(OUTER_MACHINE_ORIGIN),
              GITHUB_CLIENT_ID: text('outer-client'),
              GITHUB_CLIENT_SECRET: text('outer-client-secret'),
              SESSION_SIGNING_KEY: text(btoa('s'.repeat(32))),
              BOAT_KEY_ENCRYPTION_KEY: text(btoa('e'.repeat(32))),
              BOAT_API_KEY: text(boat.server.apiKey),
              BOAT_ORG_ID: text(boat.server.orgId),
              ...configuration,
              ...(options.assetsDirectory
                ? { ASSETS: { type: 'assets' as const } }
                : {}),
            },
            ...(options.assetsDirectory
              ? {
                  assets: {
                    directory: options.assetsDirectory,
                    notFoundHandling: 'single-page-application' as const,
                    runWorkerFirst: true,
                    hasUserWorker: true,
                  },
                }
              : {}),
            manifest: {
              mainModule: 'index.js',
              modules: { 'index.js': { type: 'esm', contents: bundle } },
            },
          },
          dev: {
            outboundService: {
              type: 'fetcher',
              handler: async (incoming) => {
                requests.push(incoming.url)
                const request = new Request(incoming.url, {
                  method: incoming.method,
                  headers: [...incoming.headers.entries()],
                  body: ['GET', 'HEAD'].includes(incoming.method)
                    ? undefined
                    : await incoming.arrayBuffer(),
                  redirect: 'manual',
                })
                const fallback = withSoftwareRelease(
                  new URL(request.url).hostname === 'boat.dev'
                    ? boat.fetch
                    : github.fetch,
                )
                const response = await (options.outbound
                  ? options.outbound(request, fallback)
                  : fallback(request))
                if (
                  response instanceof RuntimeResponse &&
                  response.status === 101 &&
                  response.webSocket
                )
                  return response
                return new RuntimeResponse(
                  [204, 205, 304].includes(response.status)
                    ? null
                    : await response.arrayBuffer(),
                  {
                    status: response.status,
                    headers: [...response.headers.entries()],
                  },
                )
              },
            },
          },
        },
      ],
    })
  let runtime = createRuntime()
  try {
    const db = await runtime.getD1Database('DB')
    const env: AppEnv = {
      DB: db,
      CHAT_ATTACHMENTS: (
        await runtime.getBindings<{ CHAT_ATTACHMENTS: R2Bucket }>()
      ).CHAT_ATTACHMENTS,
      APP_ORIGIN: appOrigin,
      MACHINE_ORIGIN: OUTER_MACHINE_ORIGIN,
      GITHUB_CLIENT_ID: 'outer-client',
      GITHUB_CLIENT_SECRET: 'outer-client-secret',
      SESSION_SIGNING_KEY: btoa('s'.repeat(32)),
      BOAT_KEY_ENCRYPTION_KEY: btoa('e'.repeat(32)),
      BOAT_API_KEY: boat.server.apiKey,
      BOAT_ORG_ID: boat.server.orgId,
      ...options.configuration,
    }
    const cookies = await seedOuterRuntime(env)
    const headers = {
      Cookie: cookies.ownerCookie,
      Origin: appOrigin,
      'Content-Type': 'application/json',
    }
    const request = (
      path: string,
      init: { method?: string; headers?: HeadersInit; body?: string } = {},
    ) => {
      const requestHeaders = new Headers(headers)
      new Headers(init.headers).forEach((value, name) => {
        requestHeaders.set(name, value)
      })
      return runtime.dispatchFetch(`${appOrigin}${path}`, {
        ...init,
        headers: [...requestHeaders.entries()],
      })
    }
    return {
      get runtime() {
        return runtime
      },
      env,
      boat,
      github,
      requests,
      cookies,
      headers,
      request,
      restart: async () => {
        if (!options.persistencePath)
          throw new Error('The restart fixture needs persistent storage.')
        await runtime.dispose()
        runtime = createRuntime()
        env.DB = await runtime.getD1Database('DB')
        env.CHAT_ATTACHMENTS = (
          await runtime.getBindings<{ CHAT_ATTACHMENTS: R2Bucket }>()
        ).CHAT_ATTACHMENTS
      },
      dispose: async () => {
        await runtime.dispose()
        await removeStorage()
      },
    }
  } catch (error) {
    await runtime.dispose()
    await removeStorage()
    throw error
  }
}

export type OuterRuntime = Awaited<ReturnType<typeof createOuterRuntime>>
