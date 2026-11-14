import { MACHINE_PATHS } from './agent-tools.ts'

export function agentSectionDeletePath(sectionId: string): string {
  return `${MACHINE_PATHS.sections}/${encodeURIComponent(sectionId)}/delete`
}
