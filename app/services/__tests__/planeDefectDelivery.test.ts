const transaction = jest.fn()
const directUpdate = jest.fn()
const directSelect = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {
    transaction,
    update: directUpdate,
    select: directSelect,
  },
}))

import type {
  PlaneDefectIntent,
  PlaneEvidenceIntent,
} from '@schema/resultRevisions'
import type {ClaimedResultOutboxEvent} from '../resultOutbox'
import {
  createPlaneResultDeliveryAdapter,
  planeDefectCycleStore,
  PlaneDefectCycleStore,
  runConfiguredPlaneDeliveryBatch,
} from '../planeDefectDelivery'
import {runPlaneDeliveryBatch} from '../planeDeliveryWorker'
import {
  PlaneAdapter,
  PlaneAdapterConfig,
  PlaneAdapterError,
} from '../planeAdapter'
import type {PlaneEvidenceDeliveryStore} from '../planeEvidenceDelivery'

const config: PlaneAdapterConfig = {
  baseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'secret-api-key',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  workspaceSlug: 'infinimind',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
  timeoutMs: 10_000,
  maxRequestsPerMinute: 12,
  maxRequestWaitMs: 60_000,
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

const evidenceIntent: PlaneEvidenceIntent = {
  planeEvidenceDeliveryId: 74,
  defectCycleId: 73,
  resultRevisionId: 41,
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
  resolveLinkedWorkItem: jest.fn<
    ReturnType<PlaneDefectCycleStore['resolveLinkedWorkItem']>,
    Parameters<PlaneDefectCycleStore['resolveLinkedWorkItem']>
  >(async () => ({outcome: 'linked', workItemId: 'work-item-id'})),
  reserveCycleAction: jest.fn<
    ReturnType<PlaneDefectCycleStore['reserveCycleAction']>,
    Parameters<PlaneDefectCycleStore['reserveCycleAction']>
  >(async () => ({outcome: 'reserved'})),
  completeCycleAction: jest.fn<
    ReturnType<PlaneDefectCycleStore['completeCycleAction']>,
    Parameters<PlaneDefectCycleStore['completeCycleAction']>
  >(async () => true),
  markCycleActionManualAttention: jest.fn<
    ReturnType<PlaneDefectCycleStore['markCycleActionManualAttention']>,
    Parameters<PlaneDefectCycleStore['markCycleActionManualAttention']>
  >(async () => undefined),
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
  getWorkItem: jest.fn<
    ReturnType<PlaneAdapter['getWorkItem']>,
    Parameters<PlaneAdapter['getWorkItem']>
  >(async (workItemId) => ({
    workItemId,
    stateId: 'state-id',
    versionMarker: null,
    raw: {},
  })),
  ensureComment: jest.fn<
    ReturnType<PlaneAdapter['ensureComment']>,
    Parameters<PlaneAdapter['ensureComment']>
  >(async () => ({commentId: 'comment-id'})),
  ensureAttachment: jest.fn<
    ReturnType<PlaneAdapter['ensureAttachment']>,
    Parameters<PlaneAdapter['ensureAttachment']>
  >(async () => ({assetId: 'asset-id', attachmentId: 'attachment-id'})),
  ensureWorkItemState: jest.fn<
    ReturnType<PlaneAdapter['ensureWorkItemState']>,
    Parameters<PlaneAdapter['ensureWorkItemState']>
  >(async ({workItemId, stateId}) => ({
    workItemId,
    stateId,
    versionMarker: null,
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
    directSelect.mockReset()
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

  it('resolves evidence only to the durably linked work item', async () => {
    directSelect.mockReturnValue(
      createSelectQuery([
        {
          provider: 'plane',
          providerWorkspaceId: config.workspaceId,
          providerProjectId: config.projectId,
          providerWorkItemId: 'work-item-id',
          state: 'intake_open',
        },
      ]),
    )

    await expect(
      planeDefectCycleStore.resolveLinkedWorkItem(evidenceIntent, config),
    ).resolves.toEqual({outcome: 'linked', workItemId: 'work-item-id'})
  })

  it('keeps evidence pending until its defect has a durable work-item link', async () => {
    directSelect.mockReturnValue(
      createSelectQuery([
        {
          provider: 'plane',
          providerWorkspaceId: config.workspaceId,
          providerProjectId: config.projectId,
          providerWorkItemId: null,
          state: 'intake_pending',
        },
      ]),
    )

    await expect(
      planeDefectCycleStore.resolveLinkedWorkItem(evidenceIntent, config),
    ).resolves.toEqual({
      outcome: 'retry_due',
      reason: 'Plane evidence is waiting for the defect work item',
      retryAfterMs: 5_000,
    })
  })

  it('reserves an informational validation notice only for the validated linked cycle', async () => {
    directSelect.mockReturnValue(
      createSelectQuery([
        {
          state: 'validated',
          provider: 'plane',
          providerWorkspaceId: config.workspaceId,
          providerProjectId: config.projectId,
          providerWorkItemId: 'work-item-id',
          reopenState: null,
          reopenRevisionId: null,
        },
      ]),
    )

    await expect(
      planeDefectCycleStore.reserveCycleAction(
        {
          action: 'validated_pass',
          defectCycleId: 73,
          resultRevisionId: 42,
          workItemId: 'work-item-id',
          marker: '<!-- checkmate-cycle-action:validated_pass:73:42 -->',
          commentHtml: '<p>Validated.</p>',
        },
        config,
      ),
    ).resolves.toEqual({outcome: 'reserved'})
  })
})

describe('Plane defect delivery adapter', () => {
  it('rejects an invalid configured delivery lease before claiming work', async () => {
    await expect(
      runConfiguredPlaneDeliveryBatch({
        environment: {
          PLANE_DELIVERY_WORKER_ENABLED: 'true',
          PLANE_API_WRITES_ENABLED: 'true',
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'secret-api-key',
          PLANE_DELIVERY_LEASE_MS: 'invalid',
        },
      }),
    ).rejects.toThrow('PLANE_DELIVERY_LEASE_MS must be a positive integer')
  })

  it('rejects a 60-second lease when six 12-second evidence operations are possible', async () => {
    const adapter = createPlaneResultDeliveryAdapter({
      config: {...config, timeoutMs: 12_000},
      planeAdapter: createAdapter(),
      cycleStore: createCycleStore(),
    })

    expect(adapter.maxDeliveryMs).toBe(432_000)
    await expect(
      runPlaneDeliveryBatch({
        adapter,
        environment: {
          PLANE_DELIVERY_WORKER_ENABLED: 'true',
          PLANE_API_WRITES_ENABLED: 'true',
        },
        leaseMs: 60_000,
      }),
    ).rejects.toThrow('lease must exceed')
  })

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

  it('comments and moves a same-issue retest through the configured reopen state', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    const actionIntent = {
      action: 'same_issue_reopen' as const,
      defectCycleId: 73,
      resultRevisionId: 41,
      workItemId: 'work-item-id',
      marker: '<!-- checkmate-cycle-action:same_issue_reopen:73:41 -->',
      commentHtml: '<p>Retest failed for the same issue.</p>',
    }
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
      reopenStateId: 'todo-state-id',
    })

    await expect(
      adapter.deliverResultRevision({
        ...event,
        eventType: 'plane_cycle_action_requested',
        payload: {...event.payload, planeCycleActionIntent: actionIntent},
      }),
    ).resolves.toEqual({outcome: 'delivered'})

    expect(cycleStore.reserveCycleAction).toHaveBeenCalledWith(
      actionIntent,
      config,
    )
    expect(planeAdapter.ensureComment).toHaveBeenCalledWith({
      workItemId: 'work-item-id',
      marker: actionIntent.marker,
      commentHtml: actionIntent.commentHtml,
    })
    expect(planeAdapter.ensureWorkItemState).toHaveBeenCalledWith({
      workItemId: 'work-item-id',
      stateId: 'todo-state-id',
    })
    expect(cycleStore.completeCycleAction).toHaveBeenCalledWith(actionIntent)
  })

  it('comments on a human validation without changing Plane workflow state', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    const actionIntent = {
      action: 'validated_pass' as const,
      defectCycleId: 73,
      resultRevisionId: 42,
      workItemId: 'work-item-id',
      marker: '<!-- checkmate-cycle-action:validated_pass:73:42 -->',
      commentHtml: '<p>Checkmate validated this defect.</p>',
    }
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
      reopenStateId: 'todo-state-id',
    })

    await expect(
      adapter.deliverResultRevision({
        ...event,
        eventType: 'plane_cycle_action_requested',
        payload: {...event.payload, planeCycleActionIntent: actionIntent},
      }),
    ).resolves.toEqual({outcome: 'delivered'})

    expect(planeAdapter.ensureComment).toHaveBeenCalledWith({
      workItemId: 'work-item-id',
      marker: actionIntent.marker,
      commentHtml: actionIntent.commentHtml,
    })
    expect(planeAdapter.ensureWorkItemState).not.toHaveBeenCalled()
    expect(cycleStore.completeCycleAction).toHaveBeenCalledWith(actionIntent)
  })

  it('fails closed when same-issue reopen state is not configured', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    const actionIntent = {
      action: 'same_issue_reopen' as const,
      defectCycleId: 73,
      resultRevisionId: 41,
      workItemId: 'work-item-id',
      marker: '<!-- checkmate-cycle-action:same_issue_reopen:73:41 -->',
      commentHtml: '<p>Retest failed for the same issue.</p>',
    }
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
    })

    await expect(
      adapter.deliverResultRevision({
        ...event,
        eventType: 'plane_cycle_action_requested',
        payload: {...event.payload, planeCycleActionIntent: actionIntent},
      }),
    ).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'Plane reopen state is not configured',
    })
    expect(cycleStore.markCycleActionManualAttention).toHaveBeenCalledWith(
      actionIntent,
    )
    expect(planeAdapter.ensureWorkItemState).not.toHaveBeenCalled()
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

  it('keeps evidence retryable while the dedicated copy flag is disabled', async () => {
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter: createAdapter(),
      cycleStore: createCycleStore(),
    })

    await expect(
      adapter.deliverResultRevision({
        ...event,
        eventType: 'plane_evidence_delivery_requested',
        payload: {...event.payload, planeEvidenceIntent: evidenceIntent},
      }),
    ).resolves.toEqual({
      outcome: 'retry_due',
      reason: 'Plane evidence copy is disabled',
      retryAfterMs: 60 * 60 * 1000,
    })
  })

  it('delivers evidence only after resolving the durable work-item link', async () => {
    const cycleStore = createCycleStore()
    const planeAdapter = createAdapter()
    const evidenceStore: jest.Mocked<PlaneEvidenceDeliveryStore> = {
      reserve: jest.fn<
        ReturnType<PlaneEvidenceDeliveryStore['reserve']>,
        Parameters<PlaneEvidenceDeliveryStore['reserve']>
      >(async () => ({
        outcome: 'reserved',
        delivery: {
          sourceKind: 'note',
          sourceIdentity: 'result-revision:41:note',
          sourceText: 'Checkout fails',
          sourceObjectKey: null,
          sourceSha256:
            'e7c088d43aba7aaf61c464b5c2ae83aa48d1eaf78a0ff0b5345a8a955e57784b',
          sourceContentType: 'text/plain; charset=utf-8',
          sourceByteSize: 14,
          providerResourceName: 'Checkmate result revision 1',
        },
      })),
      complete: jest.fn<
        ReturnType<PlaneEvidenceDeliveryStore['complete']>,
        Parameters<PlaneEvidenceDeliveryStore['complete']>
      >(async () => true),
      fail: jest.fn<
        ReturnType<PlaneEvidenceDeliveryStore['fail']>,
        Parameters<PlaneEvidenceDeliveryStore['fail']>
      >(async () => true),
    }
    const adapter = createPlaneResultDeliveryAdapter({
      config,
      planeAdapter,
      cycleStore,
      evidenceCopyEnabled: true,
      evidenceStore,
    })

    await expect(
      adapter.deliverResultRevision({
        ...event,
        eventType: 'plane_evidence_delivery_requested',
        payload: {...event.payload, planeEvidenceIntent: evidenceIntent},
      }),
    ).resolves.toEqual({outcome: 'delivered'})
    expect(cycleStore.resolveLinkedWorkItem).toHaveBeenCalledWith(
      evidenceIntent,
      config,
    )
    expect(planeAdapter.ensureComment).toHaveBeenCalledWith(
      expect.objectContaining({workItemId: 'work-item-id'}),
    )
  })
})
