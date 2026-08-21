const transaction = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {transaction},
}))

import {retryManualAttentionPlaneDefectCreate} from '../planeDefectRetry'

const correlationKey = 'checkmate:6fff5133-a23f-47d1-ad0d-b47fce28f441'
const intent = {
  create: true,
  defectCycleId: 1,
  correlationKey,
  title: 'Failed Checkmate step',
  description: 'Evidence',
  priority: 'high' as const,
  attachmentKeys: [],
}

const outbox = {
  eventType: 'plane_defect_create_requested',
  aggregateType: 'defect_cycle',
  aggregateId: 1,
  payload: {planeDefectIntent: intent},
  deliveryState: 'manual_attention',
}

const cycle = {
  state: 'manual_attention',
  providerIntakeId: null,
  providerWorkItemId: null,
  providerSequenceId: null,
  providerStateId: null,
  providerUrl: null,
  createCorrelationKey: correlationKey,
}

const createSelectQuery = (rows: unknown[]) => {
  const query = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    for: jest.fn(),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.for.mockReturnValue(query)
  return query
}

const createUpdateQuery = (affectedRows = 1) => {
  const where = jest.fn(async () => [{affectedRows}])
  const set = jest.fn(() => ({where}))
  return {set, where}
}

describe('manual Plane defect-create retry', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('atomically resets only the matching manual-attention event and cycle', async () => {
    const cycleUpdate = createUpdateQuery()
    const outboxUpdate = createUpdateQuery()
    const trx = {
      select: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery([outbox]))
        .mockReturnValueOnce(createSelectQuery([cycle])),
      update: jest
        .fn()
        .mockReturnValueOnce(cycleUpdate)
        .mockReturnValueOnce(outboxUpdate),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    const now = new Date('2026-08-21T00:00:00.000Z')

    await expect(
      retryManualAttentionPlaneDefectCreate({
        resultOutboxId: 1,
        correlationKey,
        now,
      }),
    ).resolves.toEqual({outcome: 'retried'})

    expect((trx.select as jest.Mock).mock.results[0].value.for).toHaveBeenCalledWith(
      'update',
    )
    expect((trx.select as jest.Mock).mock.results[1].value.for).toHaveBeenCalledWith(
      'update',
    )
    expect(cycleUpdate.set).toHaveBeenCalledWith({state: 'intake_pending'})
    expect(outboxUpdate.set).toHaveBeenCalledWith({
      deliveryState: 'pending',
      availableOn: now,
      leaseToken: null,
      leaseExpiresOn: null,
      lastError: null,
      deliveredOn: null,
    })
  })

  it('refuses lookalike work and never updates it', async () => {
    const trx = {
      select: jest.fn(() =>
        createSelectQuery([{...outbox, aggregateId: 2}]),
      ),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      retryManualAttentionPlaneDefectCreate({resultOutboxId: 1, correlationKey}),
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'Outbox event is not retryable',
    })
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('is idempotent because a reset event no longer satisfies the guard', async () => {
    const trx = {
      select: jest.fn(() =>
        createSelectQuery([{...outbox, deliveryState: 'pending'}]),
      ),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      retryManualAttentionPlaneDefectCreate({resultOutboxId: 1, correlationKey}),
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'Outbox event is not retryable',
    })
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('throws after a lost outbox fence so the transaction rolls back the cycle reset', async () => {
    const cycleUpdate = createUpdateQuery()
    const outboxUpdate = createUpdateQuery(0)
    const trx = {
      select: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery([outbox]))
        .mockReturnValueOnce(createSelectQuery([cycle])),
      update: jest
        .fn()
        .mockReturnValueOnce(cycleUpdate)
        .mockReturnValueOnce(outboxUpdate),
    }
    let rolledBack = false
    transaction.mockImplementation(async (callback) => {
      try {
        return await callback(trx)
      } catch (error) {
        rolledBack = true
        throw error
      }
    })

    await expect(
      retryManualAttentionPlaneDefectCreate({resultOutboxId: 1, correlationKey}),
    ).rejects.toThrow('Outbox retry fence was lost')
    expect(cycleUpdate.set).toHaveBeenCalledWith({state: 'intake_pending'})
    expect(rolledBack).toBe(true)
  })

  it('rejects a whitespace-only correlation before opening a transaction', async () => {
    await expect(
      retryManualAttentionPlaneDefectCreate({
        resultOutboxId: 1,
        correlationKey: '   ',
      }),
    ).rejects.toThrow('Plane defect retry requires a correlation key')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('propagates a transaction failure without a partial retry result', async () => {
    transaction.mockRejectedValue(new Error('database unavailable'))

    await expect(
      retryManualAttentionPlaneDefectCreate({resultOutboxId: 1, correlationKey}),
    ).rejects.toThrow('database unavailable')
  })
})
