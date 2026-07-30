import TestRunsController from '@controllers/testRuns.controller'
import {LoaderFunctionArgs} from '@remix-run/node'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {checkForTestId} from '../../utilities/utils'

export interface StatusEntry {
  status: string
  updatedBy: string
  updatedOn: string
  comment: string | null
  // Only populated for the run-scoped history (testRunsStatusHistory);
  // the test-detail history (testRunMap) does not store attachments.
  attachments?: string[] | null
}

export async function loader({params, request}: LoaderFunctionArgs) {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.GetTestStatusHistory,
    })

    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams.entries())
    const testId = Number(searchParams['testId'])

    if (!checkForTestId(testId)) {
      return responseHandler({
        error: 'Invalid param testId',
        status: 400,
      })
    }

    const testStatusData = await TestRunsController.testStatusHistory({
      testId,
    })

    return responseHandler({data: testStatusData, status: 200})
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
