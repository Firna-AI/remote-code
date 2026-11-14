import type { AgentModel } from '../../shared/generated/AgentModel'
import { useRef } from 'react'
import { Button } from '@firna/ui/button'
import { ArrowUp, Paperclip } from 'lucide-react'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import styles from '../../../docs/mockups/src/components/chat/Composer.module.css'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import type { NewWorkspaceModel } from '../../app/new-workspace-model'
import { useStore } from '../../app/store'
import {
  FolderNotice,
  noticedFolder,
  OversizeNotice,
} from '../../chat/components/AttachmentChips'
import { ChipTextField } from '../../chat/components/chip-field/ChipTextField'
import type { FieldHandle } from '../../chat/components/chip-field/focus-plugins'
import { useComposerDrop } from '../../chat/components/composer-drop'
import { useSendKey } from '../../chat/components/send-key'

import { IconButton } from '../ui/actions'
import { ModelPicker } from '../ui/ModelPicker'
import ui from '../ui/ui.module.css'

/**
 * The composer of a new workspace: the text, with a chip for each attached
 * file at its place, then the attach button, the model and effort picker,
 * and Send. The files of a pick go into the text at the caret, or at the end
 * when the text has no caret. The whole box takes a drop of files, as
 * `useComposerDrop` says. They upload before the workspace exists, with
 * the chips and the notices of the workspace chat. Send is off until the
 * message can go, as the screen decides for Send and Try again. Enter sends
 * as in every composer: on a computer, Enter sends and Shift+Enter adds a
 * line. While the create runs, the text, the attach button, and the drop
 * are off. A kept message shows with the cursor at its end. A pasted
 * workspace link shows as a chip, which `OrgLinks` finds.
 */
export function Composer(props: {
  model: NewWorkspaceModel
  choice: AgentChoice | undefined
  models: readonly AgentModel[]
  /** Whether the message can go now. */
  ready: boolean
  send: () => void
}) {
  const control = useControlSizes()
  const draft = useStore(props.model.draft)
  const create = useStore(props.model.create)
  const picker = useRef<HTMLInputElement>(null)
  const field = useRef<FieldHandle>(null)
  const sending = create.state === 'sending'
  const sendKey = useSendKey(props.ready, props.send)
  const drop = useComposerDrop({
    field,
    editable: !sending,
    attach: (files, refusals) => props.model.attach(files, refusals),
  })
  const pick = () => picker.current?.click()
  return (
    <>
      <OversizeNotice onAttach={pick} refused={draft.refused} />
      <FolderNotice folder={noticedFolder(draft)} onAttach={pick} />
      <div className={styles.wrap}>
        <div
          className={classes(styles.composer, drop.dropping && styles.dropping)}
          {...drop.handlers}
        >
          <ChipTextField
            caretAtEnd
            editable={!sending}
            files={props.model.filesSource}
            handle={field}
            label="Message"
            lines={2}
            maxLines={8}
            onChangeText={(text) => props.model.setText(text)}
            onEnter={sendKey}
            owner={props.model}
            placeholder="Describe the task"
            value={draft.text}
          />
          <div className={styles.bar}>
            <IconButton
              disabled={sending}
              icon={Paperclip}
              label="Attach files"
              onPress={pick}
            />
            <input
              className={ui.hidden}
              multiple
              onChange={(event) => {
                const chosen = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                if (chosen.length === 0) return
                field.current?.insertFiles(props.model.attach(chosen))
              }}
              ref={picker}
              tabIndex={-1}
              type="file"
            />
            {props.choice ? (
              <ModelPicker
                change={(choice) => props.model.setChoice(choice)}
                choice={props.choice}
                models={props.models}
              />
            ) : null}
            <span className={styles.spacer} />
            <Button
              accessibilityLabel="Send"
              boxSize={control.height}
              busy={sending}
              disabled={!props.ready}
              icon={ArrowUp}
              onPress={props.send}
              shape="square"
              size="sm"
              tone={props.ready ? 'primary' : 'secondary'}
            />
          </div>
        </div>
      </div>
    </>
  )
}
