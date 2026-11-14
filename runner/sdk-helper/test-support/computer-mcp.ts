import { onTestFinished, vi } from 'vitest'

import * as computer from '../src/providers/computer-mcp'

export const fakeComputerServer = {
  type: 'stdio' as const,
  command: '/fake/platform/computer-server',
  args: ['--socket', '/run/test-computer.sock'],
}

export function mockComputerServer(): void {
  const read = vi
    .spyOn(computer, 'readComputerServer')
    .mockResolvedValue(fakeComputerServer)
  onTestFinished(() => read.mockRestore())
}
