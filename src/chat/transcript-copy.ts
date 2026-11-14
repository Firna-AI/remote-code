import type { TranscriptDetail } from '../shared/generated/TranscriptDetail'
import { copyText } from '../app/clipboard'
import { browserDelay } from '../app/events'
import type { AppServices } from '../app/services'

import type { ChatApi, WorkspaceTarget } from './api/client'

/**
 * The clipboard, the clock, and the timers of a copy. Its identity keeps
 * the text of a refused copy, so give each press the same object.
 */
export type CopyServices = Pick<AppServices, 'copy' | 'now' | 'delay'>

/** The clipboard, the clock, and the timers of the browser. */
export const browserCopy: CopyServices = {
  copy: (text) => copyText(window, text),
  now: () => Date.now(),
  delay: browserDelay,
}
type Entry =
  | { kind: 'pending' }
  | { kind: 'ready'; text: string; expiresAt: number; cancel: () => void }

const caches = new WeakMap<CopyServices, Map<string, Entry>>()
const RETAIN_MS = 60_000

export interface TranscriptCopyOptions {
  services: CopyServices
  api: Pick<ChatApi, 'transcript'>
  target: WorkspaceTarget
  sessionId: string
  detail: TranscriptDetail
}

/** Call during the press. A refused clipboard write retains only resolved text. */
export async function copyTranscript(
  options: TranscriptCopyOptions,
): Promise<void> {
  const { services, api, target, sessionId, detail } = options
  let cache = caches.get(services)
  if (!cache) {
    cache = new Map()
    caches.set(services, cache)
  }
  const entries = cache
  const key = JSON.stringify([
    target.orgId,
    target.workspaceId,
    sessionId,
    detail,
  ])
  const previous = entries.get(key)
  if (previous?.kind === 'ready') {
    entries.delete(key)
    previous.cancel()
    if (previous.expiresAt > services.now()) return services.copy(previous.text)
  }
  const attempt: Entry = { kind: 'pending' }
  entries.set(key, attempt)
  const pending = api
    .transcript(sessionId, detail)
    .then((reply) => reply.markdown)
  // This observer survives an early clipboard failure, including request failure.
  const resolved = pending.then(
    (text) => ({ ok: true as const, text }),
    () => ({ ok: false as const }),
  )
  try {
    await services.copy(pending)
    if (entries.get(key) === attempt) entries.delete(key)
  } catch (error) {
    void resolved.then((result) => {
      if (entries.get(key) !== attempt) return
      if (!result.ok) {
        entries.delete(key)
        return
      }
      const ready = {
        kind: 'ready' as const,
        text: result.text,
        expiresAt: services.now() + RETAIN_MS,
        cancel: () => {},
      }
      entries.set(key, ready)
      ready.cancel = services.delay(RETAIN_MS, () => {
        if (entries.get(key) === ready) entries.delete(key)
      })
    })
    throw error
  }
}
