import {LoaderFunctionArgs} from '@remix-run/node'
import SearchParams from '@route/utils/getSearchParams'
import TestRunsController from '~/dataController/testRuns.controller'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {API} from '../../utilities/api'
import {
  areResultRevisionCommandsEnabled,
  isPlaneDefectCreationEnabled,
} from '~/services/resultRevisionFlags'

export interface Tests {
  testRunMapId: number
  resultMapCount: number
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
  screenshotCount: number
  planeDefectState:
    | 'intake_pending'
    | 'intake_open'
    | 'work_item_open'
    | 'ready_for_retest'
    | 'validated'
    | 'resolved_before_sync'
    | 'intake_rejected'
    | 'canceled'
    | 'superseded'
    | 'orphaned'
    | 'manual_attention'
    | null
  planeDefectUrl: string | null
}

export interface RunTestListResponseType {
  data?: {
    testsList: Tests[]
    totalCount: number
    resultRevisionCommandsEnabled: boolean
    planeDefectCreationEnabled: boolean
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
      data: {
        ...testRunsData,
        resultRevisionCommandsEnabled: areResultRevisionCommandsEnabled(),
        planeDefectCreationEnabled: isPlaneDefectCreationEnabled(),
      },
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
