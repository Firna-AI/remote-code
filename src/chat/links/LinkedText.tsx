import type { FileEntry } from '../../shared/generated/FileEntry'
import type { Attachment } from '../../shared/generated/Attachment'
import { entryName } from '../../../docs/mockups/src/components/chat/entryPaths'
import { FileChip } from '../../../docs/mockups/src/components/chat/FileChip'
import { SentFileChip } from '../../../docs/mockups/src/components/chat/SentFileChip'
import { SessionChip } from '../../../docs/mockups/src/components/chat/SessionChip'
import {
  WorkspaceChip,
  type ChipOpener,
} from '../../../docs/mockups/src/components/chat/WorkspaceChip'
import inline from '../../../docs/mockups/src/components/common/InlineText.module.css'
import { routes } from '../../app/router'
import { sessionLink } from '../../shared/session-link'
import { isPlainClick } from '../../shell/ui/AppLink'
import { MentionIcon } from '../mentions/MentionIcon'
import {
  findMentioned,
  useChatMentions,
  useMentionTree,
} from '../mentions/MentionsContext'
import {
  chatParts,
  type AttachmentPart,
  type ChatPart,
  type MentionLookup,
} from './chat-parts'
import { chipOf, useChatLinks } from './LinksContext'
import { sessionChipOf, useLinkedSession } from './session-links'
import { sessionTarget, type LinkTarget } from './workspace-links'

/**
 * A workspace in a sent message or an answer: a link of the app to the page
 * that the link names. A link to a known session shows as its session chip.
 * A plain click opens it in the same window, as the other links of the app
 * do. A click with a modifier key stays with the browser, such as a new tab.
 */
function LinkChip(props: { target: LinkTarget }) {
  const { open } = useChatLinks()
  const session = useLinkedSession(props.target)
  const { to, workspace } = props.target
  const opener = (chip: ChipOpener) => (
    <a
      {...chip}
      href={to}
      onClick={(event) => {
        if (!open || !isPlainClick(event)) return
        event.preventDefault()
        open(to)
      }}
    />
  )
  return session ? (
    <SessionChip opener={opener} session={sessionChipOf(workspace, session)} />
  ) : (
    <WorkspaceChip opener={opener} workspace={chipOf(workspace)} />
  )
}

/**
 * A session that the chat names by its IDs, such as the session whose agent
 * stopped a turn, as the chat shows the link of that session: its session
 * chip, or the chip of its workspace while the chat does not hold the
 * session. When no workspace of the list matches, the link stays text.
 * Outside a chat, which gives no origin, the text is the address of the
 * session in the app.
 */
export function SessionLinkText(props: {
  workspaceId: string
  sessionId: string
}) {
  const { links, origin } = useChatLinks()
  const target = sessionTarget(props, links)
  if (target) return <LinkChip target={target} />
  const { workspaceId, sessionId } = props
  return origin === undefined
    ? routes.session(links.orgId, workspaceId, sessionId)
    : sessionLink(origin, links.orgId, workspaceId, sessionId)
}

/**
 * A file or a folder in a sent message: a link of the app to the file, or
 * to All files with the folder open, as a press in All files opens them.
 * A click with a modifier key stays with the browser.
 */
function FileLink(props: { entry: FileEntry; source: string }) {
  const mentions = useChatMentions()
  const { entry } = props
  const folder = entry.kind === 'directory'
  return (
    <FileChip
      entry={{ path: entry.path, folder }}
      icon={<MentionIcon entry={entry} size={12} />}
      mention={props.source}
      name={entry.name}
      opener={
        mentions
          ? (chip) => (
              <a
                {...chip}
                href={mentions.href(entry)}
                onClick={(event) => {
                  if (!isPlainClick(event)) return
                  event.preventDefault()
                  if (folder) mentions.showFolder(entry.path)
                  else mentions.openFile(entry.path)
                }}
              />
            )
          : undefined
      }
      title={folder ? `${entry.path}/` : entry.path}
    />
  )
}

/**
 * An attached file of a sent message, at the place of its mention: a link
 * of the app to the file tab of the copy of the file, as a file chip opens
 * its file. A click with a modifier key stays with the browser. While the
 * message has not gone out, `opens` is false, because the copy does not
 * exist yet. Then, and in a chat without the files of the workspace, such
 * as an archived one, the chip opens nothing.
 */
