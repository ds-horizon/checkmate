const transaction = jest.fn()
const mockClaimIntegrationInboxEvents = jest.fn()
const mockClaimIntegrationPollCursor = jest.fn()
const mockFinalizeIntegrationInboxEvent = jest.fn()
const mockFinalizeIntegrationPollCursor = jest.fn()
const mockReconcilePlaneRetestReadiness = jest.fn()
const mockRecordVerifiedIntegrationEvent = jest.fn()
const select = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {transaction, select},
}))

jest.mock('../integrationInbox', () => ({
  claimIntegrationInboxEvents: mockClaimIntegrationInboxEvents,
  claimIntegrationPollCursor: mockClaimIntegrationPollCursor,
  finalizeIntegrationInboxEvent: mockFinalizeIntegrationInboxEvent,
  finalizeIntegrationPollCursor: mockFinalizeIntegrationPollCursor,
  recordVerifiedIntegrationEvent: mockRecordVerifiedIntegrationEvent,
}))

jest.mock('../planeReconciliation', () => ({
  reconcilePlaneRetestReadiness: mockReconcilePlaneRetestReadiness,
}))

import {
  applyPlaneRetestReadiness,
  fenceInvalidPlaneRetestReadinessRoutes,
  planePollDeliveryId,
  planeRetestReadinessInboxLeaseMs,
  processPlaneRetestReadinessInbox,
  readPlaneRetestReadinessBatchSize,
  readPlaneRetestReadinessConfig,
  runConfiguredPlaneRetestReadinessBatch,
} from '../planeRetestReadiness'
import {PlaneAdapter, PlaneAdapterError} from '../planeAdapter'

type QueryResult = unknown[]

