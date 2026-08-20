import {ActionFunctionArgs} from '@remix-run/node'
import {
  ResultAttachmentError,
  recordResultAttachmentDeleted,
  recordResultAttachmentDeletionFailure,
  reserveResultAttachmentDeletion,
} from '@services/resultAttachments'
import {deleteAttachment, isValidAttachmentKey} from '@services/s3'
import {z} from 'zod'
import {areResultRevisionCommandsEnabled} from '~/services/resultRevisionFlags'
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
    const user = await getUserAndCheckAccess({
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

    if (areResultRevisionCommandsEnabled()) {
      if (!user?.userId) {
        return responseHandler({
          error: 'Authenticated actor is required',
          status: 401,
        })
      }

      const recoveryState = await reserveResultAttachmentDeletion({
        objectKey: data.key,
        actorUserId: user.userId,
      })
      try {
        await deleteAttachment(data.key)
      } catch (error) {
        await recordResultAttachmentDeletionFailure(
          data.key,
          error,
          recoveryState,
        )
        throw error
      }
      await recordResultAttachmentDeleted(data.key)
    } else {
      await deleteAttachment(data.key)
    }

    return responseHandler({
      data: {success: true},
      status: 200,
    })
  } catch (error: any) {
    if (error instanceof ResultAttachmentError) {
      return responseHandler({error: error.message, status: error.status})
    }
    return errorResponseHandler(error)
  }
}
