import type { AgentChoice } from '../shared/generated/AgentChoice'
import type { FieldFiles } from '../chat/components/chip-field/attached-files'
import type { BuildsResponse, Repository } from '../shared/org-settings'
import {
  workspacesPath,
  type CreateWorkspaceRequest,
  type CreateWorkspaceResponse,
} from '../shared/workspaces'
import type { ApiError } from './api/client'
import { readCreated } from './api/read-workspaces'
import {
  filesWait,
  isMissingFile,
  readyIds,
  type DraftFile,
  type IntakeRefusals,
} from './draft-files'
import {
  failSentDraft,
  markedFiles,
  messageText,
  withoutFileMarks,
} from './draft-file-state'
import { withoutMarks } from './draft-marks'
import { DraftUploads } from './new-workspace-files'
import type { OrgModel } from './org-model'
import { asApiError, Store, valueOf } from './store'

/** The first message of a workspace that does not exist yet. */
export interface Draft {
  text: string
  /**
   * The repository of the draft, or `null` while the form shows the first
   * ready repository. A pick of the user stays after a send. Without a
   * pick, the draft keeps the repository that the form showed at its first
   * text or file, while the org chooses it, until the send.
   */
  repository: { id: string; picked: boolean } | null
  choice: AgentChoice | null
  /**
   * The section that the user picked, or `null` for the section of the
   * form. A send ends the pick.
   */
  sectionId: string | null
  /** The files, each with its upload. Only ready ones go with the message. */
  files: readonly DraftFile[]
  /** Files without chips, kept for undo until this draft ends. */
  detached: readonly DraftFile[]
  /** The names of the files of the last pick that are over the size limit. */
  refused: readonly string[]
  /** Folder names from the last intake, kept apart from oversized files. */
  refusedFolders: readonly string[]
  /** The client ID of the first message. Try again sends the same one. */
  messageId: string
}

export type CreateState =
  | { state: 'idle' }
  | { state: 'sending' }
  /** The create request failed. Try again sends the same message ID. */
  | { state: 'failed'; error: ApiError }

/**
 * Whether the draft can go: it has text, and each of its files is ready,
 * with no upload that runs or failed. Send and Try again both wait for it.
 */
export function draftReady(draft: Draft): boolean {
  return (
    withoutMarks(draft.text).trim() !== '' &&
    !filesWait(markedFiles(draft.text, draft.files))
  )
}

/**
 * The repository that a New workspace form shows while its draft has none:
 * the first chosen repository that is ready, else the first chosen one. A
 * chosen repository that the builds list as added waits for a build, as
 * `waitingRepositoriesOf` says. While the builds load, none waits.
 */
export function firstReadyRepository(
  chosen: readonly Repository[],
  builds: BuildsResponse | undefined,
): Repository | undefined {
  const added = builds?.changes.addedRepositories ?? []
  const waits = (item: Repository) => added.some(({ id }) => id === item.id)
  return chosen.find((item) => !waits(item)) ?? chosen[0]
}

/**
 * New workspace: an empty chat whose first message creates the workspace.
 * When the create request fails, the draft stays, so Try again sends it
 * again. A create and an upload never run together: the create waits for
 * the files, and a file that comes while the create runs does not upload.
 *
 * A draft keeps the repository that the form shows when it gets its first
 * text or file, once the repositories and the builds of the org have
 * loaded. So a build that turns an earlier repository ready moves no
 * written draft. A pick of the user wins over it. A kept repository that
 * the org no longer chose gives way to the one that the form shows.
 *
 * Once the server takes the message, the workspace exists. When its first
 * start fails, the workspace keeps the message in its chat, with the saved
 * cause and Try again, so the form gives nothing back.
 */
export class NewWorkspaceModel {
  readonly draft: Store<Draft>
  readonly create: Store<CreateState>
  /**
   * The section of the form, where the draft lives. `null` puts the
   * workspace in General, the default section. A pick of the draft wins.
   */
  readonly sectionId: string | null
  private readonly org: OrgModel
  private readonly uploads: DraftUploads
  readonly filesSource: FieldFiles = {
    files: () => {
      const draft = this.draft.get()
      return [...draft.files, ...draft.detached]
    },
    retry: (id) => {
      void this.retryFile(id)
    },
    subscribe: (listener) => this.draft.subscribe(listener),
  }

  constructor(org: OrgModel, sectionId: string | null) {
    this.org = org
    this.sectionId = sectionId
    this.draft = new Store<Draft>(this.emptyDraft())
    this.uploads = new DraftUploads({
      draft: this.draft,
      api: org.services.api,
      orgId: org.orgId,
      newId: () => org.services.newId(),
      lifetime: () => org.creations.lifetime,
    })
    this.create = new Store<CreateState>({ state: 'idle' })
    // A draft that got its text before the repositories and the builds
    // loaded takes its repository when they load.
    org.repositories.subscribe(() => this.keepShownRepository())
    org.builds.subscribe(() => this.keepShownRepository())
  }

