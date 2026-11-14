import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  mergeRegister,
  TextNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical'
import type { FileEntry } from '../../../shared/generated/FileEntry'
import { mentionAt, mentionText } from '../../../shared/mention-text'
import { findMentioned, type MentionTree } from '../../mentions/MentionsContext'
import {
  $createFileMentionNode,
  $createMentionTextNode,
  $isFileMentionNode,
  $isMentionTextNode,
  MentionTextNode,
} from './file-mention-nodes'

/** Whether the tree holds the entry that a mention names. */
function names(tree: MentionTree, source: string): boolean {
  const mention = mentionAt(source, 0)
  return mention !== null && !!findMentioned(tree, mention.path, mention.folder)
}

/**
 * Brings the file chips of the field in line with the tree. A mention of a
 * paste or a draft whose entry the tree now holds becomes a chip, and a
 * caret inside it goes after its chip. A chip whose entry left the tree
 * becomes text that can become a chip again. A tree that loads or that is
 * unavailable changes nothing. Typed text never changes.
 */
export function $reconcileMentions(tree: MentionTree): void {
  if (tree.state !== 'ready') return
  const selection = $getSelection()
  for (const node of $getRoot().getAllTextNodes()) {
    if (!$isMentionTextNode(node) || !node.isMention()) continue
    if (!names(tree, node.getTextContent())) continue
    const chip = $createFileMentionNode(node.getTextContent())
    const holdsCaret =
      $isRangeSelection(selection) &&
      [selection.anchor, selection.focus].some(
        (point) => point.key === node.getKey(),
      )
    node.replace(chip)
    if (holdsCaret) chip.selectNext(0, 0)
  }
  const inline = $getRoot()
    .getChildren()
    .flatMap((block) => ($isElementNode(block) ? block.getChildren() : []))
  for (const node of inline) {
    if (!$isFileMentionNode(node) || names(tree, node.getTextContent())) {
      continue
    }
    node.replace($createMentionTextNode(node.getTextContent()))
  }
}

/**
 * Makes a mention that waits ordinary text, with the caret where it was.
 * The text then joins the plain text beside it.
 */
function $toPlainText(node: MentionTextNode): void {
  const selection = $getSelection()
  const points = $isRangeSelection(selection)
    ? [selection.anchor, selection.focus].filter(
        (point) => point.key === node.getKey(),
      )
    : []
  const offsets = points.map((point) => point.offset)
  const plain = $createTextNode(node.getTextContent())
  node.replace(plain)
  points.forEach((point, index) =>
    point.set(plain.getKey(), offsets[index], 'text'),
  )
}

/**
 * Keeps a mention that waits from catching typed text. An edit inside the
 * mention, or text typed right after it with no space, continues it, so it
 * becomes ordinary text. Then the list of `@` reads the whole query, and a
 * tree that loads later makes no chip of it. A typed space stays outside,
 * so the mention still waits for its entry.
 */
export function registerWaitingMentions(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerNodeTransform(MentionTextNode, (node) => {
      if (!node.isMention()) $toPlainText(node)
    }),
    editor.registerNodeTransform(TextNode, (node) => {
      const previous = node.getPreviousSibling()
      if (!$isMentionTextNode(previous)) return
      if (/^\S/.test(node.getTextContent())) $toPlainText(previous)
    }),
  )
}

/** The query of the list of `@`: the text from `@` to the caret. */
export interface MentionQuery {
  /** The text node that holds the `@` and the caret. */
  nodeKey: NodeKey
  /** The offset of the `@` in that node. */
  start: number
  /** The offset of the caret. */
  end: number
  query: string
}

/** Whether the node before a text ends with a space, or no text comes before. */
function startsAfterSpace(previous: LexicalNode | null): boolean {
  if (previous === null || $isLineBreakNode(previous)) return true
  return $isTextNode(previous) && /\s$/.test(previous.getTextContent())
}

/**
 * The query of the list of `@` at the caret, or null. The `@` stands at the
 * start of the text, or after a space or a line break, and the query runs
 * from it to the caret, with no space and no double quote.
 */
export function $mentionQuery(): MentionQuery | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const node = selection.anchor.getNode()
  if (!$isTextNode(node) || node.getType() !== 'text') return null
  const end = selection.anchor.offset
  const match = /(^|\s)@([^\s@"]*)$/.exec(node.getTextContent().slice(0, end))
  if (!match) return null
  const start = end - match[2].length - 1
  if (start === 0 && !startsAfterSpace(node.getPreviousSibling())) return null
  return { nodeKey: node.getKey(), start, end, query: match[2] }
}

/**
 * Puts a chip of the entry in place of `@` and the query, with a space
 * after it unless one follows already, and places the caret after both.
 */
export function $pickMention(query: MentionQuery, entry: FileEntry): void {
  const node = $getNodeByKey(query.nodeKey)
  if (!$isTextNode(node)) return
  const text = node.getTextContent()
  if (text.slice(query.start, query.end) !== `@${query.query}`) return
  const chip = $createFileMentionNode(
    mentionText(entry.path, entry.kind === 'directory'),
  )
  const rest = text.slice(query.end)
  node.setTextContent(text.slice(0, query.start))
  node.insertAfter(chip)
  const space = /^\s/.test(rest) ? '' : ' '
  const after = $createTextNode(space + rest)
  chip.insertAfter(after)
  if (node.getTextContent() === '') node.remove()
  after.select(space.length, space.length)
}
