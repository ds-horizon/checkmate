import RunsController from '@controllers/runs.controller'
import {ActionFunctionArgs} from '@remix-run/node'
import {z} from 'zod'
import {API} from '~/routes/utilities/api'
import {getUserAndCheckAccess} from '~/routes/utilities/checkForUserAndAccess'
import {
  errorResponseHandler,
  responseHandler,
} from '~/routes/utilities/responseHandler'
import {getRequestParams} from '../../utilities/utils'

const CreateRunRequestSchema = z.object({
  projectId: z.number().gt(0),
  runName: z
    .string()
    .min(5, {message: 'Run name must be at least 5 characters'})
    .max(50, {message: 'Run name must be at most 50 characters'}),
  runDescription: z.string().optional().nullable(),
  labelIds: z.array(z.number()).optional().nullable(),
  squadIds: z.array(z.number()).optional().nullable(),
  sectionIds: z.array(z.number()).optional().nullable(),
  filterType: z.enum(['and', 'or']).optional().nullable(),
  platformIds: z.array(z.number()).optional().nullable(),
  priorityIds: z.array(z.number()).optional().nullable(),
})

export type CreateRunRequestAPIType = z.infer<typeof CreateRunRequestSchema>

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const user = await getUserAndCheckAccess({
      request,
      resource: API.AddRun,
    })

    const data = await getRequestParams<CreateRunRequestAPIType>(
      request,
      CreateRunRequestSchema,
    )

    const runsData: any = await RunsController.createRun({
      ...data,
      filterType: data.filterType === 'or' ? 'or' : 'and',
      createdBy: user?.userId ?? 0,
    })

    return responseHandler({
      data: {
        runName: data.runName,
        runId: runsData.runId,
        testsAdded: runsData.runsAdded,
        message: `Added ${runsData.runsAdded} tests to run ${data.runName}`,
      },
      status: 200,
    })
  } catch (error: any) {
    return errorResponseHandler(error)
  }
}
