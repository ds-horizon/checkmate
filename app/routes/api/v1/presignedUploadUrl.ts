/**
 * Get Presigned Upload URL API
 *
 * Generates a presigned URL for direct client-side upload to storage.
 * This allows clients to upload files directly to the storage provider
 * without going through the server.
 *
 * POST /api/v1/attachments/presigned-url
 * Body: { projectId, testId, runId?, filename, mimeType, fileSize, attachmentType }
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

const GetPresignedUploadUrlSchema = z.object({
  projectId: z.number().int().positive(),
  testId: z.number().int().positive(),
  runId: z.number().int().positive().optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  attachmentType: z.enum(['expected', 'actual']),
})

export type GetPresignedUploadUrlRequest = z.infer<
  typeof GetPresignedUploadUrlSchema
>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.GetPresignedUploadUrl,
    })

    const data = await getRequestParams<GetPresignedUploadUrlRequest>(
      request,
      GetPresignedUploadUrlSchema,
    )

    // Validate that runId is provided for actual attachments
    if (data.attachmentType === 'actual' && !data.runId) {
      return responseHandler({
        error: 'runId is required for actual behavior attachments',
        status: 400,
      })
    }

    const result = await AttachmentsController.getPresignedUploadUrl({
      projectId: data.projectId,
      testId: data.testId,
      runId: data.runId,
      filename: data.filename,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      attachmentType:
        data.attachmentType === 'expected'
          ? AttachmentType.EXPECTED
          : AttachmentType.ACTUAL,
    })

    return responseHandler({
      data: result,
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}

