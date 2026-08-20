import {action} from '~/routes/api/v1/updateStatusTestRuns'
import RunsController from '@controllers/runs.controller'
import TestRunsController from '~/dataController/testRuns.controller'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  responseHandler,
  errorResponseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'
import {API} from '~/routes/utilities/api'
import {RUN_IS_LOCKED} from '~/constants'
import {areResultRevisionCommandsEnabled} from '~/services/resultRevisionFlags'

jest.mock('@controllers/runs.controller')
jest.mock('~/dataController/testRuns.controller')
jest.mock('~/routes/utilities/responseHandler')
jest.mock('~/routes/utilities/checkForUserAndAccess')
jest.mock('~/routes/utilities/utils')
jest.mock('~/services/resultRevisionFlags')

describe('Update Status Test Runs - Action Function', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(areResultRevisionCommandsEnabled as jest.Mock).mockReturnValue(false)
  })

  it('disables the legacy writer when revision commands are enabled', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{}',
    })
    ;(areResultRevisionCommandsEnabled as jest.Mock).mockReturnValue(true)
    ;(responseHandler as jest.Mock).mockImplementation((response) => response)

    const response = await action({request} as any)

    expect(response).toEqual({
      error: 'Legacy result writes are disabled',
      status: 409,
    })
    expect(getRequestParams).not.toHaveBeenCalled()
    expect(TestRunsController.updateStatusTestRuns).not.toHaveBeenCalled()
  })

  it('should successfully update test run statuses for valid input', async () => {
    const requestData = {
      runId: 123,
      testIdStatusArray: [
        {testId: 1, status: 'Passed', comment: 'Test passed successfully'},
        {testId: 2, status: 'Failed', comment: 'Critical errors found'},
      ],
      projectId: 456,
      comment: 'Batch update',
    }
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(requestData),
    })
    const mockUser = {userId: 789}
    const mockRunInfo = [{status: 'Active'}]
    const mockResponse = {success: true}

    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue(mockUser)
    ;(getRequestParams as jest.Mock).mockResolvedValue(requestData)
    ;(RunsController.getRunInfo as jest.Mock).mockResolvedValue(mockRunInfo)
    ;(TestRunsController.updateStatusTestRuns as jest.Mock).mockResolvedValue(
      mockResponse,
    )
    ;(responseHandler as jest.Mock).mockImplementation((response) => response)

    const response = await action({request} as any)

    expect(getUserAndCheckAccess).toHaveBeenCalledWith({
      request,
      resource: API.RunUpdateTestStatus,
    })
    expect(getRequestParams).toHaveBeenCalledWith(request, expect.any(Object))
    expect(RunsController.getRunInfo).toHaveBeenCalledWith({runId: 123})
    expect(TestRunsController.updateStatusTestRuns).toHaveBeenCalledWith({
      testIdStatusArray: requestData.testIdStatusArray,
      runId: 123,
      projectId: 456,
      userId: 789,
      comment: 'Batch update',
    })
    expect(responseHandler).toHaveBeenCalledWith({
      data: mockResponse,
      status: 200,
    })
  })

  it('should return an error for invalid content type', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'text/plain'},
    })

    ;(responseHandler as jest.Mock).mockImplementation(
      (data) => new Response(JSON.stringify(data), {status: 400}),
    )

    const response = await action({request} as any)

    expect(responseHandler).toHaveBeenCalledWith({
      error: 'Invalid content type',
      status: 400,
    })
    expect(response.status).toBe(400)
  })

  it('should return an error if the run is not found', async () => {
    const requestData = {
      runId: 123,
      testIdStatusArray: [{testId: 1, status: 'Passed'}],
    }
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(requestData),
    })

    ;(getRequestParams as jest.Mock).mockResolvedValue(requestData)
    ;(RunsController.getRunInfo as jest.Mock).mockResolvedValue([])

    const response = await action({request} as any)

    expect(RunsController.getRunInfo).toHaveBeenCalledWith({runId: 123})
    expect(responseHandler).toHaveBeenCalledWith({
      error: 'Run not found',
      status: 400,
    })
  })

  it('should return an error if the run is locked', async () => {
    const requestData = {
      runId: 123,
      testIdStatusArray: [{testId: 1, status: 'Passed'}],
    }
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(requestData),
    })
    const mockRunInfo = [{status: 'Locked'}]

    ;(getRequestParams as jest.Mock).mockResolvedValue(requestData)
    ;(RunsController.getRunInfo as jest.Mock).mockResolvedValue(mockRunInfo)

    const response = await action({request} as any)

    expect(RunsController.getRunInfo).toHaveBeenCalledWith({runId: 123})
    expect(responseHandler).toHaveBeenCalledWith({
      error: RUN_IS_LOCKED,
      status: 423,
    })
  })

  it('should handle unexpected errors', async () => {
    const requestData = {
      runId: 123,
      testIdStatusArray: [{testId: 1, status: 'Passed'}],
    }
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(requestData),
    })
    const mockError = new Error('Unexpected error')

    ;(getUserAndCheckAccess as jest.Mock).mockRejectedValue(mockError)
    ;(errorResponseHandler as jest.Mock).mockImplementation(
      (error) =>
        new Response(JSON.stringify({error: error.message}), {status: 500}),
    )

    const response = await action({request} as any)

    expect(getUserAndCheckAccess).toHaveBeenCalledWith({
      request,
      resource: API.RunUpdateTestStatus,
    })
    expect(errorResponseHandler).toHaveBeenCalledWith(mockError)
    expect(response.status).toBe(500)
  })
})
