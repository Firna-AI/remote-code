import type { AppDependencies, AppEnv } from '../env'
import { featureSectionWrite } from '../app-api/feature-sections'
import { requireShellWriter } from '../app-api/feature-shell-access'
import { record, text } from './input'
import { toolUser } from './composition-data'
import { orgSections } from './store'
import type { ToolSectionWrite } from './services'

export async function writeSectionFromTool(
  env: AppEnv,
  dependencies: AppDependencies,
  input: ToolSectionWrite,
) {
  const user = await toolUser(env.DB, input.orgId, input.senderUserId)
  const org = await requireShellWriter(env.DB, input.orgId, user.id)
  const response = await featureSectionWrite(
    { method: input.kind === 'create' ? 'POST' : 'DELETE' },
    env,
    {
      user,
      org,
      body: input.kind === 'create' ? { name: input.name } : null,
    },
    dependencies,
    input.kind === 'create' ? null : input.sectionId,
  )
  if (input.kind === 'delete')
    return {
      deleted: !(await orgSections(env.DB, input.orgId)).some(
        (section) => section.id === input.sectionId,
      ),
    }
  const fields = record(record(await response.json()).section)
  if (typeof fields.isDefault !== 'boolean')
    throw new Error('Invalid section response')
  return {
    section: {
      id: text(fields.id),
      name: text(fields.name),
      default: fields.isDefault,
    },
  }
}
