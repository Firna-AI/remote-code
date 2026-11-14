import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
import { useCallback, useContext, type ReactNode } from 'react'
import { ToastContext, ToastProvider, useToast } from '@firna/ui/toast'
import { transcriptToasts } from '../../../docs/mockups/src/components/workspace/transcriptCopy'

import type { ChatController } from '../state/controller'
import type { CopyServices } from '../transcript-copy'

/**
 * The toasts of the chat: those of the host, such as the toasts of the app,
 * else its own. Its own show at the bottom right of the window, where the
 * app shows its toasts too.
 */
export function ChatToasts(props: { children: ReactNode }) {
  const host = useContext(ToastContext)
  if (host) return props.children
  return <ToastProvider>{props.children}</ToastProvider>
}

/**
 * The copy of the transcript of a session from its tab menu, as
 * `copyTranscript` says, and a toast with its result. The press of the item
 * calls it, so that the clipboard write starts during the press. It selects
 * no tab, loads no history, and saves no view. `services` must be stable,
 * because they keep the text of a copy that the clipboard refused.
 */
export function useTranscriptCopy(
  controller: ChatController,
  services: CopyServices,
): (sessionId: string, detail: TranscriptDetail) => void {
  const { toast } = useToast()
  return useCallback(
    (sessionId, detail) => {
      void controller.copyTranscript(services, sessionId, detail).then(
        () => toast({ title: transcriptToasts.copied, tone: 'success' }),
        () => toast({ title: transcriptToasts.failed, tone: 'error' }),
      )
    },
    [controller, services, toast],
  )
}
