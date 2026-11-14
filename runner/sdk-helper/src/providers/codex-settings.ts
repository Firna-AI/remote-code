import { providerEnvironment } from './environment'
import { codexStorageHome } from './codex-credentials'
import { object } from '../parse'
import type { JsonRpc } from './rpc'
import type { ProviderOptions } from './types'

export function codexSettings(options: ProviderOptions) {
  const env = providerEnvironment(
    options.home,
    options.tools,
    options.commitAuthor,
  )
  const tokenMode =
    options.credential.type === 'gateway' &&
    options.credential.agent === 'codex' &&
    options.credential.kind === 'token'
  return {
    env,
    tokenMode,
    modelProvider: tokenMode ? 'openai' : 'conductive',
    config: tokenMode
      ? {
          model_provider: 'openai',
          chatgpt_base_url: `${options.endpoint}/backend-api`,
          openai_base_url: `${options.endpoint}/backend-api/codex`,
          'features.enable_request_compression': false,
          cli_auth_credentials_store: 'file',
          sqlite_home: codexStorageHome(options.home),
        }
      : {
          model_provider: 'conductive',
          'model_providers.conductive.name': 'Conductive',
          'model_providers.conductive.base_url': options.endpoint,
          'model_providers.conductive.wire_api': 'responses',
          'model_providers.conductive.requires_openai_auth': true,
          cli_auth_credentials_store: 'ephemeral',
        },
  }
}

export async function checkCodexGateway(
  rpc: JsonRpc,
  endpoint: string,
): Promise<void> {
  await rpc.request('account/read', {})
  const response = object(await rpc.request('configRequirements/read', {}))
  const required = response.requirements
    ? object(response.requirements).chatgptBaseUrl
    : null
  if (
    required !== null &&
    required !== undefined &&
    !sameAddress(required, `${endpoint}/backend-api`)
  )
    throw new Error(
      "This ChatGPT workspace requires another Codex address. Ask its admin to allow Conductive's address.",
    )
}

function sameAddress(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false
  try {
    return (
      new URL(value).href.replace(/\/$/, '') ===
      new URL(expected).href.replace(/\/$/, '')
    )
  } catch {
    return false
  }
}
