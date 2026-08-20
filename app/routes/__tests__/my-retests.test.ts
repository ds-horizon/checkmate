const getUser = jest.fn()
const listMyRetestNotifications = jest.fn()
const acknowledgeMyRetestNotification = jest.fn()

jest.mock('~/routes/utilities/authenticate', () => ({getUser}))
jest.mock('~/services/resultNotifications', () => ({
  listMyRetestNotifications,
  acknowledgeMyRetestNotification,
}))

import {action, loader} from '../my-retests'

const makeLoaderArgs = (request: Request): Parameters<typeof loader>[0] => ({
  request,
  params: {},
  context: {},
})

const makeActionArgs = (request: Request): Parameters<typeof action>[0] => ({
  request,
  params: {},
  context: {},
})

describe('my-retests route', () => {
  beforeEach(() => {
    getUser.mockReset()
    listMyRetestNotifications.mockReset()
    acknowledgeMyRetestNotification.mockReset()
  })

  it('loads only the authenticated user notifications', async () => {
    getUser.mockResolvedValue({userId: 23})
    listMyRetestNotifications.mockResolvedValue([{resultNotificationId: 91}])

    await expect(
      loader(makeLoaderArgs(new Request('http://checkmate/my-retests'))),
    ).resolves.toEqual({notifications: [{resultNotificationId: 91}]})
    expect(listMyRetestNotifications).toHaveBeenCalledWith(23)
  })

  it('acknowledges an owned notification before redirecting', async () => {
    getUser.mockResolvedValue({userId: 23})
    acknowledgeMyRetestNotification.mockResolvedValue(
      '/project/5/run/7/test/11',
    )
    const request = new Request('http://checkmate/my-retests', {
      method: 'POST',
      body: new URLSearchParams({resultNotificationId: '91'}),
    })

    const response = await action(makeActionArgs(request))

    expect(acknowledgeMyRetestNotification).toHaveBeenCalledWith({
      userId: 23,
      resultNotificationId: 91,
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/project/5/run/7/test/11')
  })

  it('rejects malformed notification identifiers', async () => {
    getUser.mockResolvedValue({userId: 23})
    const request = new Request('http://checkmate/my-retests', {
      method: 'POST',
      body: new URLSearchParams({resultNotificationId: 'not-a-number'}),
    })

    await expect(action(makeActionArgs(request))).rejects.toMatchObject({
      status: 400,
    })
    expect(acknowledgeMyRetestNotification).not.toHaveBeenCalled()
  })
})
