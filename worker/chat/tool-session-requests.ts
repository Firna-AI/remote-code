import type { AgentSessionAccepted } from '../../src/shared/generated/AgentSessionAccepted'

export interface ToolSessionRequest {
  fingerprint: string
  requestedSessionId?: string
  accepted: AgentSessionAccepted
}
