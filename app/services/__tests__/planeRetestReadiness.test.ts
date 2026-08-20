const transaction = jest.fn()
const mockClaimIntegrationInboxEvents = jest.fn()
const mockFinalizeIntegrationInboxEvent = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {transaction, select: jest.fn()},
}))

jest.mock('../integrationInbox', () => ({
  claimIntegrationInboxEvents: mockClaimIntegrationInboxEvents,
  claimIntegrationPollCursor: jest.fn(),
  finalizeIntegrationInboxEvent: mockFinalizeIntegrationInboxEvent,
  finalizeIntegrationPollCursor: jest.fn(),
  recordVerifiedIntegrationEvent: jest.fn(),
}))

import {
  applyPlaneRetestReadiness,
  planePollDeliveryId,
  processPlaneRetestReadinessInbox,
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
    limit: jest.fn(),
    for: jest.fn(),
    then: (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(resolve),
  }
  query.from.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.for.mockReturnValue(query)
  return query
}

const readinessConfig = {
  doneStateId: 'done-state-id',
  workspaceId: 'workspace-id',
  projectId: 'project-id',
  apiTimeoutMs: 100,
  destinationKey: 'plane:workspace-id:project-id',
}

const createAdapter = (getWorkItem: PlaneAdapter['getWorkItem']): PlaneAdapter => ({
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
})

describe('Plane retest readiness', () => {
  beforeEach(() => {
    transaction.mockReset()
    mockClaimIntegrationInboxEvents.mockReset()
    mockFinalizeIntegrationInboxEvent.mockReset()
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
        destinationKey:
          'plane:e36dfd86-953a-4e33-a410-856208893bb9:67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
      }),
    )
  })

  it('fails closed for every observed state except the configured Done state', async () => {
    await expect(
      applyPlaneRetestReadiness({
        workItemId: 'work-item-id',
        stateId: 'other-state-id',
        config: readinessConfig,
      }),
    ).resolves.toBe('no_op')
    expect(transaction).not.toHaveBeenCalled()
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
    mockClaimIntegrationInboxEvents
      .mockResolvedValueOnce([
        {
          integrationInboxId: 93,
          provider: 'plane',
          providerDeliveryId: 'delivery-93',
          eventType: 'plane.work_item.authoritative_state',
          payload: {workItemId: 'work-item-id', stateId: 'done-state-id'},
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
    expect(mockFinalizeIntegrationInboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({integrationInboxId: 93, outcome: 'no_op'}),
    )
  })

  it('routes permanent Plane reads to manual attention', async () => {
    mockClaimIntegrationInboxEvents
      .mockResolvedValueOnce([
        {
          integrationInboxId: 94,
          provider: 'plane',
          providerDeliveryId: 'delivery-94',
          eventType: 'plane.work_item.authoritative_state',
          payload: {workItemId: 'work-item-id', stateId: 'done-state-id'},
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
    ).resolves.toEqual(expect.objectContaining({manualAttention: 1, retryDue: 0}))
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
    ).rejects.toThrow('serial API timeout plus safety margin')
  })
})
