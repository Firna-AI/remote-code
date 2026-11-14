import type { Miniflare, WebSocket } from 'miniflare'
import { expect } from 'vitest'
import type { RunnerProtocolVersion } from '../../src/shared/generated/RunnerProtocolVersion'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { sessionsPath, sessionPaths } from '../../src/shared/sessions'
import { TEST_ORIGIN } from '../test-support/harness'
import { closeSockets } from './adapter-sockets.test-support'
import { array } from './agent-events'
import {
  CLAUDE,
  MACHINE_ORIGIN,
  WORKSPACE_ID,
  WORKSPACE_TOKEN,
} from './harness.test-support'
import { record, string } from './inputs'
import { OuterFakeRunner } from './integration/runner-socket.test-support'

export function runnerState(value: unknown): Map<string, unknown> {
  return new Map(
    array(value, (entry): [string, unknown] => {
      const pair = array(entry, (item) => item)
      return [String(pair[0]), pair[1]]
    }),
  )
}

export function runnerControls(
  runtime: Miniflare,
  headers: Record<string, string>,
) {
  const request = async (
    action: string,
    fields: Record<string, unknown> = {},
  ) => {
    const response = await runtime.dispatchFetch(
      `${TEST_ORIGIN}/__test/runner`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, ...fields }),
      },
    )
    if (response.status !== 200)
      throw new Error(
        `Runner control returned ${response.status}: ${await response.text()}`,
      )
    return record(await response.json())
  }
  return {
    request,
    hibernate: async () => {
      const before = await request('settled')
      await runtime.unsafeEvictDurableObject(
        'chat-adapter-tests',
        'Workspace',
        { name: WORKSPACE_ID, webSockets: 'hibernate' },
      )
      const after = await request('inspect')
      expect(after.instance).not.toBe(before.instance)
      expect(
        array(after.sockets, record)
          .filter((socket) => record(socket.attachment).role === 'runner')
          .map((socket) => socket.readyState),
      ).toContain(1)
      return after
    },
    connect: async (
      streamId = 'native-runner',
      eventNumber = 0,
      protocolVersion: RunnerProtocolVersion = 2,
    ) => {
      const response = await runtime.dispatchFetch(
        `${MACHINE_ORIGIN}${MACHINE_PATHS.runner}`,
        {
          headers: {
            Upgrade: 'websocket',
            Authorization: `Bearer ${WORKSPACE_TOKEN}`,
          },
        },
      )
      expect(response.status).toBe(101)
      if (!response.webSocket) throw new Error('The runner socket is missing.')
      const runner = new OuterFakeRunner(response.webSocket, WORKSPACE_ID, {
        streamId,
        eventNumber,
        protocolVersion,
      })
      expect(await runner.inbox.next()).toEqual({
        type: 'welcome',
        protocolVersion,
        streamId,
        confirmedThrough: eventNumber,
      })
      return runner
    },
    session: async () => {
      const response = await runtime.dispatchFetch(
        `${TEST_ORIGIN}${sessionsPath('org', WORKSPACE_ID)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ choice: CLAUDE }),
        },
      )
      expect(response.status).toBe(201)
      return string(record(record(await response.json()).session).id)
    },
    send: async (sessionId: string, id: string) => {
      const response = await runtime.dispatchFetch(
        `${TEST_ORIGIN}${sessionPaths.messages('org', WORKSPACE_ID, sessionId)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id,
            choice: CLAUDE,
            text: id,
            attachmentIds: [],
          }),
        },
      )
      expect(response.status).toBe(202)
      return record(await response.json())
    },
  }
}

export async function disposeRunners(
  runtime: Miniflare,
  sockets: WebSocket[],
): Promise<void> {
  await Promise.all([closeSockets(...sockets), runtime.dispose()])
}
