import type { AppEnv } from './env'
export function appFrameSources(
  env: Pick<AppEnv, 'PREVIEW_DOMAIN' | 'CONDUCTIVE_FRAME_SOURCES'>,
): string[] {
  const configured = (env.CONDUCTIVE_FRAME_SOURCES ?? '')
    .split(/\s+/)
    .filter((source) => /^https:\/\/[A-Za-z0-9*.-]+(?::[0-9]+)?$/.test(source))
  return [
    ...new Set([
      ...(env.PREVIEW_DOMAIN ? [`https://*.${env.PREVIEW_DOMAIN}`] : []),
      ...configured,
    ]),
  ]
}
