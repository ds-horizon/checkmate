/**
 * Get Run Attachments API
 *
 * Retrieves all attachments for a test within a run.
 * Returns both expected (from test definition) and actual (from run execution) attachments.
 *
 * GET /api/v1/run/attachments
 * Query params: projectId, runId, testId
 */

import {LoaderFunctionArgs} from '@remix-run/node'
import {z} from 'zod'
import AttachmentsController from '@controllers/attachments.controller'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'

const GetRunAttachmentsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  runId: z.coerce.number().int().positive(),
  testId: z.coerce.number().int().positive(),
})

export type GetRunAttachmentsRequest = z.infer<typeof GetRunAttachmentsSchema>

export const loader = async ({request}: LoaderFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.GetRunAttachments,
    })

    const url = new URL(request.url)
    const params = GetRunAttachmentsSchema.parse({
      projectId: url.searchParams.get('projectId'),
      runId: url.searchParams.get('runId'),
      testId: url.searchParams.get('testId'),
    })

    // Get both expected (test-level) and actual (run-level) attachments
    const attachments = await AttachmentsController.getAllAttachmentsForRunTest({
      testId: params.testId,
      projectId: params.projectId,
      runId: params.runId,
    })

    return responseHandler({
      data: attachments,
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}

