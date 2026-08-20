import {ActionFunctionArgs} from '@remix-run/node'
import {z} from 'zod'
import {TestStatusType} from '~/dataController/types'
import {ResultCommandError, saveHumanResult} from '~/services/resultCommands'
import {
  areResultRevisionCommandsEnabled,
  isPlaneDefectCreationEnabled,
} from '~/services/resultRevisionFlags'
import {isValidAttachmentKey} from '~/services/s3'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '~/routes/utilities/utils'

const SaveTestResultRequestSchema = z.object({
  resultCommandId: z.string().uuid(),
  testRunMapId: z.number().int().gt(0),
  status: z.nativeEnum(TestStatusType),
  comment: z.string().max(10000).nullable().optional(),
  attachmentKeys: z
    .array(z.string().refine(isValidAttachmentKey, 'Invalid attachment key'))
    .max(20)
    .optional(),
  createPlaneDefect: z.boolean().optional(),
})

export type SaveTestResultRequest = z.infer<typeof SaveTestResultRequestSchema>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const user = await getUserAndCheckAccess({
      request,
      resource: API.RunSaveTestResult,
    })

    if (!areResultRevisionCommandsEnabled()) {
      return responseHandler({error: 'Not found', status: 404})
    }
    if (request.headers.get('content-type') !== 'application/json') {
      return responseHandler({error: 'Invalid content type', status: 400})
    }
    if (!user?.userId) {
      return responseHandler({
        error: 'Authenticated actor is required',
        status: 401,
      })
    }

    const data = await getRequestParams(request, SaveTestResultRequestSchema)
    if (data.createPlaneDefect && !isPlaneDefectCreationEnabled()) {
      return responseHandler({error: 'Not found', status: 404})
    }
    const result = await saveHumanResult({...data, actorUserId: user.userId})

    return responseHandler({data: result, status: 200})
  } catch (error: any) {
    if (error instanceof ResultCommandError) {
      return responseHandler({error: error.message, status: error.status})
    }
    return errorResponseHandler(error)
  }
}
