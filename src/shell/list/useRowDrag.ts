import type { Workspace } from '../../shared/generated/Workspace'
import { useState } from 'react'
import { usePointerDrag, type PointerDrag } from '../../app/pointer-drag'

import { DropLayout, type DropTarget } from './drop-target'

/**
 * A drag of a workspace row. Its item is the workspace, and its places are
 * places in a section.
 */
export type RowDragState = PointerDrag<Workspace, DropTarget>

function samePlace(a: DropTarget, b: DropTarget): boolean {
  return a.sectionId === b.sectionId && a.index === b.index
}

/**
 * Drag and drop of workspace rows between sections, on the shared pointer
 * drag: a mouse drags after a short move, and a finger lifts the row after a
 * long press. The drop place is in the section under the pointer, before
 * the first other row whose middle is below it. Outside every section, the
 * place stays as it was. A release at the row's own place moves nothing,
 * also after a long press that lets go without a move.
 */
export function useRowDrag(
  move: (workspaceId: string, target: DropTarget) => void,
) {
  /** The list gives its sections and rows to the layout through refs. */
  const [layout] = useState(() => new DropLayout())
  const { drag, bind } = usePointerDrag<Workspace, DropTarget>({
    locate: (workspace, _x, y, last) => {
      const target = layout.targetAt(workspace.id, y)
      // After a scroll, the hook draws again only for a new place object.
      return target === null || samePlace(target, last) ? last : target
    },
    drop: ({ item, from, place }) => {
      if (!samePlace(place, from)) move(item.id, place)
    },
  })
  return { drag, bind, layout }
}