  /** A new draft. It keeps the choice and a picked repository of `keep`. */
  private emptyDraft(keep?: Draft): Draft {
    return {
      text: '',
      repository: keep?.repository?.picked ? keep.repository : null,
      choice: keep?.choice ?? null,
      sectionId: null,
      files: [],
      detached: [],
      refused: [],
      refusedFolders: [],
      messageId: this.org.services.newId(),
    }
  }

  /**
   * The draft with the repository that the form shows, once the
   * repositories and the builds have loaded: a draft with text or a file
   * takes it when it has no repository yet. A kept repository that the org
   * no longer chose gives way to it, so the draft follows the form, as a
   * draft without a repository does. A pick stays.
   */
  private withShownRepository(draft: Draft): Draft {
    const repositories = valueOf(this.org.repositories.get())
    const builds = valueOf(this.org.builds.get())
    const kept = draft.repository
    if (!repositories || !builds || kept?.picked) return draft
    const chosen = repositories.filter((item) => item.selected)
    if (kept && chosen.some((item) => item.id === kept.id)) return draft
    const written = draft.text.trim() !== '' || draft.files.length > 0
    const shown = written ? firstReadyRepository(chosen, builds) : undefined
    if (!shown) return kept ? { ...draft, repository: null } : draft
    return { ...draft, repository: { id: shown.id, picked: false } }
  }

  private keepShownRepository(): void {
    this.draft.change((draft) => this.withShownRepository(draft))
  }

  setText(text: string): void {
    this.uploads.setText(text)
    this.keepShownRepository()
  }

  setRepository(repositoryId: string): void {
    this.draft.change((draft) => ({
      ...draft,
      repository: { id: repositoryId, picked: true },
    }))
  }

  setChoice(choice: AgentChoice): void {
    this.draft.change((draft) => ({ ...draft, choice }))
  }

  setSection(sectionId: string): void {
    this.draft.change((draft) => ({ ...draft, sectionId }))
  }

  /**
   * Attaches one pick and returns its new file IDs immediately.
   * While the create runs, it uploads nothing, because the create already
   * sent the files of the draft.
   */
  attach(files: readonly File[], refusals?: IntakeRefusals): string[] {
    if (this.create.get().state === 'sending') return []
    const uploads = this.uploads.attach(files, refusals)
    // The files show at once, before they upload, so the draft has them now.
    this.keepShownRepository()
    return uploads
  }

  /** Try again on a file whose upload failed, or that the server lost. */
  retryFile(fileId: string): Promise<void> {
    if (this.create.get().state === 'sending') return Promise.resolve()
    return this.uploads.retry(fileId)
  }

  /**
   * Sends the first message, which creates the workspace. It returns the
   * new workspace, or `null` when the create failed and the draft stays. It
   * sends nothing while the draft is not ready or a create runs. `opened`
   * runs at once when the server takes the message, before the form empties,
   * so the app can open the new workspace first.
   *
   * A sign-out, or a sign-in of another person, ends the send at once. The
   * form is then free and empty. The late answer changes nothing, and
   * `send` gives `null`.
   */
  async send(
    defaults: { repositoryId: string; choice: AgentChoice },
    opened?: (created: CreateWorkspaceResponse) => void,
  ): Promise<CreateWorkspaceResponse | null> {
    const draft = this.draft.get()
    if (!draftReady(draft) || this.create.get().state === 'sending') {
      return null
    }
    const sectionId = draft.sectionId ?? this.sectionId
    const request: CreateWorkspaceRequest = {
      repositoryId: draft.repository?.id ?? defaults.repositoryId,
      ...(sectionId ? { sectionId } : {}),
      firstMessage: {
        id: draft.messageId,
        text: messageText(draft.text, draft.files),
        attachmentIds: readyIds(markedFiles(draft.text, draft.files)),
        choice: draft.choice ?? defaults.choice,
      },
    }
    const life = this.org.creations.lifetime
    const unfollow = life.onEnd(() => {
      this.draft.set(this.emptyDraft())
      this.create.set({ state: 'idle' })
    })
    this.create.set({ state: 'sending' })
    try {
      const created = await this.org.services.api.send(
        'POST',
        workspacesPath(this.org.orgId),
        request,
        readCreated,
      )
      if (!life.live) return null
      this.org.putWorkspace(created.workspace)
      opened?.(created)
      this.uploads.end()
      this.draft.change((current) => ({
        ...this.emptyDraft(current),
        text:
          current.text === draft.text
            ? ''
            : withoutFileMarks(
                current.text,
                [...current.files, ...current.detached].map(({ id }) => id),
              ),
      }))
      this.create.set({ state: 'idle' })
      return created
    } catch (error) {
      if (!life.live) return null
      // The server lost a file of the message, such as an expired upload.
      // Those files turn failed, and Try again on each uploads it again.
      if (isMissingFile(error)) {
        const sent = request.firstMessage.attachmentIds
        this.draft.change((current) => ({
          ...current,
          ...failSentDraft(current, sent, error),
        }))
      }
      this.create.set({ state: 'failed', error: asApiError(error) })
      return null
    } finally {
      unfollow()
    }
  }
}
