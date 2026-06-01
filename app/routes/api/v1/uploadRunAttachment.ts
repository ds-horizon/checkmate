/**
 * Upload Run Attachment API
 *
 * Uploads an attachment for a test within a run (actual behavior).
 * Supports both direct upload and presigned URL confirmation.
 *
 * POST /api/v1/run/attachments/upload?projectId=X&runId=Y&testId=Z
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
  runId: z.number().int().positive(),
  testId: z.number().int().positive(),
  testRunMapId: z.number().int().positive().optional(),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  description: z.string().optional(),
})

export type ConfirmRunUploadRequest = z.infer<typeof ConfirmUploadSchema>

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
      resource: API.UploadRunAttachment,
    })

    const contentType = request.headers.get('content-type') || ''
    const url = new URL(request.url)

    // Handle multipart form data (direct file upload)
    if (contentType.includes('multipart/form-data')) {
      // Get IDs from URL query params
      const projectId = Number(url.searchParams.get('projectId'))
      const runId = Number(url.searchParams.get('runId'))
      const testId = Number(url.searchParams.get('testId'))
      const testRunMapId = url.searchParams.get('testRunMapId')
        ? Number(url.searchParams.get('testRunMapId'))
        : undefined
      const description = url.searchParams.get('description') || undefined

      if (!projectId || !runId || !testId || isNaN(projectId) || isNaN(runId) || isNaN(testId)) {
        return responseHandler({
          error: 'projectId, runId, and testId are required as query parameters',
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

      const result = await AttachmentsController.uploadRunAttachment({
        runId,
        testId,
        testRunMapId,
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
    const data = await getRequestParams<ConfirmRunUploadRequest>(
      request,
      ConfirmUploadSchema,
    )

    const result = await AttachmentsController.confirmUpload({
      testId: data.testId,
      projectId: data.projectId,
      runId: data.runId,
      testRunMapId: data.testRunMapId,
      storageKey: data.storageKey,
      filename: data.filename,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      description: data.description,
      createdBy: user?.userId ?? 0,
      attachmentType: AttachmentType.ACTUAL,
    })

    return responseHandler({
      data: result,
      status: 201,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
