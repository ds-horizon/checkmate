import {LoaderFunctionArgs} from '@remix-run/node'
import SearchParams from '@route/utils/getSearchParams'
import TestRunsController from '~/dataController/testRuns.controller'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {API} from '../../utilities/api'

export interface Tests {
  automationStatus: string
  testedBy: string
  testId: number
  title: string
  testStatus: string
  comment: string | null
  priority: string
  platform: string
  squadName: string
  runStatus: string
  labelNames: string
  testCoveredBy: string
  projectId: number
  sectionName: string
  sectionParentId: number | null
  sectionId: number
}

export interface RunTestListResponseType {
  data?: {
    testsList: Tests[]
    totalCount: number
    error: any
  }
  status: number
  error?: any
}

export async function loader({params, request}: LoaderFunctionArgs) {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.GetRunTestsList,
    })

    const searchParams = SearchParams.getRunTests({params, request})

    const testRunsData = await TestRunsController.getAllTestRuns(searchParams)
    return responseHandler({
      data: testRunsData,
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
