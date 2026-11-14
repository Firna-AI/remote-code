import type { Preview } from '../shared/generated/Preview'
import { useRef, useState, type MouseEvent } from 'react'
import { Plus, RotateCw, X } from 'lucide-react'
import type { ListeningPort } from '../shared/generated/ListeningPort'
import { classes } from '../../docs/mockups/src/components/common/classes'
import {
  previewTabLabel,
  serverDescription,
} from '../../docs/mockups/src/components/tools/previewCopy'
import tabStyles from '../../docs/mockups/src/components/tools/PreviewTabs.module.css'
import tabScroll from '../../docs/mockups/src/components/workspace/TabScroll.module.css'
import { useRowScroll } from '../chat/components/row-scroll'
import { TabNodes } from '../chat/components/tab-nodes'

import { ToolIconButton } from '../terminal/tool-parts/ToolButtons'
import { useTouch } from '../terminal/tool-parts/ToolRoot'
import { OpenInNewTab } from './PreviewFrame'
import styles from './PreviewToolbar.module.css'

/**
 * True for a plain left click. The browser keeps every other click, such as
 * Ctrl or middle click, which opens the address in a new tab.
 */
function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/**
 * The bar of the preview tool: a tab for each preview, the button that
 * opens another port, and the actions of the preview in the frame. A tab
 * holds a link to its preview and its Close button, with the rule of the
 * centre tab row: Close shows on the shown tab, on hover, and while the
 * focus is in the tab. A link shows its port and the name of its server,
 * cut to 10 characters, from the latest list. Its tooltip and its spoken name give the whole name and the
 * folder. A row whose tabs do not fit scrolls, keeps the shown tab in view,
 * and fades each end that clips tabs, as the session tabs do.
 */
export function PreviewToolbar(props: {
  previews: readonly Preview[]
  /** The latest list of the servers, or null without a report. */
  ports: readonly ListeningPort[] | null
  /** The preview in the frame, or null while the form shows. */
  selected: Preview | null
  /** The ids of the previews whose close request runs. */
  closing: ReadonlySet<string>
  href: (previewId: string) => string
  onFollow: (previewId: string) => void
  onAdd: () => void
  onReload: () => void
  onClose: (preview: Preview) => void
}) {
  const { selected } = props
  const touch = useTouch()
  const row = useRef<HTMLElement>(null)
  const [nodes] = useState(() => new TabNodes())
  const fades = useRowScroll({
    row,
    nodes,
    keys: props.previews.map((preview) => preview.id),
    kept: selected?.id ?? null,
    moved: null,
  })
  return (
    <div className={styles.toolbar}>
      <nav
        aria-label="Previews"
        className={classes(
          tabStyles.tabs,
          touch && tabStyles.touch,
          tabScroll.scroll,
          fades.start && tabScroll.fadeStart,
          fades.end && tabScroll.fadeEnd,
        )}
        ref={row}
      >
        {props.previews.map((preview) => {
          const current = preview.id === selected?.id
          const server = props.ports?.find((each) => each.port === preview.port)
          const description = server ? serverDescription(server) : undefined
          const label = previewTabLabel(preview.port, server)
          return (
            <span
              className={classes(tabStyles.tab, current && tabStyles.selected)}
              key={preview.id}
              ref={nodes.itemRef(preview.id)}
            >
              <a
                aria-current={current ? 'page' : undefined}
                aria-label={description}
                className={tabStyles.link}
                href={props.href(preview.id)}
                onClick={(event) => {
                  if (!plainClick(event)) return
                  event.preventDefault()
                  props.onFollow(preview.id)
                }}
                title={description}
              >
                {label}
              </a>
              <span className={tabStyles.close}>
                <ToolIconButton
                  busy={props.closing.has(preview.id)}
                  icon={X}
                  label={`Close ${label}`}
                  onPress={() => props.onClose(preview)}
                  quiet
                />
              </span>
            </span>
          )
        })}
      </nav>
      <ToolIconButton
        icon={Plus}
        label="Preview another port"
        onPress={props.onAdd}
        pressed={selected === null}
      />
      <span className={styles.spacer} />
      {selected ? (
        <>
          <ToolIconButton
            icon={RotateCw}
            label="Reload"
            onPress={props.onReload}
          />
          <OpenInNewTab preview={selected} />
        </>
      ) : null}
    </div>
  )
}
