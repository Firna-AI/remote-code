import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../shared/generated/Attachment'
import { OversizeNotice, SentFiles } from './AttachmentChips'
import { textOf } from './render-kit'

const screenshot: Attachment = {
  id: 'attachment-1',
  name: 'overlap.png',
  path: null,
  kind: 'image',
  mediaType: 'image/png',
  sizeBytes: 290_816,
}

/** The accessible names of the buttons in rendered HTML, in their order. */
function buttonNames(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map(
    ([, name]) => name,
  )
}

describe('the attached files', () => {
  it('names one refused file or the count, and the limit, but no size of the file', () => {
    const notice = (refused: readonly string[]) =>
      textOf(
        renderToStaticMarkup(
          <OversizeNotice onAttach={() => {}} refused={refused} />,
        ),
      ).trim()
    expect({
      none: notice([]),
      one: notice(['recording.mov']),
      two: notice(['recording.mov', 'trace.zip']),
    }).toEqual({
      none: '',
      one: "recording.mov wasn't attached Each file can be up to 100 MB. Attach a smaller file",
      two: "2 files weren't attached Each file can be up to 100 MB. Attach a smaller file",
    })
  })

  it('shows the files of a sent message with their sizes and no Remove', () => {
    const html = renderToStaticMarkup(<SentFiles attachments={[screenshot]} />)
    expect({
      text: textOf(html).trim(),
      buttons: buttonNames(html),
    }).toEqual({ text: 'overlap.png 284 KB', buttons: [] })
  })
})
