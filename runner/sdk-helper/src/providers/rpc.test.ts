import { expect, it } from 'vitest'

import { object } from '../parse'
import type { ProcessPort } from './process'
import { JsonRpc } from './rpc'

it('keeps JSON-RPC error data and the existing error message', async () => {
  let receive: (line: string) => void = () => {}
  const port: ProcessPort = {
    write(line) {
      const request = object(JSON.parse(line))
      receive(
        JSON.stringify({
          id: request.id,
          error: {
            code: -32600,
            message: '  The saved provider is unavailable.  ',
            data: {
              type: 'modelProviderNotConfigured',
              modelProvider: 'conductive',
            },
          },
        }),
      )
    },
    onLine(listener) {
      receive = listener
    },
    onExit: () => {},
    close: () => {},
  }
  const rpc = new JsonRpc(
    port,
    () => {},
    () => {},
  )
  try {
    await expect(rpc.request('thread/resume', {})).rejects.toMatchObject({
      message: 'The saved provider is unavailable.',
      data: { type: 'modelProviderNotConfigured', modelProvider: 'conductive' },
    })
  } finally {
    await rpc.close()
  }
})
