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
const cryptoGlobal = globalThis.crypto as Crypto & {randomUUID?: () => string}
const originalRandomUUID = cryptoGlobal.randomUUID

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
    Object.defineProperty(cryptoGlobal, 'randomUUID', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    })
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
    if (originalRandomUUID) {
      Object.defineProperty(cryptoGlobal, 'randomUUID', {
        configurable: true,
        writable: true,
        value: originalRandomUUID,
      })
    } else {
      Reflect.deleteProperty(cryptoGlobal, 'randomUUID')
    }
  })

  it('prepopulates the edit flow with the current note and screenshots', async () => {
    render(
      <AddResultDialog
        getSelectedRows={() => [{testId: 42}]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment={
          '再現手順を確認しました。This note should wrap in the dialog.'
        }
        currAttachments={[
          'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-result.png?signature=abc',
        ]}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(
      screen.getByRole('heading', {name: 'Edit Test Result'}),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', {name: 'Comment'})).toHaveValue(
      '再現手順を確認しました。This note should wrap in the dialog.',
    )
    expect(screen.getByRole('img', {name: 'result.png'})).toBeInTheDocument()
    expect(screen.getByLabelText('Screenshots')).toHaveAttribute('multiple')
    expect(screen.getByRole('combobox', {name: /Status/})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Save result'})).toBeEnabled()
  })

  it('uses the first, deterministically ordered history entry for screenshots', async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            attachments: [
              'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-current.png?signature=abc',
            ],
          },
          {attachments: []},
        ],
      }),
    } as Response)

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

    expect(
      await screen.findByRole('img', {name: 'current.png'}),
    ).toBeInTheDocument()
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
      expect(
        screen.queryByText('Unable to load existing screenshots'),
      ).not.toBeInTheDocument()
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

    const selectedFile = new File(['image'], 'selected.png', {
      type: 'image/png',
    })
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
      expect(
        screen.getByRole('button', {name: 'Saving...'}),
      ).toBeInTheDocument(),
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

  it('submits a single result through the revision command endpoint', () => {
    ;(cryptoGlobal.randomUUID as jest.Mock).mockReturnValue(
      '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
    )

    render(
      <AddResultDialog
        getSelectedRows={() => [
          {testId: 42, testRunMapId: 17, resultMapCount: 1},
        ]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment="Checkout fails"
        currAttachments={[
          'https://signed.example.com/test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-result.png?signature=abc',
        ]}
        resultRevisionCommandsEnabled
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))

    expect(submit).toHaveBeenCalledWith(
      {
        resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
        testRunMapId: 17,
        status: TestStatusType.Failed,
        comment: 'Checkout fails',
        attachmentKeys: [
          'test-run-attachments/8b1e6f2a-1c2d-4e3f-9a0b-123456789abc-result.png',
        ],
        createPlaneDefect: false,
      },
      {
        method: 'PUT',
        action: '/api/v1/run/save-test-result',
        encType: 'application/json',
      },
    )
  })

  it('defaults explicit Plane creation on for an eligible single result', () => {
    ;(cryptoGlobal.randomUUID as jest.Mock).mockReturnValue(
      '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
    )

    render(
      <AddResultDialog
        getSelectedRows={() => [
          {testId: 42, testRunMapId: 17, resultMapCount: 1},
        ]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currComment="Checkout fails"
        currAttachments={[]}
        resultRevisionCommandsEnabled
        planeDefectCreationEnabled
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )

    expect(
      screen.getByRole('checkbox', {name: 'Create Plane defect'}),
    ).toBeChecked()
    expect(screen.getByText(/BIZ Development intake/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({createPlaneDefect: true}),
      expect.objectContaining({action: '/api/v1/run/save-test-result'}),
    )
  })

  it('requires evidence when the eligible Plane option remains selected', () => {
    render(
      <AddResultDialog
        getSelectedRows={() => [
          {testId: 42, testRunMapId: 17, resultMapCount: 1},
        ]}
        runId={7}
        variant="runRowUpdate"
        currStatus={TestStatusType.Failed}
        currAttachments={[]}
        resultRevisionCommandsEnabled
        planeDefectCreationEnabled
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))

    expect(
      screen.getByText(
        'Add a result note or screenshot before creating a Plane defect.',
      ),
    ).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })

  it('reuses the command ID when an identical save is retried', async () => {
    const randomUUID = (cryptoGlobal.randomUUID as jest.Mock)
      .mockReturnValueOnce('2fc3cc24-4149-45c4-a8e8-5d9c62c71c36')
      .mockReturnValueOnce('c6f28e2d-88ad-4605-9535-40f2bbf48a89')
    const props = {
      getSelectedRows: () => [
        {testId: 42, testRunMapId: 17, resultMapCount: 1},
      ],
      runId: 7,
      variant: 'runRowUpdate' as const,
      currStatus: TestStatusType.Failed,
      currComment: 'Checkout fails',
      currAttachments: [],
      resultRevisionCommandsEnabled: true,
    }
    const rendered = render(<AddResultDialog {...props} />)

    fireEvent.click(
      screen.getByRole('button', {name: 'Edit result, current status Failed'}),
    )
    submit.mockImplementation(() => {
      mockFetcherState.state = 'submitting'
    })
    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))
    rendered.rerender(<AddResultDialog {...props} />)

    mockFetcherState.state = 'idle'
    mockFetcherState.data = {error: 'Temporary failure', status: 503}
    rendered.rerender(<AddResultDialog {...props} />)
    expect(await screen.findByText('Temporary failure')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Save result'}))

    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[0][0].resultCommandId).toBe(
      submit.mock.calls[1][0].resultCommandId,
    )
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it('blocks bulk result updates while revision commands are enabled', () => {
    render(
      <AddResultDialog
        getSelectedRows={() => [
          {testId: 42, testRunMapId: 17, resultMapCount: 1},
          {testId: 43, testRunMapId: 18, resultMapCount: 1},
        ]}
        runId={7}
        variant="bulkUpdate"
        currStatus={TestStatusType.Failed}
        resultRevisionCommandsEnabled
      />,
    )

    fireEvent.click(screen.getByRole('button', {name: 'Add Result'}))
    fireEvent.click(screen.getByRole('button', {name: 'Submit result'}))

    expect(
      screen.getByText(
        'Bulk result updates are unavailable while atomic result saving is enabled.',
      ),
    ).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })
})
