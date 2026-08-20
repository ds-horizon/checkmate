import {loader} from '~/routes/api/v1/runTestsList'
import SearchParams from '@route/utils/getSearchParams'
import TestRunsController from '~/dataController/testRuns.controller'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  responseHandler,
  errorResponseHandler,
} from '~/routes/utilities/responseHandler'
import {API} from '~/routes/utilities/api'
import {
  areResultRevisionCommandsEnabled,
  isPlaneDefectCreationEnabled,
  isPlaneEvidenceCopyEnabled,
} from '~/services/resultRevisionFlags'

jest.mock('@route/utils/getSearchParams')
jest.mock('~/dataController/testRuns.controller')
jest.mock('~/routes/utilities/responseHandler')
jest.mock('~/routes/utilities/checkForUserAndAccess')
jest.mock('~/services/resultRevisionFlags')

describe('Get Run Tests - Loader Function', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(areResultRevisionCommandsEnabled as jest.Mock).mockReturnValue(true)
    ;(isPlaneDefectCreationEnabled as jest.Mock).mockReturnValue(false)
    ;(isPlaneEvidenceCopyEnabled as jest.Mock).mockReturnValue(false)
  })

  it('should successfully fetch test runs data for valid search parameters', async () => {
    const request = new Request(
      'http://localhost?runId=123&page=1&pageSize=10',
      {
        method: 'GET',
      },
    )
    const mockSearchParams = {runId: 123, page: 1, pageSize: 10}
    const mockTestRunsData = {
      testsList: [
        {testId: 1, status: 'Passed', runId: 123},
        {testId: 2, status: 'Failed', runId: 123},
      ],
      totalCount: 2,
    }

    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue(true)
    ;(SearchParams.getRunTests as jest.Mock).mockReturnValue(mockSearchParams)
    ;(TestRunsController.getAllTestRuns as jest.Mock).mockResolvedValue(
      mockTestRunsData,
    )
    ;(responseHandler as jest.Mock).mockImplementation((response) => response)

    const response = await loader({params: {}, request} as any)

    expect(getUserAndCheckAccess).toHaveBeenCalledWith({
      request,
      resource: API.GetRunTestsList,
    })
    expect(SearchParams.getRunTests).toHaveBeenCalledWith({params: {}, request})
    expect(TestRunsController.getAllTestRuns).toHaveBeenCalledWith(
      mockSearchParams,
    )
    expect(responseHandler).toHaveBeenCalledWith({
      data: {
        ...mockTestRunsData,
        resultRevisionCommandsEnabled: true,
        planeDefectCreationEnabled: false,
        planeEvidenceCopyEnabled: false,
      },
      status: 200,
    })
  })

  it('should return an error for invalid search parameters', async () => {
    const request = new Request('http://localhost?runId=invalid&page=1', {
      method: 'GET',
    })

    ;(getUserAndCheckAccess as jest.Mock).mockResolvedValue(true)
    ;(SearchParams.getRunTests as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid search parameters')
    })
    ;(errorResponseHandler as jest.Mock).mockImplementation(
      (error) =>
        new Response(JSON.stringify({error: error.message}), {status: 400}),
    )

    const response = await loader({params: {}, request} as any)

    expect(SearchParams.getRunTests).toHaveBeenCalledWith({params: {}, request})
    expect(errorResponseHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid search parameters',
      }),
    )
    expect(response.status).toBe(400)
    const responseData = await response.json()
    expect(responseData).toEqual({
      error: 'Invalid search parameters',
    })
  })

  it('should handle unexpected errors', async () => {
    const request = new Request('http://localhost?runId=123', {method: 'GET'})
    const mockError = new Error('Unexpected error')

    ;(getUserAndCheckAccess as jest.Mock).mockRejectedValue(mockError)
    ;(errorResponseHandler as jest.Mock).mockImplementation(
      (error) =>
        new Response(JSON.stringify({error: error.message}), {status: 500}),
    )

    const response = await loader({params: {}, request} as any)

    expect(getUserAndCheckAccess).toHaveBeenCalledWith({
      request,
      resource: API.GetRunTestsList,
    })
    expect(errorResponseHandler).toHaveBeenCalledWith(mockError)
    expect(response.status).toBe(500)
    const responseData = await response.json()
    expect(responseData).toEqual({
      error: 'Unexpected error',
    })
  })
})
