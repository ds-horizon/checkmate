/**
 * Confirm Attachment Upload API
 *
 * Confirms an upload after the client has uploaded to storage via presigned URL.
 * Creates the database record for the attachment.
 *
 * POST /api/v1/attachments/confirm-upload
 * Body: { projectId, testId, runId?, storageKey, filename, mimeType, fileSize, description?, attachmentType }
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

const ConfirmAttachmentUploadSchema = z.object({
  projectId: z.number().int().positive(),
  testId: z.number().int().positive(),
  runId: z.number().int().positive().optional(),
  testRunMapId: z.number().int().positive().optional(),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  description: z.string().optional(),
  attachmentType: z.enum(['expected', 'actual']),
})

export type ConfirmAttachmentUploadRequest = z.infer<
  typeof ConfirmAttachmentUploadSchema
>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const user = await getUserAndCheckAccess({
      request,
      resource: API.ConfirmAttachmentUpload,
    })

    const data = await getRequestParams<ConfirmAttachmentUploadRequest>(
      request,
      ConfirmAttachmentUploadSchema,
    )

    // Validate that runId is provided for actual attachments
    if (data.attachmentType === 'actual' && !data.runId) {
      return responseHandler({
        error: 'runId is required for actual behavior attachments',
        status: 400,
      })
    }

    const result = await AttachmentsController.confirmUpload({
      projectId: data.projectId,
      testId: data.testId,
      runId: data.runId,
      testRunMapId: data.testRunMapId,
      storageKey: data.storageKey,
      filename: data.filename,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      description: data.description,
      createdBy: user?.userId ?? 0,
      attachmentType:
        data.attachmentType === 'expected'
          ? AttachmentType.EXPECTED
          : AttachmentType.ACTUAL,
    })

    return responseHandler({
      data: result,
      status: 201,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}

