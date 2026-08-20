import {action} from '~/routes/api/v1/saveTestResult'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'
import {areResultRevisionCommandsEnabled} from '~/services/resultRevisionFlags'
import {ResultCommandError, saveHumanResult} from '~/services/resultCommands'
import {API} from '~/routes/utilities/api'

jest.mock('~/routes/utilities/checkForUserAndAccess')
jest.mock('~/routes/utilities/responseHandler')
jest.mock('~/routes/utilities/utils')
jest.mock('~/services/resultRevisionFlags')
jest.mock('~/services/resultCommands', () => {
  const actual = jest.requireActual('~/services/resultCommands')
  return {...actual, saveHumanResult: jest.fn()}
})

const requestData = {
  resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
  testRunMapId: 17,
  status: 'Failed',
  comment: 'Checkout fails after submit',
}

const makeRequest = (contentType = 'application/json') =>
  new Request('http://localhost', {
    method: 'PUT',
    headers: {'content-type': contentType},
    body: JSON.stringify(requestData),
  })

describe('Save Test Result - Action Function', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue({userId: 23})
    ;(areResultRevisionCommandsEnabled as jest.Mock).mockReturnValue(true)
    ;(getRequestParams as jest.Mock).mockResolvedValue(requestData)
    ;(responseHandler as jest.Mock).mockImplementation((response) => response)
  })

  it('is unavailable while the feature flag is disabled', async () => {
    ;(areResultRevisionCommandsEnabled as jest.Mock).mockReturnValue(false)

    const response = await action({request: makeRequest()} as any)

    expect(response).toEqual({error: 'Not found', status: 404})
    expect(saveHumanResult).not.toHaveBeenCalled()
  })

  it('uses only the authenticated actor identity', async () => {
    const saved = {resultRevisionId: 41, replayed: false}
    ;(saveHumanResult as jest.Mock).mockResolvedValue(saved)

    const response = await action({request: makeRequest()} as any)

    expect(getUserAndCheckAccess).toHaveBeenCalledWith({
      request: expect.any(Request),
      resource: API.RunSaveTestResult,
    })
    expect(saveHumanResult).toHaveBeenCalledWith({
      ...requestData,
      actorUserId: 23,
    })
    expect(response).toEqual({data: saved, status: 200})
  })

  it('rejects requests without an authenticated actor ID', async () => {
    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue({})

    const response = await action({request: makeRequest()} as any)

    expect(response).toEqual({
      error: 'Authenticated actor is required',
      status: 401,
    })
    expect(saveHumanResult).not.toHaveBeenCalled()
  })

  it('rejects non-JSON content', async () => {
    const response = await action({request: makeRequest('text/plain')} as any)

    expect(response).toEqual({error: 'Invalid content type', status: 400})
    expect(saveHumanResult).not.toHaveBeenCalled()
  })

  it('returns domain conflict status without converting it to a 500', async () => {
    ;(saveHumanResult as jest.Mock).mockRejectedValue(
      new ResultCommandError('Command conflict', 409),
    )

    const response = await action({request: makeRequest()} as any)

    expect(response).toEqual({error: 'Command conflict', status: 409})
    expect(errorResponseHandler).not.toHaveBeenCalled()
  })
})
