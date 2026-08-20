const select = jest.fn()
const transaction = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {select, transaction},
}))

import {
  acknowledgeMyRetestNotification,
  listMyRetestNotifications,
} from '../resultNotifications'

const createQuery = (rows: unknown[]) => {
  const query: any = {}
  for (const method of [
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'for',
  ]) {
    query[method] = jest.fn(() => query)
  }
  query.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve)
  return query
}

describe('result notifications', () => {
  beforeEach(() => {
    select.mockReset()
    transaction.mockReset()
  })

  it('lists only the authenticated user notification projection', async () => {
    const notification = {
      resultNotificationId: 91,
      defectCycleId: 73,
      resultRevisionId: 41,
      projectId: 5,
      projectName: 'Checkout',
      runId: 7,
      runName: 'Release candidate',
      testId: 11,
      testTitle: 'Payment succeeds',
      readOn: null,
      createdOn: new Date('2026-08-20T01:00:00.000Z'),
    }
    const query = createQuery([notification])
    select.mockReturnValue(query)

    await expect(listMyRetestNotifications(23)).resolves.toEqual([
      notification,
    ])
    expect(query.innerJoin).toHaveBeenCalledTimes(4)
    expect(query.orderBy).toHaveBeenCalledTimes(1)
    expect(query.limit).toHaveBeenCalledWith(100)
  })

  it('acknowledges an owned notification and returns its server-derived link', async () => {
    const selectQuery = createQuery([
      {
        resultNotificationId: 91,
        projectId: 5,
        runId: 7,
        testId: 11,
        readOn: null,
      },
    ])
    const where = jest.fn(async () => [{affectedRows: 1}])
    const set = jest.fn(() => ({where}))
    const trx = {
      select: jest.fn(() => selectQuery),
      update: jest.fn(() => ({set})),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    const now = new Date('2026-08-20T02:00:00.000Z')

    await expect(
      acknowledgeMyRetestNotification({
        userId: 23,
        resultNotificationId: 91,
        now,
      }),
    ).resolves.toBe('/project/5/run/7/test/11')
    expect(selectQuery.for).toHaveBeenCalledWith('update')
    expect(set).toHaveBeenCalledWith({readOn: now})
  })

  it('does not acknowledge a notification outside the authenticated user', async () => {
    const trx = {
      select: jest.fn(() => createQuery([])),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      acknowledgeMyRetestNotification({
        userId: 23,
        resultNotificationId: 91,
      }),
    ).resolves.toBeNull()
    expect(trx.update).not.toHaveBeenCalled()
  })
})
