/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {
  getAttachmentFileName,
  getAttachmentKeyFromUrl,
  ResultAttachmentGallery,
  ResultScreenshotCount,
} from '../ResultAttachments'

const signedScreenshotUrl =
  'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-japanese-shot.png?signature=abc'

describe('ResultScreenshotCount', () => {
  it('renders nothing when there are no screenshots', () => {
    const {container} = render(<ResultScreenshotCount count={0} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('uses singular copy and exposes the exact accessible count', () => {
    render(<ResultScreenshotCount count={1} />)

    expect(screen.getByRole('img', {name: '1 screenshot attached'})).toBeInTheDocument()
    expect(screen.getByText('1 screenshot')).toBeInTheDocument()
  })

  it('uses plural copy for multiple screenshots', () => {
    render(<ResultScreenshotCount count={2} />)

    expect(screen.getByRole('img', {name: '2 screenshots attached'})).toBeInTheDocument()
    expect(screen.getByText('2 screenshots')).toBeInTheDocument()
  })
})

describe('ResultAttachmentGallery', () => {
  it('extracts a safe display filename and write key from a signed URL', () => {
    expect(getAttachmentFileName(signedScreenshotUrl)).toBe('japanese-shot.png')
    expect(getAttachmentKeyFromUrl(signedScreenshotUrl)).toBe(
      'test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-japanese-shot.png',
    )
  })

  it('shows thumbnails and opens an accessible full-size viewer', async () => {
    render(
      <ResultAttachmentGallery
        attachments={[
          {
            id: 'shot-1',
            url: signedScreenshotUrl,
            fileName: 'japanese-shot.png',
            status: 'ready',
          },
        ]}
      />,
    )

    expect(screen.getByText('1 screenshot')).toBeInTheDocument()
    expect(screen.getByRole('img', {name: 'japanese-shot.png'})).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {name: 'Open screenshot 1: japanese-shot.png'}),
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(descriptionId).not.toBe('dialog-content')
    const description = screen.getByText(
      'Full-size screenshot preview. Press Escape to close.',
    )
    expect(description).toHaveAttribute('id', descriptionId)
    expect(screen.getByRole('img', {name: 'japanese-shot.png'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: /Download/})).toHaveAttribute(
      'download',
      'japanese-shot.png',
    )
    expect(screen.getByRole('link', {name: /Open original/})).toHaveAttribute(
      'target',
      '_blank',
    )

    fireEvent.keyDown(document, {key: 'Escape'})
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', {name: 'Open screenshot 1: japanese-shot.png'}),
      ).toHaveFocus()
    })
  })

  it('exposes attachment removal as a named action', () => {
    const onRemove = jest.fn()
    render(
      <ResultAttachmentGallery
        attachments={[
          {
            id: 'shot-1',
            url: signedScreenshotUrl,
            fileName: 'japanese-shot.png',
            status: 'ready',
          },
        ]}
        onRemove={onRemove}
      />,
    )

    fireEvent.click(screen.getByRole('button', {name: 'Remove japanese-shot.png'}))
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({fileName: 'japanese-shot.png'}),
    )
  })
})
