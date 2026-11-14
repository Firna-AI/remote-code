import type { AgentModel } from '../../shared/generated/AgentModel'
import { useEffect, type ReactNode } from 'react'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import {
  draftReady,
  firstReadyRepository,
  type CreateState,
  type Draft,
  type NewWorkspaceModel,
} from '../../app/new-workspace-model'
import { mayChangeSettings } from '../../app/permissions'
import {
  waitingRepositoriesOf,
  type WaitingRepositories,
} from '../../app/repository-changes'
import { routes } from '../../app/router'
import { useStore, valueOf } from '../../app/store'

import type { Repository } from '../../shared/org-settings'
import type { OrgSummary } from '../../shared/orgs'
import { useApp, useOfferedModels, useOrgAccess, useOrgModel } from '../context'
import { useGo } from '../ui/AppLink'
import {
  createFailure,
  useBlockingNotice,
  useFirstBuildNotice,
} from './notices'
import { waitingNotice } from './waiting'

/** A New workspace form, as the page and the dialog show it. */
export interface NewWorkspaceForm {
  draft: Draft
  create: CreateState
  /** The repositories that the org chose, or `undefined` while they load. */
  repositories: readonly Repository[] | undefined
  /**
   * The repository of the draft, else the first chosen one that is ready,
   * else the first chosen one.
   */
  repository: Repository | undefined
  /** The chosen repositories that wait for a build, which the menu shows off. */
  waiting: WaitingRepositories
  choice: AgentChoice | undefined
  /**
   * The models that the picker offers: the models of the app without those
   * that the person's own endpoint does not list, with the model of the
   * form kept.
   */
  models: readonly AgentModel[]
  /** The notice of a failed create, with Try again, or `null`. */
  failure: ReactNode
  /**
   * The notice of a build that the form waits for, or `null`: the first
   * build of the org, or the build of the repository of the form.
   */
  buildNotice: ReactNode
  /** The notice of a missing agent login, or `null`. It holds the message. */
  notice: ReactNode
  /** Whether the message can go now: by Send, Create, Try again, and Enter. */
  ready: boolean
  /** Sends the message. Nothing goes while the message is not ready. */
  send: () => void
}

/**
 * The state of a New workspace form, which the page and the dialog share,
 * so that they cannot drift: the repository, the model, the notices, one
 * readiness for every way to send, and the send. The readiness reads the
 * text and the files of the draft, the agent login, the org image, the
 * repository, the model, and the suspension of the org. The form picks the
 * first ready repository. A draft keeps its own, also while it waits for a
 * build: the pick of the user, or the repository that the form showed at
 * its first text or file, as `NewWorkspaceModel` says. When the server
 * accepts the create, the app opens the new workspace, also when the form
 * closed while the create ran. `open` goes to another page from a notice,
 * such as Connect.
 */
export function useNewWorkspaceForm(
  org: OrgSummary,
  model: NewWorkspaceModel,
  open: (to: string) => void,
): NewWorkspaceForm {
  const app = useApp()
  const go = useGo()
  const orgModel = useOrgModel(org.id)
  const account = useStore(app.account.account)
  const models = useStore(app.models)
  const loaded = valueOf(useStore(orgModel.repositories))
  const builds = valueOf(useStore(orgModel.builds))
  const draft = useStore(model.draft)
  const create = useStore(model.create)
  const access = useOrgAccess(org)
  useEffect(() => orgModel.watch('repositories', 'builds', 'list'), [orgModel])
  const repositories = loaded?.filter((item) => item.selected)
  const waiting = waitingRepositoriesOf(builds)
  const repositoryId =
    draft.repository?.id ?? firstReadyRepository(repositories ?? [], builds)?.id
  const repository = repositories?.find((item) => item.id === repositoryId)
  const choice = draft.choice ?? account?.defaultChoice
  const offered = useOfferedModels(choice)
  const notice = useBlockingNotice(choice, models, open)
  // The first build and a waiting repository never show together: the
  // Worker lists no waiting repository before the first good build.
  const buildNotice =
    useFirstBuildNotice(org, open) ??
    waitingNotice({
      org,
      admin: mayChangeSettings(access),
      repositories: repositories ?? [],
      repository,
      waiting,
      open,
    })
  const defaults =
    !access.suspended &&
    notice === null &&
    buildNotice === null &&
    repositoryId !== undefined &&
    choice !== undefined &&
    draftReady(draft)
      ? { repositoryId, choice }
      : null
  const send = () => {
    if (!defaults) return
    void model.send(defaults, (created) =>
      go(routes.workspace(org.id, created.workspace.id)),
    )
  }
  return {
    draft,
    create,
    repositories,
    repository,
    waiting,
    choice,
    models: offered,
    failure: createFailure(create, defaults !== null, send),
    buildNotice,
    notice,
    ready: defaults !== null,
    send,
  }
}
