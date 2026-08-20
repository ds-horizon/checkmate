const transaction = jest.fn()
const directUpdate = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {
    transaction,
    update: directUpdate,
  },
}))

import type {PlaneDefectIntent} from '@schema/resultRevisions'
import type {ClaimedResultOutboxEvent} from '../resultOutbox'
import {
  createPlaneResultDeliveryAdapter,
  planeDefectCycleStore,
  PlaneDefectCycleStore,
} from '../planeDefectDelivery'
import {
  PlaneAdapter,
  PlaneAdapterConfig,
  PlaneAdapterError,
} from '../planeAdapter'

const config: PlaneAdapterConfig = {
  baseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'secret-api-key',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  workspaceSlug: 'infinimind',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
  timeoutMs: 10_000,
}

const intent: PlaneDefectIntent = {
  create: true,
  defectCycleId: 73,
  correlationKey: 'checkmate:9c3dcc99-60b3-4cbd-b9f6-40f87b538328',
  title: 'Failed Checkmate step',
  description: 'Evidence',
  priority: 'high',
  attachmentKeys: [],
}

const event: ClaimedResultOutboxEvent = {
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
    actorType: 'human',
    sourceSystem: 'checkmate',
    planeDefectIntent: intent,
  },
  attemptCount: 1,
  leaseToken: 'lease-one',
  leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
}

const createCycleStore = (): jest.Mocked<PlaneDefectCycleStore> => ({
  reserve: jest.fn<
    ReturnType<PlaneDefectCycleStore['reserve']>,
    Parameters<PlaneDefectCycleStore['reserve']>
  >(async () => ({outcome: 'reserved'})),
  complete: jest.fn<
    ReturnType<PlaneDefectCycleStore['complete']>,
    Parameters<PlaneDefectCycleStore['complete']>
  >(async () => true),
  releaseRetry: jest.fn<
    ReturnType<PlaneDefectCycleStore['releaseRetry']>,
    Parameters<PlaneDefectCycleStore['releaseRetry']>
  >(async () => true),
})

const createAdapter = (): jest.Mocked<PlaneAdapter> => ({
  createIntake: jest.fn<
    ReturnType<PlaneAdapter['createIntake']>,
    Parameters<PlaneAdapter['createIntake']>
  >(async () => ({
    intakeId: 'intake-id',
    workItemId: 'work-item-id',
    sequenceId: 38,
    projectIdentifier: 'BIZ',
    raw: {},
  })),
})

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

describe('Plane defect cycle persistence', () => {
  beforeEach(() => {
    transaction.mockReset()
    directUpdate.mockReset()
  })

  it('fences a matching pending cycle before the provider call', async () => {
    const updateQuery = createUpdateQuery()
    const trx = {
      select: jest.fn(() =>
        createSelectQuery([
          {
            state: 'intake_pending',
            provider: 'plane',
            providerWorkspaceId: config.workspaceId,
            providerProjectId: config.projectId,
            providerWorkItemId: null,
            createCorrelationKey: intent.correlationKey,
          },
        ]),
      ),
      update: jest.fn(() => updateQuery),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      planeDefectCycleStore.reserve(intent, config),
    ).resolves.toEqual({outcome: 'reserved'})
    expect(updateQuery.set).toHaveBeenCalledWith({state: 'manual_attention'})
  })

  it('rejects a cycle whose server destination does not match', async () => {
    const trx = {
      select: jest.fn(() =>
        createSelectQuery([
          {
            state: 'intake_pending',
            provider: 'plane',
            providerWorkspaceId: 'other-workspace',
            providerProjectId: config.projectId,
            providerWorkItemId: null,
            createCorrelationKey: intent.correlationKey,
          },
        ]),
      ),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      planeDefectCycleStore.reserve(intent, config),
    ).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'Plane defect cycle destination or correlation did not match',
    })
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('persists authoritative provider identity only for the reserved cycle', async () => {
    const updateQuery = createUpdateQuery()
    directUpdate.mockReturnValue(updateQuery)
    const observedOn = new Date('2026-08-20T00:00:30.000Z')

    await expect(
      planeDefectCycleStore.complete(
        intent,
        config,
        {
          intakeId: 'intake-id',
          workItemId: 'work-item-id',
          sequenceId: 38,
          projectIdentifier: 'BIZ',
          raw: {},
        },
        observedOn,
      ),
    ).resolves.toBe(true)
    expect(updateQuery.set).toHaveBeenCalledWith({
      state: 'intake_open',
      providerIntakeId: 'intake-id',
      providerWorkItemId: 'work-item-id',
      providerSequenceId: 38,
      providerUrl:
        'https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-38/',
      lastProviderObservedOn: observedOn,
    })
  })
})

describe('Plane defect delivery adapter', () => {
  it('reserves, creates, and durably correlates an intake', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    const observedOn = new Date('2026-08-20T00:00:30.000Z')
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
      clock: () => observedOn,
    })

    await expect(adapter.deliverResultRevision(event)).resolves.toEqual({
      outcome: 'delivered',
    })
    expect(cycleStore.reserve).toHaveBeenCalledWith(intent, config)
    expect(planeAdapter.createIntake).toHaveBeenCalledWith({
      title: intent.title,
      description: intent.description,
      priority: intent.priority,
    })
    expect(cycleStore.complete).toHaveBeenCalledWith(
      intent,
      config,
      expect.objectContaining({intakeId: 'intake-id'}),
      observedOn,
    )
  })

  it('does not call Plane when durable state already records delivery', async () => {
    const cycleStore = createCycleStore()
    cycleStore.reserve.mockResolvedValue({outcome: 'delivered'})
    const planeAdapter = createAdapter()
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
    })

    await expect(adapter.deliverResultRevision(event)).resolves.toEqual({
      outcome: 'delivered',
    })
    expect(planeAdapter.createIntake).not.toHaveBeenCalled()
    expect(cycleStore.complete).not.toHaveBeenCalled()
  })

  it('releases a known rate-limit failure before scheduling a retry', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    planeAdapter.createIntake.mockRejectedValue(
      new PlaneAdapterError('rate limited', 'retryable', 2500),
    )
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
    })

    await expect(adapter.deliverResultRevision(event)).resolves.toEqual({
      outcome: 'retry_due',
      reason: 'rate limited',
      retryAfterMs: 2500,
    })
    expect(cycleStore.releaseRetry).toHaveBeenCalledWith(intent)
    expect(cycleStore.complete).not.toHaveBeenCalled()
  })

  it('fails closed after an ambiguous create outcome', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    planeAdapter.createIntake.mockRejectedValue(
      new PlaneAdapterError('create outcome unknown', 'ambiguous_create'),
    )
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
    })

    await expect(adapter.deliverResultRevision(event)).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'create outcome unknown',
    })
    expect(cycleStore.releaseRetry).not.toHaveBeenCalled()
  })

  it('requires manual attention when provider identity cannot be persisted', async () => {
    const cycleStore = createCycleStore()
    cycleStore.complete.mockResolvedValue(false)
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter: createAdapter(),
      cycleStore,
    })

    await expect(adapter.deliverResultRevision(event)).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'Plane intake was created but durable cycle correlation failed',
    })
  })
})
