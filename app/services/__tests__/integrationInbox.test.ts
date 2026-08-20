const transaction = jest.fn()
const directInsert = jest.fn()
const directSelect = jest.fn()
const directUpdate = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {
    transaction,
    insert: directInsert,
    select: directSelect,
    update: directUpdate,
  },
}))

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}))

import {randomUUID} from 'node:crypto'
import {
  claimIntegrationInboxEvents,
  claimIntegrationPollCursor,
  finalizeIntegrationInboxEvent,
  finalizeIntegrationPollCursor,
  fingerprintIntegrationEvent,
  recordVerifiedIntegrationEvent,
} from '../integrationInbox'

const createQuery = (rows: unknown[]) => {
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

describe('integration inbox and poll leases', () => {
  beforeEach(() => {
    transaction.mockReset()
    directInsert.mockReset()
    directSelect.mockReset()
    directUpdate.mockReset()
    ;(randomUUID as jest.Mock).mockReset()
  })

  it('fingerprints provider payloads independently of object key order', () => {
    expect(
      fingerprintIntegrationEvent({
        eventType: 'work_item.updated',
        payload: {b: 2, nested: {z: 3, a: 1}},
      }),
    ).toBe(
      fingerprintIntegrationEvent({
        eventType: 'work_item.updated',
        payload: {nested: {a: 1, z: 3}, b: 2},
      }),
    )
  })

  it('persists a verified provider delivery before processing', async () => {
    const values = jest.fn(async () => [{insertId: 71}])
    directInsert.mockReturnValue({values})

    await expect(
      recordVerifiedIntegrationEvent({
        provider: 'plane',
        providerDeliveryId: 'delivery-1',
        eventType: 'work_item.updated',
        payload: {workItemId: 'item-1'},
      }),
    ).resolves.toEqual({integrationInboxId: 71, replayed: false})
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureState: 'verified',
        deliveryState: 'pending',
      }),
    )
  })

  it('replays an identical delivery and rejects a conflicting one', async () => {
    const duplicate = {code: 'ER_DUP_ENTRY', errno: 1062}
    directInsert.mockReturnValue({
      values: jest.fn().mockRejectedValue(duplicate),
    })
    const fingerprint = fingerprintIntegrationEvent({
      eventType: 'work_item.updated',
      payload: {workItemId: 'item-1'},
    })
    directSelect.mockReturnValue(
      createQuery([{integrationInboxId: 71, eventFingerprint: fingerprint}]),
    )

    await expect(
      recordVerifiedIntegrationEvent({
        provider: 'plane',
        providerDeliveryId: 'delivery-1',
        eventType: 'work_item.updated',
        payload: {workItemId: 'item-1'},
      }),
    ).resolves.toEqual({integrationInboxId: 71, replayed: true})

    directSelect.mockReturnValue(
      createQuery([{integrationInboxId: 71, eventFingerprint: 'different'}]),
    )
    await expect(
      recordVerifiedIntegrationEvent({
        provider: 'plane',
        providerDeliveryId: 'delivery-1',
        eventType: 'work_item.updated',
        payload: {workItemId: 'item-1'},
      }),
    ).rejects.toMatchObject({status: 409})
  })

  it('claims inbox rows with skip-locked leases and token fencing', async () => {
    const event = {
      integrationInboxId: 71,
      provider: 'plane',
      providerDeliveryId: 'delivery-1',
      eventType: 'work_item.updated',
      payload: {workItemId: 'item-1'},
      attemptCount: 0,
    }
    const updateQuery = createUpdateQuery()
    const trx = {
      select: jest.fn(() => createQuery([event])),
      update: jest.fn(() => updateQuery),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    ;(randomUUID as jest.Mock).mockReturnValue('inbox-lease')
    const now = new Date('2026-08-20T00:00:00.000Z')

    await expect(
      claimIntegrationInboxEvents({limit: 1, leaseMs: 30_000, now}),
    ).resolves.toEqual([
      expect.objectContaining({
        integrationInboxId: 71,
        attemptCount: 1,
        leaseToken: 'inbox-lease',
        leaseExpiresOn: new Date('2026-08-20T00:00:30.000Z'),
      }),
    ])
    const selectQuery = (trx.select as jest.Mock).mock.results[0].value
    expect(selectQuery.for).toHaveBeenCalledWith('update', {skipLocked: true})

    const staleUpdate = createUpdateQuery(0)
    directUpdate.mockReturnValue(staleUpdate)
    await expect(
      finalizeIntegrationInboxEvent({
        integrationInboxId: 71,
        leaseToken: 'stale',
        outcome: 'applied',
      }),
    ).resolves.toBe(false)
  })

  it('retries only bounded deadlocks while claiming inbox rows', async () => {
    const trx = {
      select: jest.fn(() => createQuery([])),
      update: jest.fn(),
    }
    transaction
      .mockRejectedValueOnce({code: 'ER_LOCK_DEADLOCK', errno: 1213})
      .mockImplementationOnce(async (callback) => callback(trx))

    await expect(claimIntegrationInboxEvents()).resolves.toEqual([])
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('leases a persisted poll cursor and rejects stale finalization', async () => {
    const cursor = {
      integrationPollCursorId: 81,
      cursorValue: 'cursor-1',
      leaseExpiresOn: null,
    }
    const claimUpdate = createUpdateQuery()
    const trx = {
      select: jest.fn(() => createQuery([cursor])),
      update: jest.fn(() => claimUpdate),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    ;(randomUUID as jest.Mock).mockReturnValue('poll-lease')

    await expect(
      claimIntegrationPollCursor({
        provider: 'plane',
        destinationKey: 'development:BIZ',
        now: new Date('2026-08-20T00:00:00.000Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        leaseToken: 'poll-lease',
        cursorValue: 'cursor-1',
      }),
    )

    directUpdate.mockReturnValue(createUpdateQuery(0))
    await expect(
      finalizeIntegrationPollCursor({
        integrationPollCursorId: 81,
        leaseToken: 'stale',
        cursorValue: 'cursor-2',
      }),
    ).resolves.toBe(false)
  })
})
