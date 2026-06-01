/**
 * Get Test Attachments API
 *
 * Retrieves all attachments for a specific test (expected behavior).
 *
 * GET /api/v1/test/attachments
 * Query params: projectId, testId
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

const GetTestAttachmentsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  testId: z.coerce.number().int().positive(),
})

export type GetTestAttachmentsRequest = z.infer<typeof GetTestAttachmentsSchema>

export const loader = async ({request}: LoaderFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.GetTestAttachments,
    })

    const url = new URL(request.url)
    const params = GetTestAttachmentsSchema.parse({
      projectId: url.searchParams.get('projectId'),
      testId: url.searchParams.get('testId'),
    })

    const attachments = await AttachmentsController.getTestAttachments({
      testId: params.testId,
      projectId: params.projectId,
    })

    return responseHandler({
      data: attachments,
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}

