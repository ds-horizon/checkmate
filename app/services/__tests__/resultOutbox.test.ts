const transaction = jest.fn()
const directUpdate = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {
    transaction,
    update: directUpdate,
  },
}))

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}))

import {randomUUID} from 'node:crypto'
import {
  claimResultOutboxEvents,
  finalizeResultOutboxEvent,
} from '../resultOutbox'

const createSelectQuery = (rows: unknown[]) => {
  const query: any = {}
  for (const method of ['from', 'where', 'orderBy', 'limit', 'for']) {
    query[method] = jest.fn(() => query)
  }
  query.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve)
  return query
}

const createUpdateQuery = (affectedRows = 1) => {
  const where = jest.fn(async () => [{affectedRows}])
  const set = jest.fn(() => ({where}))
  return {set, where}
}

const event = {
  resultOutboxId: 31,
  eventKey: 'result-revision:41:committed',
  eventType: 'result_revision_committed',
  aggregateType: 'test_run_map',
  aggregateId: 17,
  resultRevisionId: 41,
  payload: {
    resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
    resultRevisionId: 41,
    revisionNumber: 1,
    testRunMapId: 17,
    orgId: 3,
    projectId: 5,
    runId: 7,
    testId: 11,
    status: 'Failed',
    actorUserId: 23,
    actorType: 'human' as const,
    sourceSystem: 'checkmate' as const,
  },
  attemptCount: 0,
}

describe('result outbox leases', () => {
  beforeEach(() => {
    transaction.mockReset()
    directUpdate.mockReset()
    ;(randomUUID as jest.Mock).mockReset()
  })

  it('claims due events with unique fenced leases in deterministic order', async () => {
    const updateQueries = [createUpdateQuery(), createUpdateQuery()]
    const trx = {
      select: jest.fn(() =>
        createSelectQuery([event, {...event, resultOutboxId: 32}]),
      ),
      update: jest
        .fn()
        .mockReturnValueOnce(updateQueries[0])
        .mockReturnValueOnce(updateQueries[1]),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    ;(randomUUID as jest.Mock)
      .mockReturnValueOnce('lease-one')
      .mockReturnValueOnce('lease-two')
    const now = new Date('2026-08-20T00:00:00.000Z')

    const claimed = await claimResultOutboxEvents({
      limit: 2,
      leaseMs: 30_000,
      now,
    })

    expect(claimed).toEqual([
      expect.objectContaining({
        resultOutboxId: 31,
        attemptCount: 1,
        leaseToken: 'lease-one',
        leaseExpiresOn: new Date('2026-08-20T00:00:30.000Z'),
      }),
      expect.objectContaining({
        resultOutboxId: 32,
        attemptCount: 1,
        leaseToken: 'lease-two',
        leaseExpiresOn: new Date('2026-08-20T00:00:30.000Z'),
      }),
    ])
    const selectQuery = (trx.select as jest.Mock).mock.results[0].value
    expect(selectQuery.for).toHaveBeenCalledWith('update', {skipLocked: true})
    expect(trx.update).toHaveBeenCalledTimes(2)
  })

  it('returns no claims without issuing updates when nothing is due', async () => {
    const trx = {
      select: jest.fn(() => createSelectQuery([])),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(claimResultOutboxEvents()).resolves.toEqual([])
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('retries only bounded MySQL deadlock failures', async () => {
    const trx = {
      select: jest.fn(() => createSelectQuery([])),
      update: jest.fn(),
    }
    transaction
      .mockRejectedValueOnce({code: 'ER_LOCK_DEADLOCK', errno: 1213})
      .mockImplementationOnce(async (callback) => callback(trx))

    await expect(claimResultOutboxEvents()).resolves.toEqual([])
    expect(transaction).toHaveBeenCalledTimes(2)

    transaction.mockReset()
    transaction.mockRejectedValue({code: 'ER_LOCK_DEADLOCK', errno: 1213})

    await expect(claimResultOutboxEvents()).rejects.toMatchObject({
      code: 'ER_LOCK_DEADLOCK',
    })
    expect(transaction).toHaveBeenCalledTimes(3)
  })

  it('rejects unsafe batch and lease bounds before opening a transaction', async () => {
    await expect(claimResultOutboxEvents({limit: 0})).rejects.toThrow(
      'Outbox claim limit',
    )
    await expect(claimResultOutboxEvents({leaseMs: 0})).rejects.toThrow(
      'Outbox lease duration',
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it('finalizes delivery only when the row and lease token still match', async () => {
    const updateQuery = createUpdateQuery(1)
    directUpdate.mockReturnValue(updateQuery)
    const now = new Date('2026-08-20T00:01:00.000Z')

    await expect(
      finalizeResultOutboxEvent({
        resultOutboxId: 31,
        leaseToken: 'lease-one',
        outcome: 'delivered',
        now,
      }),
    ).resolves.toBe(true)

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryState: 'delivered',
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: null,
        deliveredOn: now,
      }),
    )
  })

  it('reports a stale lease without changing another worker result', async () => {
    directUpdate.mockReturnValue(createUpdateQuery(0))

    await expect(
      finalizeResultOutboxEvent({
        resultOutboxId: 31,
        leaseToken: 'expired-token',
        outcome: 'delivered',
      }),
    ).resolves.toBe(false)
  })

  it('requires bounded retry and manual-attention metadata', async () => {
    await expect(
      finalizeResultOutboxEvent({
        resultOutboxId: 31,
        leaseToken: 'lease-one',
        outcome: 'retry_due',
      }),
    ).rejects.toThrow('next available time')
    await expect(
      finalizeResultOutboxEvent({
        resultOutboxId: 31,
        leaseToken: 'lease-one',
        outcome: 'manual_attention',
      }),
    ).rejects.toThrow('requires a reason')
    expect(directUpdate).not.toHaveBeenCalled()
  })
})
