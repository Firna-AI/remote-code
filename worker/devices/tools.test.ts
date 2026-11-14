import { afterEach, beforeEach, expect, it } from 'vitest'

import { deviceObject, readDeviceRecord } from '../../src/shared/device-read'
import { sessionPaths } from '../../src/shared/sessions'
import { deviceFixture, WID, type DeviceFixture } from './runtime.test-support'
import { connected, ref, result, sendFrame } from './requests.test-support'

let fixture: DeviceFixture
beforeEach(async () => {
  fixture = await deviceFixture()
})
afterEach(async () => {
  await fixture?.dispose()
})

it.each(['.', '..'])(
  'runs a Mac command with retry ID %s through the real Worker and active stored turn',
  async (requestId) => {
    const mac = await connected(fixture)
    const input = fixture.input(requestId)
    const accepted = await fixture.machine(input)
    expect(accepted.status).toBe(202)
    const command = readDeviceRecord(
      deviceObject(await accepted.json()).request,
    )
    expect(command.requestId).toBe(input.requestId)
    expect(await mac.inbox.next()).toMatchObject({
      type: 'command.request',
      request: {
        workspaceId: WID,
        sender: { id: 'sender' },
        command: input.command,
      },
    })
    await sendFrame(mac, { type: 'command.approved', ...ref(input.requestId) })
    await sendFrame(mac, {
      type: 'command.result',
      ...ref(input.requestId),
      result,
    })
    const completed = await fixture.readCommand(command.requestKey)
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      request: { state: 'completed', result },
    })
  },
)

it('refuses Mac command reads after Stop and cancels the stored command', async () => {
  const mac = await connected(fixture)
  const input = fixture.input()
  const accepted = await fixture.machine(input)
  expect(accepted.status).toBe(202)
  const command = readDeviceRecord(deviceObject(await accepted.json()).request)
  expect(await mac.inbox.next()).toMatchObject({
    type: 'command.request',
    request: { requestId: input.requestId },
  })
  await sendFrame(mac, { type: 'command.approved', ...ref(input.requestId) })
  const stopped = await fixture.app(
    sessionPaths.interrupt('org', WID, fixture.sessionId),
    { turnId: fixture.turnId },
  )
  expect(stopped.status).toBe(200)
  expect(await mac.inbox.next()).toEqual({
    type: 'command.cancel',
    ...ref(input.requestId),
  })
  const refused = await fixture.readCommand(command.requestKey)
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({
    error: {
      code: 'calling_turn_required',
      message: 'Start this request from an active agent turn.',
    },
  })
})
