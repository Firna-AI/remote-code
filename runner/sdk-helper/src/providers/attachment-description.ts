import type { RunnerAttachment } from '../generated/RunnerAttachment'
import type { ProviderInput } from '../generated/ProviderInput'

export const attachmentReadInstruction =
  'The sender attached these files. Read each file before you answer.'

export function attachmentDescription(
  command: ProviderInput,
  attachment: RunnerAttachment,
): string {
  const metadata = command.message.attachments.find(
    (item) => item.id === attachment.attachmentId,
  )
  return `Attached file: ${JSON.stringify({
    name: metadata?.name,
    mediaType: metadata?.mediaType,
    path: attachment.path,
    sizeBytes: metadata?.sizeBytes,
  })}`
}
