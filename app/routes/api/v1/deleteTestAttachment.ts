/**
 * Delete Test Attachment API
 *
 * Deletes an attachment from a test case.
 *
 * DELETE /api/v1/test/attachments/delete
 * Body: { attachmentId, projectId }
 */

import {ActionFunctionArgs} from '@remix-run/node'
import {z} from 'zod'
import AttachmentsController from '@controllers/attachments.controller'
import {AttachmentType} from '~/services/storage'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'

const DeleteTestAttachmentSchema = z.object({
  attachmentId: z.number().int().positive(),
  projectId: z.number().int().positive(),
})

export type DeleteTestAttachmentRequest = z.infer<typeof DeleteTestAttachmentSchema>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.DeleteTestAttachment,
    })

    const data = await getRequestParams<DeleteTestAttachmentRequest>(
      request,
      DeleteTestAttachmentSchema,
    )

    const result = await AttachmentsController.deleteAttachment({
      attachmentId: data.attachmentId,
      projectId: data.projectId,
      attachmentType: AttachmentType.EXPECTED,
    })

    if (!result.deleted) {
      return responseHandler({
        error: 'Attachment not found or already deleted',
        status: 404,
      })
    }

    return responseHandler({
      data: {message: 'Attachment deleted successfully'},
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}

