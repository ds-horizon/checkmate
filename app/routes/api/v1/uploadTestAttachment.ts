/**
 * Upload Test Attachment API
 *
 * Uploads an attachment for a test case (expected behavior).
 * Supports both direct upload and presigned URL confirmation.
 *
 * POST /api/v1/test/attachments/upload?projectId=X&testId=Y
 * Body: multipart/form-data with file, or JSON with storageKey for presigned URL confirmation
 */

import {ActionFunctionArgs, unstable_parseMultipartFormData} from '@remix-run/node'
import {z} from 'zod'
import AttachmentsController from '@controllers/attachments.controller'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'
import {AttachmentType} from '~/services/storage'

// For JSON body (presigned URL confirmation)
const ConfirmUploadSchema = z.object({
  projectId: z.number().int().positive(),
  testId: z.number().int().positive(),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  description: z.string().optional(),
})

export type ConfirmUploadRequest = z.infer<typeof ConfirmUploadSchema>

// Mime type detection from file extension
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

function getMimeType(filename: string, providedType?: string): string {
  // Use provided type if it's valid
  if (providedType && providedType !== 'application/octet-stream') {
    return providedType
  }
  
  // Fallback to extension-based detection
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// Store for file data during upload processing
interface FileUploadData {
  filename: string
  buffer: Buffer
  contentType: string
  size: number
}

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const user = await getUserAndCheckAccess({
      request,
      resource: API.UploadTestAttachment,
    })

    const contentType = request.headers.get('content-type') || ''
    const url = new URL(request.url)

    // Handle multipart form data (direct file upload)
    if (contentType.includes('multipart/form-data')) {
      // Get projectId and testId from URL query params
      const projectId = Number(url.searchParams.get('projectId'))
      const testId = Number(url.searchParams.get('testId'))
      const description = url.searchParams.get('description') || undefined

      if (!projectId || !testId || isNaN(projectId) || isNaN(testId)) {
        return responseHandler({
          error: 'projectId and testId are required as query parameters',
          status: 400,
        })
      }

      // Store file data during parsing
      const fileDataStore: {data: FileUploadData | null} = {data: null}

      await unstable_parseMultipartFormData(
        request,
        async ({filename, data, contentType: fileContentType}) => {
          if (!filename) return null
          
          // Collect file chunks
          const chunks: Uint8Array[] = []
          for await (const chunk of data) {
            chunks.push(chunk)
          }
          const buffer = Buffer.concat(chunks)
          
          // Detect mime type from extension if not provided
          const mimeType = getMimeType(filename, fileContentType)
          
          // Store for later use
          fileDataStore.data = {
            filename,
            buffer,
            contentType: mimeType,
            size: buffer.length,
          }
          
          // Return filename as string (required by Remix)
          return filename
        },
      )

      const fileData = fileDataStore.data
      if (!fileData) {
        return responseHandler({error: 'No file provided', status: 400})
      }

      const result = await AttachmentsController.uploadTestAttachment({
        testId,
        projectId,
        file: fileData.buffer,
        filename: fileData.filename,
        mimeType: fileData.contentType,
        fileSize: fileData.size,
        description,
        createdBy: user?.userId ?? 0,
      })

      return responseHandler({
        data: result,
        status: 201,
      })
    }

    // Handle JSON body (presigned URL confirmation)
    const data = await getRequestParams<ConfirmUploadRequest>(
      request,
      ConfirmUploadSchema,
    )

    const result = await AttachmentsController.confirmUpload({
      testId: data.testId,
      projectId: data.projectId,
      storageKey: data.storageKey,
      filename: data.filename,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      description: data.description,
      createdBy: user?.userId ?? 0,
      attachmentType: AttachmentType.EXPECTED,
    })

    return responseHandler({
      data: result,
      status: 201,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
