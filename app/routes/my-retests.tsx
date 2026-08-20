import {ActionFunctionArgs, LoaderFunctionArgs, redirect} from '@remix-run/node'
import {useLoaderData} from '@remix-run/react'
import {MyRetestsPage} from '~/screens/MyRetests/MyRetestsPage'
import {
  acknowledgeMyRetestNotification,
  listMyRetestNotifications,
} from '~/services/resultNotifications'
import {getUser} from '~/routes/utilities/authenticate'

const requireAuthenticatedUserId = async (request: Request) => {
  const user = await getUser(request)
  if (!user?.userId) throw new Response('Unauthorized', {status: 401})
  return user.userId
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const userId = await requireAuthenticatedUserId(request)
  return {notifications: await listMyRetestNotifications(userId)}
}

export const action = async ({request}: ActionFunctionArgs) => {
  const userId = await requireAuthenticatedUserId(request)
  const formData = await request.formData()
  const resultNotificationId = Number(formData.get('resultNotificationId'))
  if (!Number.isInteger(resultNotificationId) || resultNotificationId < 1) {
    throw new Response('Invalid retest notification', {status: 400})
  }

  const deepLink = await acknowledgeMyRetestNotification({
    userId,
    resultNotificationId,
  })
  if (!deepLink) throw new Response('Retest notification not found', {status: 404})

  return redirect(deepLink)
}

export default function MyRetests() {
  const {notifications} = useLoaderData<typeof loader>()
  return <MyRetestsPage notifications={notifications} />
}
