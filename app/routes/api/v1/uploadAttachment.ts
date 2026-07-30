import {
  ActionFunctionArgs,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from '@remix-run/node'
import {buildAttachmentKey, uploadAttachment} from '@services/s3'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.UploadAttachment,
    })

    // maxPartSize rejects the part while streaming rather than after the
    // whole multipart body has been buffered into memory.
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: MAX_FILE_SIZE_BYTES,
    })

    let formData
    try {
      formData = await unstable_parseMultipartFormData(request, uploadHandler)
    } catch (error: any) {
      if (error?.message?.includes('exceeded upload size')) {
        return responseHandler({
          error: 'File too large, max size is 10MB',
          status: 400,
        })
      }
      throw error
    }

    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return responseHandler({
        error: 'No file provided',
        status: 400,
      })
    }

    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return responseHandler({
        error: `Unsupported file type: ${file.type}`,
        status: 400,
      })
    }

    const key = buildAttachmentKey(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())

    await uploadAttachment({
      key,
      body: buffer,
      contentType: file.type,
    })

    return responseHandler({
      data: {key},
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
