import { object, string } from '../parse'
import { JsonRpcError, type JsonRpc } from './rpc'
import type { ProviderOptions } from './types'

export async function openCodexThread(
  rpc: JsonRpc,
  options: ProviderOptions,
  modelProvider: string,
): Promise<string> {
  const params = {
    ...(options.conversationId ? { threadId: options.conversationId } : {}),
    model: options.choice.model,
    modelProvider,
    cwd: options.cwd,
    developerInstructions: options.instructions,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  }
  let response: unknown
  try {
    response = await rpc.request(
      options.conversationId ? 'thread/resume' : 'thread/start',
      params,
    )
  } catch (error) {
    if (!options.conversationId || !providerChanged(error)) throw error
    response = await rpc.request('thread/fork', params)
  }
  return string(object(object(response).thread).id)
}

function providerChanged(error: unknown): boolean {
  if (!(error instanceof JsonRpcError)) return false
  const data = error.data
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data.type === 'modelProviderMismatch' ||
      data.type === 'modelProviderNotConfigured')
  )
}
