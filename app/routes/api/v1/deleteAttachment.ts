import {ActionFunctionArgs} from '@remix-run/node'
import {deleteAttachment, isValidAttachmentKey} from '@services/s3'
import {z} from 'zod'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'

const DeleteAttachmentApiSchema = z.object({
  key: z.string().refine(isValidAttachmentKey, 'Invalid attachment key'),
})

export type DeleteAttachmentApiType = z.infer<typeof DeleteAttachmentApiSchema>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    await getUserAndCheckAccess({
      request,
      resource: API.DeleteAttachment,
    })

    if (request.headers.get('content-type') !== 'application/json') {
      return responseHandler({
        error: 'Invalid content type',
        status: 400,
      })
    }

    const data = await getRequestParams<DeleteAttachmentApiType>(
      request,
      DeleteAttachmentApiSchema,
    )

    await deleteAttachment(data.key)

    return responseHandler({
      data: {success: true},
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