function AttachmentLink(props: { part: AttachmentPart; opens: boolean }) {
  const mentions = useChatMentions()
  const files = props.opens ? mentions : null
  const { path } = props.part
  const copy: FileEntry = {
    path,
    name: entryName({ path }),
    kind: 'file',
    change: null,
  }
  return (
    <SentFileChip
      file={props.part.attachment}
      mention={props.part.source}
      opener={
        files
          ? (chip) => (
              <a
                {...chip}
                href={files.href(copy)}
                onClick={(event) => {
                  if (!isPlainClick(event)) return
                  event.preventDefault()
                  files.openFile(path)
                }}
              />
            )
          : undefined
      }
    />
  )
}

function Part(props: { part: ChatPart; opens: boolean }) {
  const { part } = props
  if (part.kind === 'text') return part.text
  if (part.kind === 'code') {
    return <code className={inline.code}>{part.text}</code>
  }
  if (part.kind === 'file') {
    return <FileLink entry={part.entry} source={part.source} />
  }
  if (part.kind === 'attachment') {
    return <AttachmentLink opens={props.opens} part={part} />
  }
  return <LinkChip target={part.target} />
}

/** A run of bold text and chips, or one part without bold. */
type Run =
  { kind: 'strong'; parts: ChatPart[] } | { kind: 'part'; part: ChatPart }

/** The parts in runs, so that one `<strong>` holds each run of bold parts. */
function runsOf(parts: readonly ChatPart[]): Run[] {
  const runs: Run[] = []
  for (const part of parts) {
    const last = runs.at(-1)
    if (part.kind === 'code' || !part.strong) runs.push({ kind: 'part', part })
    else if (last?.kind === 'strong') last.parts.push(part)
    else runs.push({ kind: 'strong', parts: [part] })
  }
  return runs
}

/** The lookup of the mentions of a message, while the chat has a tree. */
function useMentionLookup(read: boolean): MentionLookup | undefined {
  const tree = useMentionTree(read)
  if (!tree) return undefined
  return (mention) => findMentioned(tree, mention.path, mention.folder)
}

/** How the chat reads a text: as an answer, or as a message of a member. */
export interface TextReading {
  /** `**` marks bold, as in an answer. */
  strong?: boolean
  /** Each mention of an entry of the file tree is a file chip. */
  mentions?: boolean
  /** The files of a sent message. The mention of each is its chip. */
  attachments?: readonly Attachment[]
}

/**
 * The parts of a text, as `chatParts` reads it with the workspaces of the
 * chat. With `mentions`, it follows the tree of the chat for the chips of
 * the files.
 */
export function useChatParts(text: string, reading: TextReading): ChatPart[] {
  const { links } = useChatLinks()
  const lookup = useMentionLookup(reading.mentions ?? false)
  return chatParts(text, links, {
    strong: reading.strong ?? false,
    mentions: lookup,
    attachments: reading.attachments,
  })
}

/**
 * Draws the parts of a text: text, code, and chips. One `<strong>` holds
 * each run of bold text and chips. `opens` says whether the chip of an
 * attached file opens its copy: only after its message went out to the
 * agent.
 */
export function ChatText(props: {
  parts: readonly ChatPart[]
  opens?: boolean
}) {
  const opens = props.opens ?? false
  return (
    <>
      {runsOf(props.parts).map((run, index) =>
        run.kind === 'part' ? (
          <Part key={index} opens={opens} part={run.part} />
        ) : (
          <strong key={index}>
            {run.parts.map((part, inner) => (
              <Part key={inner} opens={opens} part={part} />
            ))}
          </strong>
        ),
      )}
    </>
  )
}

/**
 * Text of a sent message or of an answer, as `chatParts` reads it: code,
 * and each workspace link as a chip. With `strong`, as in an answer, `**`
 * marks bold, and one `<strong>` holds each run of bold text and chips.
 * With `mentions`, as in a message of a member, each mention of an entry of
 * the file tree is a file chip.
 */
export function LinkedText(props: {
  text: string
  strong?: boolean
  mentions?: boolean
}) {
  return <ChatText parts={useChatParts(props.text, props)} />
}
