/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {TestStatusType} from '@controllers/types'
import {AddResultDialog} from '../AddResultDialog'

const submit = jest.fn()
const mockFetcherState = {state: 'idle', data: undefined as unknown}
type FetchGlobal = typeof globalThis & {fetch?: typeof fetch}
const fetchGlobal = globalThis as FetchGlobal
const originalFetch = fetchGlobal.fetch
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

const installFetchMock = () => {
  const fetchMock = jest.fn()
  Object.defineProperty(fetchGlobal, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  })
  return fetchMock
}

jest.mock('@remix-run/react', () => ({
  useFetcher: () => ({
    state: mockFetcherState.state,
    data: mockFetcherState.data,
    submit,
  }),
}))

describe('AddResultDialog', () => {
  beforeEach(() => {
    submit.mockReset()
    mockFetcherState.state = 'idle'
    mockFetcherState.data = undefined
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalFetch) {
      Object.defineProperty(fetchGlobal, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch,
      })
    } else {
      Reflect.deleteProperty(fetchGlobal, 'fetch')
    }
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    })
  })

  it('prepopulates the edit flow with the current note and screenshots', async () => {
    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment={'再現手順を確認しました。This note should wrap in the dialog.'}
        currAttachments={[
          'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-result.png?signature=abc',
        ]}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByRole('heading', {name: 'Edit Test Result'})).toBeInTheDocument()
    expect(screen.getByRole('textbox', {name: 'Comment'})).toHaveValue(
      '再現手順を確認しました。This note should wrap in the dialog.',
    )
    expect(screen.getByRole('img', {name: 'result.png'})).toBeInTheDocument()
    expect(screen.getByLabelText('Screenshots')).toHaveAttribute('multiple')
    expect(screen.getByRole('combobox', {name: /Status/})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save result'})).toBeEnabled()
  })

  it('blocks saving when existing screenshots fail to load and offers retry', async () => {
    const fetchMock = installFetchMock()
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({error: 'Unable to load existing screenshots'}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({data: [{attachments: []}]}),
      } as Response)

    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment="Existing result note"
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )

    expect(
      await screen.findByText('Unable to load existing screenshots'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save result'})).toBeDisabled()

    fireEvent.click(screen.getByRole('button', {name: 'Retry'}))

    await waitFor(() => {
      expect(screen.queryByText('Unable to load existing screenshots')).not.toBeInTheDocument()
      expect(screen.getByRole('button', {name: 'Save result'})).toBeEnabled()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not accept files or pasted images while existing screenshots are loading', async () => {
    const fetchMock = installFetchMock()
    let resolveHistory!: (response: Response) => void
    const historyPromise = new Promise<Response>((resolve) => {
      resolveHistory = resolve
    })
    fetchMock.mockReturnValue(historyPromise)
    const createObjectURL = jest.fn(() => 'blob:should-not-be-created')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    })

    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )

    const fileInput = await screen.findByLabelText('Screenshots')
    expect(fileInput).toBeDisabled()
    expect(
      screen.getByText(
        'Loading existing screenshots. File selection and paste will be available when loading finishes.',
      ),
    ).toBeInTheDocument()

    const selectedFile = new File(['image'], 'selected.png', {type: 'image/png'})
    fireEvent.change(fileInput, {target: {files: [selectedFile]}})
    const pastedFile = new File(['image'], 'pasted.png', {type: 'image/png'})
    fireEvent.paste(document, {
      clipboardData: {
        items: [{type: 'image/png', getAsFile: () => pastedFile}],
      },
    })

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveHistory({
      ok: true,
      json: async () => ({data: [{attachments: []}]}),
    } as Response)

    await waitFor(() => expect(fileInput).toBeEnabled())
    expect(screen.getByText('No screenshots attached yet')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('blocks removing an existing comment until the backend supports clearing it', () => {
    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment="Existing result note"
        currAttachments={[]}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    fireEvent.change(screen.getByRole('textbox', {name: 'Comment'}), {
      target: {value: ''},
    })

    expect(
      screen.getByText(
        'Existing comments can be changed, but not removed yet. Keep a value to save.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save result'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))
    expect(submit).not.toHaveBeenCalled()
  })

  it('releases the save lock when an in-progress upload is removed', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:pending-screenshot'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    })
    installFetchMock().mockImplementation(() => new Promise<Response>(() => {}))

    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currAttachments={[]}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    fireEvent.change(screen.getByLabelText('Screenshots'), {
      target: {
        files: [new File(['image'], 'pending.png', {type: 'image/png'})],
      },
    })

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Save result'})).toBeDisabled(),
    )
    fireEvent.click(screen.getByRole('button', {name: 'Remove pending.png'}))

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Save result'})).toBeEnabled(),
    )
  })

  it('revokes draft previews after a successful save but keeps remote URLs', async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({data: {key: 'uploaded-key'}}),
    } as Response)
    const createObjectURL = jest.fn(() => 'blob:draft-preview')
    const revokeObjectURL = jest.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    })
    const onAddResultSubmit = jest.fn()
    const props = {
      getSelectedRows: () => [{testId: 42}],
      runId: 7,
      variant: 'runRowUpdate' as const,
      currStatus: TestStatusType.Failed,
      currAttachments: [
        'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-existing.png',
      ],
      onAddResultSubmit,
    }
    const rendered = render(<AddResultDialog {...props} />)

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    fireEvent.change(screen.getByLabelText('Screenshots'), {
      target: {
        files: [new File(['image'], 'draft.png', {type: 'image/png'})],
      },
    })

    await waitFor(() =>
      expect(screen.getByRole('img', {name: 'draft.png'})).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Save result'})).toBeEnabled(),
    )

    submit.mockImplementation(() => {
      mockFetcherState.state = 'submitting'
    })
    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))
    expect(submit).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Saving...'})).toBeInTheDocument(),
    )

    mockFetcherState.state = 'idle'
    mockFetcherState.data = {}
    rendered.rerender(<AddResultDialog {...props} />)

    await waitFor(() => expect(onAddResultSubmit).toHaveBeenCalledTimes(1))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:draft-preview')
    expect(revokeObjectURL).not.toHaveBeenCalledWith(
      'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-existing.png',
    )
  })
})