const createQuery = (result: QueryResult) => {
  const query = {
    from: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    for: jest.fn(),
    then: (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(resolve),
  }
  query.from.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.orderBy.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.for.mockReturnValue(query)
  return query
}

const readinessConfig = {
  doneStateId: 'done-state-id',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  apiTimeoutMs: 100,
  maxRequestWaitMs: 60_000,
  destinationKey:
    'plane:e36dfd86-953a-4e33-a410-856208893bb9:67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  planeDestination: 'biz-development' as const,
}

const createAdapter = (
  getWorkItem: PlaneAdapter['getWorkItem'],
): PlaneAdapter => ({
  getWorkItem,
  createIntake: async () => {
    throw new Error('createIntake is not used by readiness processing')
  },
  ensureComment: async () => {
    throw new Error('ensureComment is not used by readiness processing')
  },
  ensureAttachment: async () => {
    throw new Error('ensureAttachment is not used by readiness processing')
  },
  ensureWorkItemState: async () => {
    throw new Error('ensureWorkItemState is not used by readiness processing')
  },
})

describe('Plane retest readiness', () => {
  beforeEach(() => {
    transaction.mockReset()
    select.mockReset()
    mockClaimIntegrationInboxEvents.mockReset()
    mockClaimIntegrationInboxEvents.mockResolvedValue([])
    mockClaimIntegrationPollCursor.mockReset()
    mockFinalizeIntegrationInboxEvent.mockReset()
    mockFinalizeIntegrationPollCursor.mockReset()
    mockRecordVerifiedIntegrationEvent.mockReset()
    mockReconcilePlaneRetestReadiness.mockReset()
    mockReconcilePlaneRetestReadiness.mockResolvedValue('matched')
  })

  it('requires an exact configured Done-state id', () => {
    expect(() =>
      readPlaneRetestReadinessConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
      }),
    ).toThrow('PLANE_RETEST_READINESS_DONE_STATE_ID')
    expect(
      readPlaneRetestReadinessConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
        PLANE_RETEST_READINESS_DONE_STATE_ID: 'done-state-id',
      }),
    ).toEqual(
      expect.objectContaining({
        doneStateId: 'done-state-id',
        planeDestination: 'biz-development',
        destinationKey:
          'plane:e36dfd86-953a-4e33-a410-856208893bb9:67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
      }),
    )
  })

  it('uses the locked DFR Done state for DeepFrame readiness', () => {
    expect(
      readPlaneRetestReadinessConfig({
        PLANE_DESTINATION: 'dfr-development',
        PLANE_API_KEY: 'key',
      }),
    ).toEqual(
      expect.objectContaining({
        doneStateId: 'ff905e71-9caa-49cd-83c3-cdd90cd345a6',
        planeDestination: 'dfr-development',
        destinationKey:
          'plane:e36dfd86-953a-4e33-a410-856208893bb9:65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
      }),
    )
  })

  it('defaults readiness batches to one item and accepts bounded configuration', () => {
    expect(readPlaneRetestReadinessBatchSize({})).toBe(1)
    expect(
      readPlaneRetestReadinessBatchSize({
        PLANE_RETEST_READINESS_BATCH_SIZE: '10',
      }),
    ).toBe(10)
  })

  it.each(['0', '11', '1.5', 'invalid', ' 1']) (
    'fails closed for invalid readiness batch size %s',
    (configured) => {
      expect(() =>
        readPlaneRetestReadinessBatchSize({
          PLANE_RETEST_READINESS_BATCH_SIZE: configured,
        }),
      ).toThrow(
        'PLANE_RETEST_READINESS_BATCH_SIZE must be an integer between 1 and 10',
      )
    },
  )

  it('uses the one-item canary default for the configured readiness runner', async () => {
    mockClaimIntegrationPollCursor.mockResolvedValue(null)
    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
        },
        leaseMs: 70_100,
      }),
    ).resolves.toEqual(expect.objectContaining({enabled: true, claimedCursor: false}))
  })

  it('services BIZ and DFR with isolated readiness cursors in one invocation', async () => {
    mockClaimIntegrationPollCursor.mockResolvedValue(null)
    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'biz-done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
        },
        leaseMs: 70_100,
      }),
    ).resolves.toEqual(
      expect.objectContaining({enabled: true, claimedCursor: false}),
    )
    expect(mockClaimIntegrationPollCursor).toHaveBeenCalledTimes(2)
    expect(mockClaimIntegrationPollCursor.mock.calls).toEqual([
      [
        expect.objectContaining({
          destinationKey:
            'plane:e36dfd86-953a-4e33-a410-856208893bb9:67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
        }),
      ],
      [
        expect.objectContaining({
          destinationKey:
            'plane:e36dfd86-953a-4e33-a410-856208893bb9:65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        }),
      ],
    ])
  })

  it('persists both poll routes then claims once and dispatches each event to its own adapter', async () => {
    const persistedInputs: Array<{
      provider: string
      providerDeliveryId: string
      eventType: string
      payload: Record<string, unknown>
    }> = []
    const bizGetWorkItem = jest.fn(async (workItemId: string) => ({
      workItemId,
      stateId: 'biz-state',
      versionMarker: null,
      raw: {},
    }))
    const dfrGetWorkItem = jest.fn(async (workItemId: string) => ({
      workItemId,
      stateId: 'dfr-state',
      versionMarker: null,
      raw: {},
    }))
    transaction.mockImplementation(async (callback) =>
      callback({
        select: jest.fn(() => createQuery([])),
        update: jest.fn(),
        insert: jest.fn(),
      }),
    )
    select
      .mockImplementationOnce(() =>
        createQuery([
          {
            defectCycleId: 201,
            workItemId: 'biz-work-item',
            readinessGeneration: 1,
          },
        ]),
      )
      .mockImplementationOnce(() =>
        createQuery([
          {
            defectCycleId: 202,
            workItemId: 'dfr-work-item',
            readinessGeneration: 2,
          },
        ]),
      )
    mockClaimIntegrationPollCursor
      .mockResolvedValueOnce({
        integrationPollCursorId: 301,
        provider: 'plane',
        destinationKey: readinessConfig.destinationKey,
        cursorValue: null,
        leaseToken: 'cursor-biz',
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      })
      .mockResolvedValueOnce({
        integrationPollCursorId: 302,
        provider: 'plane',
        destinationKey:
          'plane:e36dfd86-953a-4e33-a410-856208893bb9:65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        cursorValue: null,
        leaseToken: 'cursor-dfr',
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      })
    mockFinalizeIntegrationPollCursor.mockResolvedValue(true)
    mockRecordVerifiedIntegrationEvent.mockImplementation(async (input) => {
      persistedInputs.push(input)
      return {
        integrationInboxId: 400 + persistedInputs.length,
        replayed: false,
      }
    })
    mockClaimIntegrationInboxEvents.mockImplementation(async () =>
      persistedInputs.map((input, index) => ({
        integrationInboxId: 400 + index + 1,
        provider: input.provider,
        providerDeliveryId: input.providerDeliveryId,
        eventType: input.eventType,
        payload: input.payload,
        attemptCount: 1,
        leaseToken: `inbox-${index + 1}`,
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      })),
    )
    mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)

    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'biz-done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
        },
        adapters: {
          'biz-development': createAdapter(bizGetWorkItem),
          'dfr-development': createAdapter(dfrGetWorkItem),
        },
        leaseMs: 70_100,
      }),
    ).resolves.toEqual(expect.objectContaining({observed: 2, persisted: 2, noOp: 2}))

    expect(mockClaimIntegrationInboxEvents).toHaveBeenCalledTimes(1)
    expect(persistedInputs).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          providerWorkspaceId:
            'e36dfd86-953a-4e33-a410-856208893bb9',
          providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          providerWorkspaceId:
            'e36dfd86-953a-4e33-a410-856208893bb9',
          providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        }),
      }),
    ])
    expect(bizGetWorkItem.mock.calls).toEqual([
      ['biz-work-item'],
      ['biz-work-item'],
    ])
    expect(dfrGetWorkItem.mock.calls).toEqual([
      ['dfr-work-item'],
      ['dfr-work-item'],
    ])
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledTimes(2)
  })

  it('fences missing, unknown, and mixed UUID routes transactionally before polling', async () => {
    const updatedValues: unknown[] = []
    const findingValues: unknown[] = []
    const updateWhere = jest.fn(async () => [{affectedRows: 1}])
    const update = jest.fn(() => ({
      set: jest.fn((values: unknown) => {
        updatedValues.push(values)
        return {where: updateWhere}
      }),
    }))
    const onDuplicateKeyUpdate = jest.fn(async () => undefined)
    const insert = jest.fn(() => ({
      values: jest.fn((values: unknown) => {
        findingValues.push(values)
        return {onDuplicateKeyUpdate}
      }),
    }))
    transaction.mockImplementation(async (callback) =>
      callback({
        select: jest.fn(() =>
          createQuery([
            {
              defectCycleId: 501,
              providerWorkspaceId: null,
              providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
            },
            {
              defectCycleId: 502,
              providerWorkspaceId:
                'e36dfd86-953a-4e33-a410-856208893bb9',
              providerProjectId: 'unknown-project',
            },
            {
              defectCycleId: 503,
              providerWorkspaceId: 'unexpected-workspace',
              providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
            },
            {
              defectCycleId: 504,
              providerWorkspaceId:
                'e36dfd86-953a-4e33-a410-856208893bb9',
              providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
            },
          ]),
        ),
        update,
        insert,
      }),
    )
    const now = new Date('2026-08-20T00:00:00.000Z')

    await expect(
      fenceInvalidPlaneRetestReadinessRoutes({now}),
    ).resolves.toBe(3)

    expect(update).toHaveBeenCalledTimes(3)
    expect(updatedValues).toEqual([
      {state: 'manual_attention'},
      {state: 'manual_attention'},
      {state: 'manual_attention'},
    ])
    expect(insert).toHaveBeenCalledTimes(3)
    expect(findingValues).toEqual([
      expect.objectContaining({
        findingKey: 'plane-cycle:501:route-identity',
        findingType: 'plane_invalid_route_identity',
        state: 'manual_attention',
        actualSnapshot: {
          providerWorkspaceId: null,
          providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        },
      }),
      expect.objectContaining({
        findingKey: 'plane-cycle:502:route-identity',
        findingType: 'plane_invalid_route_identity',
      }),
      expect.objectContaining({
        findingKey: 'plane-cycle:503:route-identity',
        findingType: 'plane_invalid_route_identity',
        actualSnapshot: {
          providerWorkspaceId: 'unexpected-workspace',
          providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        },
      }),
    ])
    expect(onDuplicateKeyUpdate).toHaveBeenCalledTimes(3)
  })

  it('claims the shared inbox once and routes due BIZ and DFR events to their own adapters', async () => {
    transaction.mockImplementation(async (callback) =>
      callback({
        select: jest.fn(() => createQuery([])),
        update: jest.fn(),
        insert: jest.fn(),
      }),
    )
    mockClaimIntegrationPollCursor.mockResolvedValue(null)
    mockClaimIntegrationInboxEvents.mockResolvedValue([
      {
        integrationInboxId: 101,
        provider: 'plane',
        providerDeliveryId: 'biz-delivery-101',
        eventType: 'plane.work_item.authoritative_state',
        payload: {
          workItemId: 'biz-work-item',
          stateId: 'biz-state',
          providerWorkspaceId:
            'e36dfd86-953a-4e33-a410-856208893bb9',
          providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
        },
        attemptCount: 1,
        leaseToken: 'lease-biz-101',
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      },
      {
        integrationInboxId: 102,
        provider: 'plane',
        providerDeliveryId: 'dfr-delivery-102',
        eventType: 'plane.work_item.authoritative_state',
        payload: {
          workItemId: 'dfr-work-item',
          stateId: 'dfr-state',
          providerWorkspaceId:
            'e36dfd86-953a-4e33-a410-856208893bb9',
          providerProjectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
        },
        attemptCount: 1,
        leaseToken: 'lease-dfr-102',
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      },
    ])
    mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)
    mockReconcilePlaneRetestReadiness.mockResolvedValue('matched')
    const bizGetWorkItem = jest.fn(async () => ({
      workItemId: 'biz-work-item',
      stateId: 'biz-state',
      versionMarker: null,
      raw: {},
    }))
    const dfrGetWorkItem = jest.fn(async () => ({
      workItemId: 'dfr-work-item',
      stateId: 'dfr-state',
      versionMarker: null,
      raw: {},
    }))

    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'biz-done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
        },
        adapters: {
          'biz-development': createAdapter(bizGetWorkItem),
          'dfr-development': createAdapter(dfrGetWorkItem),
        },
        leaseMs: 70_100,
      }),
    ).resolves.toEqual(expect.objectContaining({noOp: 2}))

    expect(mockClaimIntegrationInboxEvents).toHaveBeenCalledTimes(1)
    expect(mockClaimIntegrationInboxEvents).toHaveBeenCalledWith(
      expect.objectContaining({limit: 2}),
    )
    expect(bizGetWorkItem).toHaveBeenCalledWith('biz-work-item')
    expect(dfrGetWorkItem).toHaveBeenCalledWith('dfr-work-item')
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledTimes(2)
  })

  it('finalizes an unknown or missing route without a provider call', async () => {
    const getWorkItem = jest.fn()
    mockClaimIntegrationInboxEvents.mockResolvedValue([
      {
        integrationInboxId: 103,
        provider: 'plane',
        providerDeliveryId: 'unknown-route-103',
        eventType: 'plane.work_item.authoritative_state',
        payload: {
          workItemId: 'unknown-work-item',
          stateId: 'unknown-state',
          providerWorkspaceId: 'unexpected-workspace',
          providerProjectId: 'unexpected-project',
        },
        attemptCount: 1,
        leaseToken: 'lease-unknown-103',
        leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
      },
    ])
    mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)

    await expect(
      processPlaneRetestReadinessInbox({
        config: readinessConfig,
        adapter: createAdapter(getWorkItem),
      }),
    ).resolves.toEqual(expect.objectContaining({manualAttention: 1}))

    expect(getWorkItem).not.toHaveBeenCalled()
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationInboxId: 103,
        outcome: 'manual_attention',
      }),
    )
  })

  it('uses the configured readiness batch size when no explicit limit is supplied', async () => {
    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
          PLANE_RETEST_READINESS_BATCH_SIZE: '2',
        },
        leaseMs: 70_100,
      }),
    ).rejects.toThrow(
      'Plane readiness lease must exceed serial API limiter and timeout budget plus safety margin',
    )
  })

  it('fails closed for every observed state except the configured Done state', async () => {
    const trx = {
      select: jest.fn(() => createQuery([])),
      update: jest.fn(),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'other-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('no_op')
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it.each(['intake_open', 'work_item_open'] as const)(
    'atomically applies readiness from a %s cycle and queues one unread notification',
    async (cycleState) => {
      const selectResults: QueryResult[] = [
        [
          {
            defectCycleId: 73,
            testRunMapId: 17,
            runId: 7,
            testId: 11,
            projectId: 5,
            openingRevisionId: 40,
            state: cycleState,
            currentEvidenceRevisionId: 41,
            readinessGeneration: 2,
          },
        ],
        [
          {
            testRunMapId: 17,
            runId: 7,
            testId: 11,
            projectId: 5,
            isIncluded: true,
            currentResultRevisionId: 41,
            runStatus: 'Active',
          },
        ],
        [
          {
            resultRevisionId: 41,
            testRunMapId: 17,
            runId: 7,
            testId: 11,
            projectId: 5,
          },
        ],
        [{userId: 23}],
        [],
      ]
      const updatedValues: unknown[] = []
      const notificationValues: unknown[] = []
      const updateWhere = jest.fn(async () => [{affectedRows: 1}])
      const update = jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          updatedValues.push(values)
          return {where: updateWhere}
        }),
      }))
      const insert = jest.fn(() => ({
        values: jest.fn(async (values: unknown) => {
          notificationValues.push(values)
          return [{insertId: 91}]
        }),
      }))
      const trx = {
        select: jest.fn(() => createQuery(selectResults.shift() ?? [])),
        update,
        insert,
      }
      transaction.mockImplementation(async (callback) => callback(trx))
      const now = new Date('2026-08-20T00:00:00.000Z')

      await expect(
        applyPlaneRetestReadiness({
          workItemId: 'work-item-id',
          stateId: 'done-state-id',
          config: readinessConfig,
          now,
        }),
      ).resolves.toBe('applied')

      expect(updatedValues).toEqual([
        expect.objectContaining({
          state: 'ready_for_retest',
          readinessGeneration: 3,
          providerStateId: 'done-state-id',
          lastProviderObservedOn: now,
        }),
      ])
      expect(notificationValues).toEqual([
        expect.objectContaining({
          notificationKey: 'plane-retest-ready:user:23:73:3',
          defectCycleId: 73,
          resultRevisionId: 41,
          recipientKey: 'user:23',
          channel: 'checkmate_retest_ready',
          deliveryState: 'delivered',
          deliveredOn: now,
          payload: expect.objectContaining({
            testRunMapId: 17,
            deepLink: {projectId: 5, runId: 7, testId: 11},
          }),
        }),
      ])
    },
  )

  it('does not apply after a human Pass validated the cycle', async () => {
    const trx = {
      select: jest.fn(() =>
        createQuery([
          {
            defectCycleId: 73,
            state: 'validated',
          },
        ]),
      ),
      update: jest.fn(),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'done-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('no_op')
    expect(trx.update).not.toHaveBeenCalled()
    expect(trx.insert).not.toHaveBeenCalled()
  })

  it('withdraws readiness and invalidates its notification even after acknowledgement', async () => {
    const selectResults: QueryResult[] = [
      [
        {
          defectCycleId: 73,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          openingRevisionId: 40,
          state: 'ready_for_retest',
          currentEvidenceRevisionId: 41,
          readinessGeneration: 3,
          reopenState: null,
          reopenRevisionId: null,
        },
      ],
      [
        {
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          isIncluded: true,
          currentResultRevisionId: 41,
          runStatus: 'Active',
        },
      ],
      [
        {
          resultRevisionId: 41,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
        },
      ],
    ]
    const updatedValues: unknown[] = []
    const updateWhere = jest.fn(async () => [{affectedRows: 1}])
    const trx = {
      select: jest.fn(() => createQuery(selectResults.shift() ?? [])),
      update: jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          updatedValues.push(values)
          return {where: updateWhere}
        }),
      })),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    const now = new Date('2026-08-20T01:00:00.000Z')

    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'todo-state-id',
        config: readinessConfig,
        now,
      }),
    ).resolves.toBe('applied')

    expect(updatedValues).toEqual([
      {
        state: 'work_item_open',
        providerStateId: 'todo-state-id',
        lastProviderObservedOn: now,
      },
      {invalidatedOn: now},
    ])
  })

  it('records authoritative non-Done observation before accepting another readiness generation', async () => {
    const selectResults: QueryResult[] = [
      [
        {
          defectCycleId: 73,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          openingRevisionId: 40,
          state: 'work_item_open',
          currentEvidenceRevisionId: 41,
          readinessGeneration: 3,
          reopenState: 'delivered',
          reopenRevisionId: 41,
        },
      ],
      [
        {
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          isIncluded: true,
          currentResultRevisionId: 41,
          runStatus: 'Active',
        },
      ],
      [
        {
          resultRevisionId: 41,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
        },
      ],
    ]
    const updatedValues: unknown[] = []
    const updateWhere = jest.fn(async () => [{affectedRows: 1}])
    const trx = {
      select: jest.fn(() => createQuery(selectResults.shift() ?? [])),
      update: jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          updatedValues.push(values)
          return {where: updateWhere}
        }),
      })),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'todo-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('applied')
    expect(updatedValues).toEqual([
      expect.objectContaining({
        reopenState: 'observed',
        providerStateId: 'todo-state-id',
      }),
    ])
  })

  it('surfaces manual attention when no active recipient can be resolved', async () => {
    const selectResults: QueryResult[] = [
      [
        {
          defectCycleId: 73,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          openingRevisionId: 40,
          state: 'work_item_open',
          currentEvidenceRevisionId: 41,
          readinessGeneration: 2,
        },
      ],
      [
        {
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          isIncluded: true,
          currentResultRevisionId: 41,
          runStatus: 'Active',
        },
      ],
      [
        {
          resultRevisionId: 41,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
        },
      ],
      [],
      [],
      [],
    ]
    const trx = {
      select: jest.fn(() => createQuery(selectResults.shift() ?? [])),
      update: jest.fn(),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'done-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('manual_attention')
    expect(trx.update).not.toHaveBeenCalled()
    expect(trx.insert).not.toHaveBeenCalled()
  })

  it('falls back from an inactive opener to the active evidence author', async () => {
    const selectResults: QueryResult[] = [
      [
        {
          defectCycleId: 73,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          openingRevisionId: 40,
          state: 'work_item_open',
          currentEvidenceRevisionId: 41,
          readinessGeneration: 2,
        },
      ],
      [
        {
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
          isIncluded: true,
          currentResultRevisionId: 41,
          runStatus: 'Active',
        },
      ],
      [
        {
          resultRevisionId: 41,
          testRunMapId: 17,
          runId: 7,
          testId: 11,
          projectId: 5,
        },
      ],
      [],
      [{userId: 24}],
      [],
    ]
    const notificationValues: unknown[] = []
    const trx = {
      select: jest.fn(() => createQuery(selectResults.shift() ?? [])),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(async () => [{affectedRows: 1}]),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(async (value: unknown) => {
          notificationValues.push(value)
          return [{insertId: 95}]
        }),
      })),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'done-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('applied')
    expect(notificationValues).toEqual([
      expect.objectContaining({recipientKey: 'user:24'}),
    ])
  })

  it('hashes the authoritative poll identity into a bounded delivery key', () => {
    const first = planePollDeliveryId({
      defectCycleId: 73,
      readinessGeneration: 3,
      workItemId: 'work-item-id'.repeat(30),
      stateId: 'done-state-id'.repeat(30),
      versionMarker: 'version-a'.repeat(30),
    })
    const second = planePollDeliveryId({
      defectCycleId: 73,
      readinessGeneration: 3,
      workItemId: 'work-item-id'.repeat(30),
      stateId: 'done-state-id'.repeat(30),
      versionMarker: 'version-b'.repeat(30),
    })

    expect(first).toMatch(/^plane-poll:[a-f0-9]{64}$/)
    expect(first.length).toBeLessThanOrEqual(128)
    expect(second).not.toBe(first)
  })

  it('claims only readiness events and re-fetches authoritative state before applying', async () => {
    transaction.mockImplementation(async (callback) =>
      callback({
        select: jest.fn(() => createQuery([])),
        update: jest.fn(),
        insert: jest.fn(),
      }),
    )
    mockClaimIntegrationInboxEvents
      .mockResolvedValueOnce([
        {
          integrationInboxId: 93,
          provider: 'plane',
          providerDeliveryId: 'delivery-93',
          eventType: 'plane.work_item.authoritative_state',
          payload: {
            workItemId: 'work-item-id',
            stateId: 'done-state-id',
            providerWorkspaceId: readinessConfig.workspaceId,
            providerProjectId: readinessConfig.projectId,
          },
          attemptCount: 1,
          leaseToken: 'lease-93',
          leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
    mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)
    const getWorkItem = jest.fn(async () => ({
      workItemId: 'work-item-id',
      stateId: 'not-done-anymore',
      versionMarker: '2026-08-20T00:00:01.000Z',
      raw: {},
    }))

    await expect(
      processPlaneRetestReadinessInbox({
        config: readinessConfig,
        adapter: createAdapter(getWorkItem),
      }),
    ).resolves.toEqual(
      expect.objectContaining({applied: 0, noOp: 1, retryDue: 0}),
    )
    expect(mockClaimIntegrationInboxEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'plane',
        eventType: 'plane.work_item.authoritative_state',
      }),
    )
    expect(getWorkItem).toHaveBeenCalledWith('work-item-id')
    expect(mockReconcilePlaneRetestReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'work-item-id',
        authoritativeStateId: 'not-done-anymore',
        readinessOutcome: 'no_op',
      }),
    )
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({integrationInboxId: 93, outcome: 'no_op'}),
    )
  })

  it('leases each inbox event through the rate-limit wait and request timeout', async () => {
    jest.useFakeTimers()
    try {
      transaction.mockImplementation(async (callback) =>
        callback({
          select: jest.fn(() => createQuery([])),
          update: jest.fn(),
          insert: jest.fn(),
        }),
      )
      const startedOn = new Date('2026-08-20T00:00:00.000Z')
      jest.setSystemTime(startedOn)
      const leaseMs = planeRetestReadinessInboxLeaseMs(readinessConfig)
      let leaseExpiresOn: Date | undefined
      mockClaimIntegrationInboxEvents
        .mockImplementationOnce(
          async ({leaseMs: claimedLeaseMs, now: claimedOn}: {
            leaseMs: number
            now: Date
          }) => {
            expect(claimedLeaseMs).toBe(leaseMs)
            leaseExpiresOn = new Date(claimedOn.getTime() + claimedLeaseMs)
            return [
              {
                integrationInboxId: 95,
                provider: 'plane',
                providerDeliveryId: 'delivery-95',
                eventType: 'plane.work_item.authoritative_state',
                payload: {
                  workItemId: 'work-item-id',
                  stateId: 'done-state-id',
                  providerWorkspaceId: readinessConfig.workspaceId,
                  providerProjectId: readinessConfig.projectId,
                },
                attemptCount: 1,
                leaseToken: 'lease-95',
                leaseExpiresOn,
              },
            ]
          },
        )
        .mockResolvedValueOnce([])
      mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)
      const getWorkItem = jest.fn(async () => {
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            readinessConfig.maxRequestWaitMs + readinessConfig.apiTimeoutMs,
          ),
        )
        return {
          workItemId: 'work-item-id',
          stateId: 'not-done-anymore',
          versionMarker: '2026-08-20T00:00:01.000Z',
          raw: {},
        }
      })

      const processing = processPlaneRetestReadinessInbox({
        config: readinessConfig,
        adapter: createAdapter(getWorkItem),
      })
      await jest.advanceTimersByTimeAsync(
        readinessConfig.maxRequestWaitMs + readinessConfig.apiTimeoutMs,
      )
      await processing

      expect(getWorkItem).toHaveBeenCalledTimes(1)
      expect(leaseExpiresOn).toBeDefined()
      expect(leaseExpiresOn!.getTime() - Date.now()).toBe(10_000)
      expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({integrationInboxId: 95, outcome: 'no_op'}),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('routes permanent Plane reads to manual attention', async () => {
    mockClaimIntegrationInboxEvents
      .mockResolvedValueOnce([
        {
          integrationInboxId: 94,
          provider: 'plane',
          providerDeliveryId: 'delivery-94',
          eventType: 'plane.work_item.authoritative_state',
          payload: {
            workItemId: 'work-item-id',
            stateId: 'done-state-id',
            providerWorkspaceId: readinessConfig.workspaceId,
            providerProjectId: readinessConfig.projectId,
          },
          attemptCount: 1,
          leaseToken: 'lease-94',
          leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
    mockFinalizeIntegrationInboxEvent.mockResolvedValue(true)
    const adapter = createAdapter(async () => {
      throw new PlaneAdapterError('work item was rejected', 'manual_attention')
    })

    await expect(
      processPlaneRetestReadinessInbox({config: readinessConfig, adapter}),
    ).resolves.toEqual(
      expect.objectContaining({manualAttention: 1, retryDue: 0}),
    )
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationInboxId: 94,
        outcome: 'manual_attention',
      }),
    )
  })

  it('rejects a cursor lease shorter than serial Plane requests plus safety', async () => {
    await expect(
      runConfiguredPlaneRetestReadinessBatch({
        environment: {
          PLANE_RETEST_READINESS_ENABLED: 'true',
          PLANE_RETEST_READINESS_WORKER_ENABLED: 'true',
          PLANE_RETEST_NOTIFICATION_ENABLED: 'true',
          RESULT_REVISION_COMMANDS_ENABLED: 'true',
          PLANE_RETEST_READINESS_DONE_STATE_ID: 'done-state-id',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_TIMEOUT_MS: '100',
        },
        limit: 2,
        leaseMs: 10_000,
      }),
    ).rejects.toThrow('serial API limiter and timeout budget plus safety margin')
  })
})
