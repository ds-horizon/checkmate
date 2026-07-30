import RunsController from '@controllers/runs.controller'
import {ActionFunctionArgs} from '@remix-run/node'
import {isValidAttachmentKey} from '@services/s3'
import {z} from 'zod'
import TestRunsController from '~/dataController/testRuns.controller'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '../../utilities/utils'
import {RUN_IS_LOCKED} from '~/constants'

const UpdateStatusTestRunsRequestSchema = z.object({
  runId: z.number().gt(0),
  testIdStatusArray: z.array(
    z.object({
      testId: z.number().gt(0).optional(),
      status: z.string().optional(),
      comment: z.string().optional(),
      attachments: z
        .array(
          z.string().refine(isValidAttachmentKey, 'Invalid attachment key'),
        )
        .optional(),
    }),
  ),
  projectId: z.number().gt(0).optional(),
  comment: z.string().optional(),
})

export type UpdateStatusTestRunsRequestAPIType = z.infer<
  typeof UpdateStatusTestRunsRequestSchema
> & {userId: number}

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const user = await getUserAndCheckAccess({
      request,
      resource: API.RunUpdateTestStatus,
    })

    if (request.headers.get('content-type') !== 'application/json') {
      return responseHandler({
        error: 'Invalid content type',
        status: 400,
      })
    }

    const data = await getRequestParams(
      request,
      UpdateStatusTestRunsRequestSchema,
    )

    const runInfo = await RunsController.getRunInfo({runId: data.runId})

    if (!runInfo?.length) {
      return responseHandler({
        error: 'Run not found',
        status: 400,
      })
    }
    if (!(runInfo?.[0]?.status === 'Active')) {
      return responseHandler({
        error: RUN_IS_LOCKED,
        status: 423,
      })
    }

    const resp = await TestRunsController.updateStatusTestRuns({
      testIdStatusArray: data.testIdStatusArray,
      runId: data.runId,
      projectId: data.projectId,
      userId: user?.userId ?? 0,
      comment: data.comment,
    })

    return responseHandler({
      data: resp,
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
