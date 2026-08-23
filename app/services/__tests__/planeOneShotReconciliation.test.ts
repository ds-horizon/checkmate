const transaction = jest.fn()
const select = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {select, transaction},
}))

import {createPlaneAdapter, PlaneAdapterError} from '../planeAdapter'
import type {PlaneAdapter, PlaneAdapterConfig, PlaneWorkItem} from '../planeAdapter'
import type {PlaneDefectIntent} from '@schema/resultRevisions'
import {
  arePlaneOneShotWorkerRolesDisabled,
  isPlaneOneShotReconciliationEnabled,
  isPlaneOneShotDeadlock,
  PLANE_CANARY_ONE_SHOT_FLAG,
  PLANE_ONE_SHOT_MAX_DEADLOCK_ATTEMPTS,
  PLANE_ONE_SHOT_FINALIZATION_FAILURE_MARKER,
  PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
  reconcilePlaneDefectOneShot,
  withPlaneOneShotDeadlockRetry,
  PlaneOneShotReconciliationInput,
} from '../planeOneShotReconciliation'

const config: PlaneAdapterConfig = {
  apiBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'secret-api-key',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  workspaceSlug: 'infinimind',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
  timeoutMs: 10_000,
  maxRequestsPerMinute: 6,
  maxRequestWaitMs: 60_000,
}

const input: PlaneOneShotReconciliationInput = {
  projectId: 7,
  runId: 8,
  testId: 9,
  expectedWorkItemId: 'work-item-41',
  expectedIntakeId: 'intake-41',
  expectedCorrelationKey: 'checkmate:correlation-41',
  expectedDestination: 'biz-development',
}

const intent: PlaneDefectIntent = {
  create: true,
  defectCycleId: 31,
  correlationKey: input.expectedCorrelationKey,
  title: 'Failed Checkmate test',
  description: 'Run 8 / test 9\nCorrelation: checkmate:correlation-41',
  priority: 'high',
  attachmentKeys: [],
}

const baseMap = () => ({
  testRunMapId: 21,
  projectId: input.projectId,
  testProjectId: input.projectId,
  runId: input.runId,
  testId: input.testId,
  isIncluded: true,
  currentResultRevisionId: 41,
  runProjectId: input.projectId,
  runStatus: 'Active',
})

const baseCycle = () => ({
  defectCycleId: intent.defectCycleId,
  testRunMapId: 21,
  projectId: input.projectId,
  runId: input.runId,
  testId: input.testId,
  activeMarker: 1,
  state: 'manual_attention',
  currentEvidenceRevisionId: 41,
  provider: 'plane',
  providerWorkspaceId: config.workspaceId,
  providerProjectId: config.projectId,
  providerWorkItemId: null,
  providerIntakeId: null,
  providerStateId: null,
  providerSequenceId: null,
  providerUrl: null,
  createCorrelationKey: input.expectedCorrelationKey,
})

const baseRevision = () => ({
  resultRevisionId: 41,
  testRunMapId: 21,
  projectId: input.projectId,
  runId: input.runId,
  testId: input.testId,
})

const baseOutbox = (overrides: Record<string, unknown> = {}) => ({
  resultOutboxId: 51,
  eventKey: 'defect-cycle:31:plane-create',
  eventType: 'plane_defect_create_requested',
  aggregateType: 'defect_cycle',
  aggregateId: intent.defectCycleId,
  resultRevisionId: 41,
  payload: {
    resultRevisionId: 41,
    testRunMapId: 21,
    projectId: input.projectId,
    runId: input.runId,
    testId: input.testId,
    defectCycleId: intent.defectCycleId,
    planeDefectIntent: intent,
  },
  deliveryState: 'manual_attention',
  availableOn: new Date('2026-08-22T00:00:00.000Z'),
  leaseToken: null,
  leaseExpiresOn: null,
  deliveredOn: null,
  ...overrides,
})

const legacyCycle = () => ({
  ...baseCycle(),
  state: 'intake_open',
  providerWorkItemId: input.expectedWorkItemId,
  providerIntakeId: input.expectedIntakeId,
  providerStateId: null,
})

const legacyOutbox = (overrides: Record<string, unknown> = {}) =>
  baseOutbox({
    deliveryState: 'delivered',
    deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
    lastError: null,
    ...overrides,
  })

const workItem = (overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem => ({
  workItemId: input.expectedWorkItemId,
  stateId: 'state-open',
  versionMarker: '2026-08-22T00:00:00.000Z',
  raw: {
    id: input.expectedWorkItemId,
    state: {id: 'state-open'},
    workspace_id: config.workspaceId,
    project_id: config.projectId,
    project_identifier: config.projectIdentifier,
    intake_id: input.expectedIntakeId,
    name: intent.title,
    description: intent.description,
    sequence_id: 41,
  },
  ...overrides,
})

const createSelectQuery = (
  rows: unknown[],
  resolveRows = () => rows,
  label = '',
) => {
  const query = {
    label,
    from: jest.fn(),
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    for: jest.fn(),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(resolveRows()).then(resolve),
  }
  query.from.mockReturnValue(query)
  query.leftJoin.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.orderBy.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.for.mockReturnValue(query)
  return query
}

let claimedLeaseToken: string | null = null

const createUpdateQuery = (affectedRows = 1) => {
  const where = jest.fn(async () => [{affectedRows}])
  const set = jest.fn((values: unknown) => {
    if (
      values &&
      typeof values === 'object' &&
      'leaseToken' in values &&
      typeof values.leaseToken === 'string'
    ) {
      claimedLeaseToken = values.leaseToken
    }
    return {where}
  })
  return {set, where}
}

const createTransaction = ({
  mapRows = [baseMap()],
  cycleRows = [baseCycle()],
  revisionRows = [baseRevision()],
  outboxRows = [baseOutbox()],
  updates = [createUpdateQuery()],
}: {
  mapRows?: unknown[]
  cycleRows?: unknown[]
  revisionRows?: unknown[]
  outboxRows?: unknown[]
  replayCycleRows?: unknown[]
  replayOutboxRows?: unknown[]
  updates?: ReturnType<typeof createUpdateQuery>[]
} = {}) => ({
  select: jest
    .fn()
    .mockReturnValueOnce(createSelectQuery(mapRows, () => mapRows, 'map'))
    .mockReturnValueOnce(createSelectQuery(cycleRows, () => cycleRows, 'cycle'))
    .mockReturnValueOnce(
      createSelectQuery(outboxRows, () => outboxRows, 'outbox'),
    )
    .mockReturnValueOnce(
      createSelectQuery(revisionRows, () => revisionRows, 'revision'),
    ),
  update: jest
    .fn()
    .mockImplementation(() => updates.shift() ?? createUpdateQuery()),
})

const createFinalizeTransaction = (
  cycleRows: unknown[] = [baseCycle()],
  updates: ReturnType<typeof createUpdateQuery>[] = [],
  outboxRows: unknown[] = [
    baseOutbox({deliveryState: 'leased', leaseToken: '__claim__'}),
  ],
) => ({
  select: jest
    .fn()
    .mockReturnValueOnce(
      createSelectQuery(
        outboxRows,
        () =>
          outboxRows.map((outbox) => ({
            ...(outbox as Record<string, unknown>),
            leaseToken:
              (outbox as {leaseToken?: string | null}).leaseToken ===
              '__claim__'
                ? claimedLeaseToken
                : (outbox as {leaseToken?: string | null}).leaseToken,
          })),
        'outbox',
      ),
    )
    .mockReturnValueOnce(
      createSelectQuery(cycleRows, () => cycleRows, 'cycle'),
    ),
  update: jest
    .fn()
    .mockImplementation(() => updates.shift() ?? createUpdateQuery()),
})

const createManualAttentionTransaction = (
  cycleRows: unknown[] = [baseCycle()],
  updates: ReturnType<typeof createUpdateQuery>[] = [],
) => ({
  select: jest
    .fn()
    .mockReturnValueOnce(
      createSelectQuery(
        [baseOutbox({deliveryState: 'leased', leaseToken: '__claim__'})],
        () => [
          baseOutbox({
            deliveryState: 'leased',
            leaseToken: claimedLeaseToken,
          }),
        ],
        'outbox',
      ),
    )
    .mockReturnValueOnce(
      createSelectQuery(cycleRows, () => cycleRows, 'cycle'),
    ),
  update: jest
    .fn()
    .mockImplementation(() => updates.shift() ?? createUpdateQuery()),
})

const createLegacyValidationTransaction = (
  cycle: unknown[] = [legacyCycle()],
  outbox: unknown[] = [legacyOutbox()],
) => ({
  select: jest
    .fn()
    .mockReturnValueOnce(createSelectQuery([baseMap()], () => [baseMap()], 'map'))
    .mockReturnValueOnce(createSelectQuery(cycle, () => cycle, 'cycle'))
    .mockReturnValueOnce(createSelectQuery(outbox, () => outbox, 'outbox'))
    .mockReturnValueOnce(
      createSelectQuery([baseRevision()], () => [baseRevision()], 'revision'),
    ),
  update: jest.fn(),
})

const createAdapter = (item: PlaneWorkItem = workItem()) => ({
  getWorkItem: jest.fn(async () => item),
  createIntake: jest.fn(),
})

let lastClaimTransaction: ReturnType<typeof createTransaction> | null = null

const setupResolution = (
  load: Parameters<typeof createTransaction>[0] = {},
) => {
  select.mockReturnValueOnce(createSelectQuery(load.replayCycleRows ?? []))
  if ((load.replayCycleRows ?? []).length > 0) {
    select.mockReturnValueOnce(createSelectQuery(load.replayOutboxRows ?? []))
  }
  select
    .mockReturnValueOnce(createSelectQuery(load.mapRows ?? [baseMap()]))
    .mockReturnValueOnce(
      createSelectQuery(
        (load.cycleRows ?? [baseCycle()]).map((cycle) => ({
          defectCycleId: (cycle as {defectCycleId: number}).defectCycleId,
        })),
      ),
    )
    .mockReturnValueOnce(
      createSelectQuery(
        (load.outboxRows ?? [baseOutbox()]).map((outbox) => ({
          resultOutboxId: (outbox as {resultOutboxId: number}).resultOutboxId,
        })),
      ),
    )
}

const run = async ({
  adapter = createAdapter(),
  load,
  finalize,
  manualAttention,
}: {
  adapter?: Pick<PlaneAdapter, 'getWorkItem'>
  load?: Parameters<typeof createTransaction>[0]
  finalize?: ReturnType<typeof createTransaction>
  manualAttention?: ReturnType<typeof createManualAttentionTransaction>
} = {}) => {
  select.mockReset()
  setupResolution(load)
  transaction.mockImplementationOnce(async (callback) => {
    lastClaimTransaction = createTransaction(load)
    return callback(lastClaimTransaction)
  })
  if (finalize) {
    transaction.mockImplementationOnce(async (callback) => callback(finalize))
  }
  if (manualAttention) {
    transaction.mockImplementationOnce(async (callback) =>
      callback(manualAttention),
    )
  }
  return reconcilePlaneDefectOneShot({
    input,
    config,
    planeAdapter: adapter,
    enabled: true,
    now: new Date('2026-08-22T00:01:00.000Z'),
  })
}

describe('Plane one-shot reconciliation', () => {
  beforeEach(() => {
    transaction.mockReset()
    select.mockReset()
    claimedLeaseToken = null
    lastClaimTransaction = null
  })

  it('is fail-closed unless the dedicated canary flag is exactly true', async () => {
    expect(isPlaneOneShotReconciliationEnabled({})).toBe(false)
    expect(
      isPlaneOneShotReconciliationEnabled({[PLANE_CANARY_ONE_SHOT_FLAG]: '1'}),
    ).toBe(false)
    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: createAdapter(),
        enabled: false,
      }),
    ).resolves.toMatchObject({outcome: 'refused'})
    expect(transaction).not.toHaveBeenCalled()
  })

  it('verify-only performs read-only preflight and exactly one provider GET', async () => {
    const fetchImplementation = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          id: input.expectedWorkItemId,
          state: {id: 'state-open'},
          workspace_id: config.workspaceId,
          project_id: config.projectId,
          project_identifier: config.projectIdentifier,
          intake_id: input.expectedIntakeId,
          name: intent.title,
          description: intent.description,
        }),
    )
    const {getWorkItem} = createPlaneAdapter(
      {PLANE_DESTINATION: 'biz-development', PLANE_API_KEY: config.apiKey},
      fetchImplementation,
    )
    const adapter: Pick<PlaneAdapter, 'getWorkItem'> = {getWorkItem}
    select
      .mockReturnValueOnce(createSelectQuery([]))
      .mockReturnValueOnce(createSelectQuery([baseMap()]))
      .mockReturnValueOnce(
        createSelectQuery([{defectCycleId: intent.defectCycleId}]),
      )
      .mockReturnValueOnce(createSelectQuery([{resultOutboxId: 51}]))
    const verifyTransaction = createTransaction()
    transaction.mockImplementationOnce(async (callback) =>
      callback(verifyTransaction),
    )

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        verifyOnly: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).resolves.toMatchObject({
      outcome: 'verified',
      testRunMapId: 21,
      defectCycleId: 31,
      resultOutboxId: 51,
      cycleState: 'manual_attention',
      outboxDeliveryState: 'manual_attention',
      providerStateId: 'state-open',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(
      fetchImplementation.mock.calls.some((call) =>
        ['POST', 'PATCH'].includes(String(call[1]?.method)),
      ),
    ).toBe(false)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(verifyTransaction.update).not.toHaveBeenCalled()
    for (const entry of verifyTransaction.select.mock.results) {
      expect(entry.value.for).not.toHaveBeenCalled()
    }
  })

  it('execute path with the projected adapter performs one GET and no provider writes', async () => {
    const fetchImplementation = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          id: input.expectedWorkItemId,
          state: {id: 'state-open'},
          workspace_id: config.workspaceId,
          project_id: config.projectId,
          project_identifier: config.projectIdentifier,
          intake_id: input.expectedIntakeId,
          name: intent.title,
          description: intent.description,
        }),
    )
    const fullAdapter = createPlaneAdapter(
      {
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: config.apiKey,
      },
      fetchImplementation,
    )
    const {getWorkItem} = fullAdapter
    const adapter: Pick<PlaneAdapter, 'getWorkItem'> = {getWorkItem}
    const finalize = createFinalizeTransaction()
    const result = await run({adapter, finalize})

    expect(result).toMatchObject({outcome: 'reconciled'})
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining('/work-items/work-item-41/'),
      expect.objectContaining({method: 'GET'}),
    )
    expect(
      fetchImplementation.mock.calls.some((call) =>
        ['POST', 'PATCH'].includes(String(call[1]?.method)),
      ),
    ).toBe(false)
  })

  it('fences a later invocation after provider GET and permanent finalization failure', async () => {
    const firstAdapter = createAdapter()
    transaction.mockReset()
    setupResolution()
    transaction.mockImplementationOnce(async (callback) => {
      lastClaimTransaction = createTransaction()
      return callback(lastClaimTransaction)
    })
    transaction.mockImplementationOnce(async () => {
      throw new Error('permanent finalization failure: secret=secret-api-key')
    })
    const manual = createManualAttentionTransaction()
    transaction.mockImplementationOnce(async (callback) => callback(manual))

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: firstAdapter,
        enabled: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).resolves.toMatchObject({outcome: 'manual_attention'})
    expect(firstAdapter.getWorkItem).toHaveBeenCalledTimes(1)
    const persistedError = manual.update.mock.results
      .map((entry) => {
        const query = entry.value as ReturnType<typeof createUpdateQuery>
        return query.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      })
      .find((values) => values?.deliveryState === 'manual_attention')?.lastError
    expect(String(persistedError)).toContain(
      PLANE_ONE_SHOT_FINALIZATION_FAILURE_MARKER,
    )
    expect(String(persistedError)).not.toContain('secret-api-key')

    const secondAdapter = createAdapter()
    select.mockReset()
    setupResolution({outboxRows: [baseOutbox({lastError: persistedError})]})
    transaction.mockReset()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({outboxRows: [baseOutbox({lastError: persistedError})]})),
    )
    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: secondAdapter,
        enabled: true,
        now: new Date('2026-08-22T00:02:00.000Z'),
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason: expect.stringContaining('explicit operator reconciliation'),
    })
    expect(secondAdapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('keeps the pre-GET provider fence when finalization and manual attention both fail', async () => {
    const firstAdapter = createAdapter()
    transaction.mockReset()
    setupResolution()
    transaction.mockImplementationOnce(async (callback) => {
      lastClaimTransaction = createTransaction()
      return callback(lastClaimTransaction)
    })
    transaction.mockImplementationOnce(async () => {
      throw new Error('permanent finalization failure')
    })
    transaction.mockImplementationOnce(async () => {
      throw new Error('manual attention write failed')
    })

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: firstAdapter,
        enabled: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).rejects.toThrow('could not record manual attention')
    expect(firstAdapter.getWorkItem).toHaveBeenCalledTimes(1)
    const claimError = lastClaimTransaction?.update.mock.results
      .map((entry) => {
        const query = entry.value as ReturnType<typeof createUpdateQuery>
        return query.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      })
      .find((values) => values?.deliveryState === 'leased')?.lastError
    expect(claimError).toBe(PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER)

    const secondAdapter = createAdapter()
    select.mockReset()
    setupResolution({
      outboxRows: [
        baseOutbox({lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER}),
      ],
    })
    transaction.mockReset()
    transaction.mockImplementationOnce(async (callback) =>
      callback(
        createTransaction({
          outboxRows: [
            baseOutbox({lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER}),
          ],
        }),
      ),
    )
    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: secondAdapter,
        enabled: true,
        now: new Date('2026-08-22T00:02:00.000Z'),
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason: expect.stringContaining('explicit operator reconciliation'),
    })
    expect(secondAdapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('refuses while any global delivery or readiness worker role is enabled', async () => {
    expect(arePlaneOneShotWorkerRolesDisabled({})).toBe(true)
    for (const flag of [
      'PLANE_DELIVERY_WORKER_ENABLED',
      'PLANE_RETEST_READINESS_ENABLED',
      'PLANE_RETEST_READINESS_WORKER_ENABLED',
    ]) {
      expect(arePlaneOneShotWorkerRolesDisabled({[flag]: 'true'})).toBe(false)
      await expect(
        reconcilePlaneDefectOneShot({
          input,
          config,
          planeAdapter: createAdapter(),
          enabled: true,
          environment: {[flag]: 'true'},
        }),
      ).resolves.toMatchObject({
        outcome: 'refused',
        reason:
          'Plane one-shot refused while a global delivery/readiness worker role is enabled',
      })
      expect(transaction).not.toHaveBeenCalled()
    }
  })

  it('retries only bounded MySQL deadlocks and propagates other errors', async () => {
    expect(isPlaneOneShotDeadlock({code: 'ER_LOCK_DEADLOCK'})).toBe(true)
    expect(isPlaneOneShotDeadlock({errno: 1213})).toBe(true)
    expect(isPlaneOneShotDeadlock({sqlState: '40001'})).toBe(true)
    expect(isPlaneOneShotDeadlock({code: 'ER_LOCK_WAIT_TIMEOUT'})).toBe(false)

    const attempts: number[] = []
    await expect(
      withPlaneOneShotDeadlockRetry(async (attempt) => {
        attempts.push(attempt)
        if (attempt === 1) throw {code: 'ER_LOCK_DEADLOCK'}
        return 'completed'
      }),
    ).resolves.toBe('completed')
    expect(attempts).toEqual([1, 2])

    const exhaustedAttempts: number[] = []
    await expect(
      withPlaneOneShotDeadlockRetry(async (attempt) => {
        exhaustedAttempts.push(attempt)
        throw {errno: 1213}
      }),
    ).rejects.toMatchObject({errno: 1213})
    expect(exhaustedAttempts).toEqual(
      Array.from(
        {length: PLANE_ONE_SHOT_MAX_DEADLOCK_ATTEMPTS},
        (_, i) => i + 1,
      ),
    )

    const nonDeadlock = new Error('lock wait timeout')
    const nonDeadlockOperation = jest.fn(async () => {
      throw nonDeadlock
    })
    await expect(
      withPlaneOneShotDeadlockRetry(nonDeadlockOperation),
    ).rejects.toBe(nonDeadlock)
    expect(nonDeadlockOperation).toHaveBeenCalledTimes(1)
  })

  it.each([
    [[], 'No exact testRunMap matched the target'],
    [
      [baseMap(), baseMap()],
      'More than one exact testRunMap matched the target',
    ],
  ])('refuses map cardinality %j', async (mapRows, reason) => {
    const adapter = createAdapter()
    await expect(run({load: {mapRows}})).resolves.toMatchObject({
      outcome: 'refused',
      reason,
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it.each([
    ['excluded map', {...baseMap(), isIncluded: false}],
    ['stale run', {...baseMap(), runStatus: 'Queued'}],
    ['cross-project run', {...baseMap(), runProjectId: 999}],
  ])('refuses %s without touching unrelated rows', async (_name, map) => {
    const adapter = createAdapter()
    await expect(run({load: {mapRows: [map]}})).resolves.toMatchObject({
      outcome: 'refused',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
    expect(lastClaimTransaction?.update).not.toHaveBeenCalled()
  })

  it('refuses a test joined from another project before provider GET', async () => {
    const adapter = createAdapter()
    await expect(
      run({load: {mapRows: [{...baseMap(), testProjectId: 999}]}}),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'Target test did not belong to the exact project',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('refuses an inactive or ambiguous active cycle', async () => {
    const adapter = createAdapter()
    await expect(run({load: {cycleRows: []}})).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'No active defect cycle matched the exact map',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()

    await expect(
      run({
        load: {cycleRows: [baseCycle(), {...baseCycle(), defectCycleId: 32}]},
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'More than one active defect cycle matched the exact map',
    })
  })

  it.each([
    [
      'current revision mismatch',
      {cycleRows: [{...baseCycle(), currentEvidenceRevisionId: 99}]},
      'Current result revision did not match the exact active cycle',
    ],
    [
      'outbox tuple mismatch',
      {outboxRows: [baseOutbox({eventKey: 'lookalike-event'})]},
      'Plane create outbox tuple did not match the exact cycle and revision',
    ],
    [
      'cycle destination mismatch',
      {cycleRows: [{...baseCycle(), providerProjectId: 'other-project'}]},
      'Active defect cycle did not match the exact Plane destination, correlation, or lifecycle state',
    ],
  ])('refuses %s before a provider request', async (_name, load, reason) => {
    const adapter = createAdapter()
    await expect(run({adapter, load})).resolves.toMatchObject({
      outcome: 'refused',
      reason,
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('preflights conflicting provider identities before GET', async () => {
    for (const cycle of [
      {...baseCycle(), providerWorkItemId: 'other-work-item'},
      {...baseCycle(), providerIntakeId: 'other-intake'},
    ]) {
      const adapter = createAdapter()
      await expect(
        run({adapter, load: {cycleRows: [cycle]}}),
      ).resolves.toMatchObject({
        outcome: 'refused',
        reason: expect.stringContaining('conflicted before GET'),
      })
      expect(adapter.getWorkItem).not.toHaveBeenCalled()
    }
  })

  it('locks map -> cycle -> outbox -> revision and reserves intake_pending before GET', async () => {
    const adapter = createAdapter()
    const reservationUpdate = createUpdateQuery()
    const claimUpdate = createUpdateQuery()
    const finalize = createFinalizeTransaction()
    const result = await run({
      adapter,
      load: {
        cycleRows: [{...baseCycle(), state: 'intake_pending'}],
        updates: [reservationUpdate, claimUpdate],
      },
      finalize,
    })

    expect(result).toMatchObject({outcome: 'reconciled'})
    expect(reservationUpdate.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(
      lastClaimTransaction?.select.mock.results.map(
        (entry) => entry.value.label,
      ),
    ).toEqual(['map', 'cycle', 'outbox', 'revision'])
    for (const entry of lastClaimTransaction?.select.mock.results ?? []) {
      expect(entry.value.for).toHaveBeenCalledWith('update')
    }
    expect(reservationUpdate.set.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.getWorkItem.mock.invocationCallOrder[0],
    )
    expect(claimUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
      }),
    )
    expect(claimUpdate.set.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.getWorkItem.mock.invocationCallOrder[0],
    )
  })

  it('accepts an expired outbox lease only while the cycle remains manual_attention', async () => {
    const adapter = createAdapter()
    const claimUpdate = createUpdateQuery()
    const expired = new Date('2026-08-21T23:59:00.000Z')
    const result = await run({
      adapter,
      load: {
        outboxRows: [
          baseOutbox({
            deliveryState: 'leased',
            leaseToken: 'expired-worker-token',
            leaseExpiresOn: expired,
          }),
        ],
        updates: [claimUpdate],
      },
      finalize: createFinalizeTransaction(),
    })

    expect(result).toMatchObject({outcome: 'reconciled'})
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(claimUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({deliveryState: 'leased'}),
    )
  })

  it('reconciles one exact provider GET and atomically links the cycle/outbox', async () => {
    const adapter = createAdapter()
    const claimUpdate = createUpdateQuery()
    const cycleUpdate = createUpdateQuery()
    const outboxUpdate = createUpdateQuery()
    const finalize = createFinalizeTransaction(
      [baseCycle()],
      [cycleUpdate, outboxUpdate],
    )
    const result = await run({
      adapter,
      load: {updates: [claimUpdate]},
      finalize,
    })

    expect(result).toMatchObject({
      outcome: 'reconciled',
      providerWorkItemId: input.expectedWorkItemId,
      providerIntakeId: input.expectedIntakeId,
      providerStateId: 'state-open',
    })
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(adapter.createIntake).not.toHaveBeenCalled()
    expect(finalize.update).toHaveBeenCalledTimes(2)
    expect(cycleUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        providerWorkItemId: input.expectedWorkItemId,
        providerIntakeId: input.expectedIntakeId,
        providerStateId: 'state-open',
        state: 'work_item_open',
      }),
    )
    expect(outboxUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({deliveryState: 'delivered'}),
    )
  })

  it('retries a pre-GET deadlock with a fresh claim token and one provider GET', async () => {
    const adapter = createAdapter()
    const firstClaimUpdate = createUpdateQuery()
    const secondClaimUpdate = createUpdateQuery()
    const firstClaim = createTransaction({updates: [firstClaimUpdate]})
    const secondClaim = createTransaction({updates: [secondClaimUpdate]})
    const finalize = createFinalizeTransaction()
    setupResolution()
    transaction.mockImplementationOnce(async (callback) => {
      await callback(firstClaim)
      throw {code: 'ER_LOCK_DEADLOCK'}
    })
    transaction.mockImplementationOnce(async (callback) =>
      callback(secondClaim),
    )
    transaction.mockImplementationOnce(async (callback) => callback(finalize))

    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: adapter,
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })

    expect(result).toMatchObject({outcome: 'reconciled'})
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(firstClaimUpdate.set.mock.calls[0][0]).toEqual(
      expect.objectContaining({leaseToken: expect.any(String)}),
    )
    expect(secondClaimUpdate.set.mock.calls[0][0]).toEqual(
      expect.objectContaining({leaseToken: expect.any(String)}),
    )
    const firstLeaseToken = (
      firstClaimUpdate.set.mock.calls[0][0] as {leaseToken?: string}
    ).leaseToken
    const secondLeaseToken = (
      secondClaimUpdate.set.mock.calls[0][0] as {leaseToken?: string}
    ).leaseToken
    expect(firstLeaseToken).not.toBe(secondLeaseToken)
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
  })

  it('retries finalization deadlocks without repeating the successful GET', async () => {
    const adapter = createAdapter()
    const firstFinalize = createFinalizeTransaction(
      [baseCycle()],
      [createUpdateQuery(), createUpdateQuery()],
    )
    const retryLeaseUpdate = createUpdateQuery()
    const secondFinalize = createFinalizeTransaction(
      [baseCycle()],
      [retryLeaseUpdate, createUpdateQuery(), createUpdateQuery()],
    )
    setupResolution()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({updates: [createUpdateQuery()]})),
    )
    transaction.mockImplementationOnce(async (callback) => {
      await callback(firstFinalize)
      throw {sqlState: '40001'}
    })
    transaction.mockImplementationOnce(async (callback) =>
      callback(secondFinalize),
    )

    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: adapter,
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })

    expect(result).toMatchObject({outcome: 'reconciled'})
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(secondFinalize.update).toHaveBeenCalledTimes(3)
    expect(retryLeaseUpdate.set).toHaveBeenCalledWith({
      leaseToken: expect.any(String),
      leaseExpiresOn: expect.any(Date),
    })
  })

  it('retries manual-attention deadlocks without repeating the failed GET', async () => {
    const adapter = createAdapter()
    adapter.getWorkItem.mockRejectedValueOnce(new Error('Plane unavailable'))
    const firstManual = createManualAttentionTransaction(
      [baseCycle()],
      [createUpdateQuery()],
    )
    const retryLeaseUpdate = createUpdateQuery()
    const secondManual = createManualAttentionTransaction(
      [baseCycle()],
      [retryLeaseUpdate, createUpdateQuery()],
    )
    setupResolution()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({updates: [createUpdateQuery()]})),
    )
    transaction.mockImplementationOnce(async (callback) => {
      await callback(firstManual)
      throw {errno: 1213}
    })
    transaction.mockImplementationOnce(async (callback) =>
      callback(secondManual),
    )

    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: adapter,
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })

    expect(result).toMatchObject({outcome: 'manual_attention'})
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(secondManual.update).toHaveBeenCalledTimes(2)
    expect(retryLeaseUpdate.set).toHaveBeenCalledWith({
      leaseToken: expect.any(String),
      leaseExpiresOn: expect.any(Date),
    })
  })

  it('verify-only reports the exact legacy repair as read-only with one GET', async () => {
    const adapter = createAdapter()
    select
      .mockReturnValueOnce(createSelectQuery([legacyCycle()]))
      .mockReturnValueOnce(createSelectQuery([legacyOutbox()]))
    const validation = createLegacyValidationTransaction()
    transaction.mockImplementationOnce(async (callback) => callback(validation))

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        verifyOnly: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).resolves.toMatchObject({
      outcome: 'verified',
      repairRequired: true,
      cycleState: 'intake_open',
      outboxDeliveryState: 'delivered',
      providerStateId: 'state-open',
    })
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(validation.update).not.toHaveBeenCalled()
  })

  it('refuses a legacy repair identity mismatch before provider GET', async () => {
    const adapter = createAdapter()
    await expect(
      run({
        adapter,
        load: {
          replayCycleRows: [
            {...legacyCycle(), providerIntakeId: 'other-intake'},
          ],
          replayOutboxRows: [legacyOutbox()],
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason:
        'Delivered historical Plane identity or tuple did not match the exact replay target',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('fences and atomically repairs the exact legacy cycle without leasing the delivered outbox', async () => {
    const adapter = createAdapter()
    const cycleReservation = createUpdateQuery()
    const providerFence = createUpdateQuery()
    const cycleUpdate = createUpdateQuery()
    const outboxUpdate = createUpdateQuery()
    const repairedOutbox = legacyOutbox({
      lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
    })
    const result = await run({
      adapter,
      load: {
        replayCycleRows: [legacyCycle()],
        replayOutboxRows: [legacyOutbox()],
        cycleRows: [legacyCycle()],
        outboxRows: [legacyOutbox()],
        updates: [cycleReservation, providerFence],
      },
      finalize: createFinalizeTransaction(
        [{...legacyCycle(), state: 'manual_attention'}],
        [cycleUpdate, outboxUpdate],
        [repairedOutbox],
      ),
    })

    expect(result).toMatchObject({
      outcome: 'reconciled',
      providerStateId: 'state-open',
    })
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(cycleReservation.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(providerFence.set).toHaveBeenCalledWith({
      lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
    })
    expect(cycleUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'work_item_open',
        providerStateId: 'state-open',
      }),
    )
    expect(outboxUpdate.set).toHaveBeenCalledWith({lastError: null})
  })

  it('rolls back when the delivered outbox row is replaced under the same ID and event key', async () => {
    const adapter = createAdapter()
    const load = {
      replayCycleRows: [legacyCycle()],
      replayOutboxRows: [legacyOutbox()],
      cycleRows: [legacyCycle()],
      outboxRows: [legacyOutbox()],
      updates: [createUpdateQuery(), createUpdateQuery()],
    }
    const mutatedOutbox = legacyOutbox({
      resultRevisionId: 999,
      lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
    })
    const finalize = createFinalizeTransaction(
      [{...legacyCycle(), state: 'manual_attention'}],
      [createUpdateQuery(), createUpdateQuery()],
      [mutatedOutbox],
    )
    let rolledBack = false
    setupResolution(load)
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction(load)),
    )
    transaction.mockImplementationOnce(async (callback) => {
      try {
        return await callback(finalize)
      } catch (error) {
        rolledBack = true
        throw error
      }
    })

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).resolves.toMatchObject({outcome: 'manual_attention'})
    expect(rolledBack).toBe(true)
    expect(finalize.update).not.toHaveBeenCalled()
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
  })

  it('rolls back the legacy cycle reservation when the durable provider fence is lost', async () => {
    const adapter = createAdapter()
    const cycleReservation = createUpdateQuery()
    const providerFence = createUpdateQuery(0)
    let committed = false
    const load = {
      replayCycleRows: [legacyCycle()],
      replayOutboxRows: [legacyOutbox()],
      cycleRows: [legacyCycle()],
      outboxRows: [legacyOutbox()],
      updates: [cycleReservation, providerFence],
    }
    setupResolution(load)
    transaction.mockImplementationOnce(async (callback) => {
      const trx = createTransaction(load)
      try {
        const result = await callback(trx)
        committed = true
        return result
      } catch (error) {
        throw error
      }
    })

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).rejects.toThrow('Legacy Plane provider-call fence was lost')
    expect(committed).toBe(false)
    expect(cycleReservation.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('fences a legacy provider GET failure and refuses replay without another request or write', async () => {
    const adapter = createAdapter()
    adapter.getWorkItem.mockRejectedValueOnce(new Error('Plane unavailable'))
    const cycleReservation = createUpdateQuery()
    const providerFence = createUpdateQuery()
    const firstResult = await run({
      adapter,
      load: {
        replayCycleRows: [legacyCycle()],
        replayOutboxRows: [legacyOutbox()],
        cycleRows: [legacyCycle()],
        outboxRows: [legacyOutbox()],
        updates: [cycleReservation, providerFence],
      },
    })

    expect(firstResult).toMatchObject({
      outcome: 'manual_attention',
      reason: 'Plane unavailable',
    })
    expect(cycleReservation.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(providerFence.set).toHaveBeenCalledWith({
      lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
    })
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)

    const transactionCallsAfterFailure = transaction.mock.calls.length
    const replayResult = await run({
      adapter,
      load: {
        replayCycleRows: [{...legacyCycle(), state: 'manual_attention'}],
        replayOutboxRows: [
          legacyOutbox({
            lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
          }),
        ],
      },
    })

    expect(replayResult).toMatchObject({
      outcome: 'refused',
      reason:
        'A prior provider call started or database finalization failed; explicit operator reconciliation is required',
    })
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(transaction).toHaveBeenCalledTimes(transactionCallsAfterFailure)
  })

  it('replays a repaired legacy cycle with zero GETs and zero writes', async () => {
    const adapter = createAdapter()
    const repairedCycle = {
      ...legacyCycle(),
      state: 'work_item_open',
      providerStateId: 'state-open',
    }
    const result = await run({
      adapter,
      load: {
        replayCycleRows: [repairedCycle],
        replayOutboxRows: [legacyOutbox()],
        cycleRows: [repairedCycle],
        outboxRows: [legacyOutbox()],
        updates: [],
      },
    })

    expect(result).toMatchObject({outcome: 'matched'})
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
    expect(lastClaimTransaction?.update).not.toHaveBeenCalled()
  })

  it('returns a linked replay as a no-op with no provider request', async () => {
    const adapter = createAdapter()
    const result = await run({
      adapter,
      load: {
        cycleRows: [
          {
            ...baseCycle(),
            state: 'work_item_open',
            providerWorkItemId: input.expectedWorkItemId,
            providerIntakeId: input.expectedIntakeId,
            providerStateId: 'state-open',
          },
        ],
        outboxRows: [
          baseOutbox({
            deliveryState: 'delivered',
            deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
          }),
        ],
        updates: [],
      },
    })
    expect(result).toMatchObject({outcome: 'matched'})
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it.each(['ready_for_retest', 'validated', 'superseded'] as const)(
    'returns a historical delivered replay as a no-op for %s without reopening it',
    async (state) => {
      const adapter = createAdapter()
      const historicalCycle = {
        ...baseCycle(),
        state,
        activeMarker: state === 'ready_for_retest' ? 1 : null,
        currentEvidenceRevisionId: 99,
        providerWorkItemId: input.expectedWorkItemId,
        providerIntakeId: input.expectedIntakeId,
        providerStateId: 'state-open',
      }
      const historicalOutbox = baseOutbox({
        deliveryState: 'delivered',
        deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
      })
      const result = await run({
        adapter,
        load: {
          replayCycleRows: [historicalCycle],
          replayOutboxRows: [historicalOutbox],
          mapRows: [{...baseMap(), currentResultRevisionId: 99}],
          cycleRows: [historicalCycle],
          outboxRows: [historicalOutbox],
          revisionRows: [baseRevision()],
          updates: [],
        },
      })

      expect(result).toMatchObject({outcome: 'matched', defectCycleId: 31})
      expect(adapter.getWorkItem).not.toHaveBeenCalled()
      expect(lastClaimTransaction?.update).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      label: 'map run identity',
      map: {...baseMap(), runId: input.runId + 100},
      revision: baseRevision(),
    },
    {
      label: 'revision map identity',
      map: baseMap(),
      revision: {...baseRevision(), testRunMapId: 999},
    },
  ])(
    'verify-only refuses a historical replay with the wrong $label before provider GET',
    async ({map, revision}) => {
      const adapter = createAdapter()
      const historicalCycle = {
        ...baseCycle(),
        state: 'validated' as const,
        activeMarker: null,
        providerWorkItemId: input.expectedWorkItemId,
        providerIntakeId: input.expectedIntakeId,
        providerStateId: 'state-open',
      }
      const historicalOutbox = baseOutbox({
        deliveryState: 'delivered',
        deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
      })
      select
        .mockReturnValueOnce(createSelectQuery([historicalCycle]))
        .mockReturnValueOnce(createSelectQuery([historicalOutbox]))
      const validationTransaction = {
        select: jest
          .fn()
          .mockReturnValueOnce(createSelectQuery([map]))
          .mockReturnValueOnce(createSelectQuery([revision])),
        update: jest.fn(),
      }
      transaction.mockImplementationOnce(async (callback) =>
        callback(validationTransaction),
      )

      await expect(
        reconcilePlaneDefectOneShot({
          input,
          config,
          planeAdapter: adapter,
          enabled: true,
          verifyOnly: true,
          now: new Date('2026-08-22T00:01:00.000Z'),
        }),
      ).resolves.toMatchObject({
        outcome: 'refused',
        reason:
          'Historical replay map or result revision did not match the exact target',
      })
      expect(adapter.getWorkItem).not.toHaveBeenCalled()
      expect(validationTransaction.update).not.toHaveBeenCalled()
      expect(transaction).toHaveBeenCalledTimes(1)
    },
  )

  it('verify-only validates a complete historical replay identity without writes', async () => {
    const adapter = createAdapter()
    const historicalCycle = {
      ...baseCycle(),
      state: 'validated' as const,
      activeMarker: null,
      providerWorkItemId: input.expectedWorkItemId,
      providerIntakeId: input.expectedIntakeId,
      providerStateId: 'state-open',
    }
    const historicalOutbox = baseOutbox({
      deliveryState: 'delivered',
      deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
    })
    select
      .mockReturnValueOnce(createSelectQuery([historicalCycle]))
      .mockReturnValueOnce(createSelectQuery([historicalOutbox]))
    const validationTransaction = {
      select: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery([baseMap()]))
        .mockReturnValueOnce(createSelectQuery([baseRevision()])),
      update: jest.fn(),
    }
    transaction.mockImplementationOnce(async (callback) =>
      callback(validationTransaction),
    )

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        verifyOnly: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).resolves.toMatchObject({outcome: 'matched', testRunMapId: 21})
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
    expect(validationTransaction.update).not.toHaveBeenCalled()
  })

  it.each([
    {deliveredOn: null},
    {leaseToken: 'stale-lease-token'},
    {leaseExpiresOn: new Date('2026-08-22T00:01:00.000Z')},
  ])(
    'refuses historical replay unless the delivered record is complete (%j)',
    async (outboxState) => {
      const adapter = createAdapter()
      const historicalCycle = {
        ...baseCycle(),
        state: 'validated' as const,
        activeMarker: null,
        currentEvidenceRevisionId: 99,
        providerWorkItemId: input.expectedWorkItemId,
        providerIntakeId: input.expectedIntakeId,
        providerStateId: 'state-open',
      }
      const historicalOutbox = baseOutbox({
        deliveryState: 'delivered',
        deliveredOn: new Date('2026-08-22T00:00:30.000Z'),
        ...outboxState,
      })
      await expect(
        run({
          adapter,
          load: {
            replayCycleRows: [historicalCycle],
            replayOutboxRows: [historicalOutbox],
          },
        }),
      ).resolves.toMatchObject({
        outcome: 'refused',
        reason:
          'Delivered historical Plane identity or tuple did not match the exact replay target',
      })
      expect(adapter.getWorkItem).not.toHaveBeenCalled()
    },
  )

  it('refuses ambiguous historical delivered replay before provider GET', async () => {
    const adapter = createAdapter()
    await expect(
      run({
        adapter,
        load: {
          replayCycleRows: [
            {
              ...baseCycle(),
              providerWorkItemId: input.expectedWorkItemId,
              providerIntakeId: input.expectedIntakeId,
              providerStateId: 'state-open',
            },
            {
              ...baseCycle(),
              defectCycleId: 32,
              providerWorkItemId: input.expectedWorkItemId,
              providerIntakeId: input.expectedIntakeId,
              providerStateId: 'state-open',
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason:
        'More than one historical Plane cycle matched the exact replay tuple',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('fails closed on provider identity/content mismatch and never POSTs', async () => {
    const adapter = createAdapter(
      workItem({
        raw: {
          ...workItem().raw,
          project_identifier: 'OTHER',
        },
      }),
    )
    const manualAttentionUpdate = createUpdateQuery()
    setupResolution()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({updates: [createUpdateQuery()]})),
    )
    transaction.mockImplementationOnce(async (callback) =>
      callback(
        createManualAttentionTransaction(
          [baseCycle()],
          [manualAttentionUpdate],
        ),
      ),
    )
    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: adapter,
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })
    expect(result).toMatchObject({outcome: 'manual_attention'})
    expect(adapter.getWorkItem).toHaveBeenCalledTimes(1)
    expect(adapter.createIntake).not.toHaveBeenCalled()
  })

  it('keeps both cycle and outbox manual_attention after a provider GET error', async () => {
    const adapter = createAdapter()
    adapter.getWorkItem.mockRejectedValueOnce(new Error('Plane unavailable'))
    const reservationUpdate = createUpdateQuery()
    const claimUpdate = createUpdateQuery()
    const cycleAttentionUpdate = createUpdateQuery()
    const outboxAttentionUpdate = createUpdateQuery()
    const result = await run({
      adapter,
      load: {
        cycleRows: [{...baseCycle(), state: 'intake_pending'}],
        updates: [reservationUpdate, claimUpdate],
      },
      manualAttention: createManualAttentionTransaction(
        [{...baseCycle(), state: 'intake_pending'}],
        [cycleAttentionUpdate, outboxAttentionUpdate],
      ),
    })

    expect(result).toMatchObject({outcome: 'manual_attention'})
    expect(cycleAttentionUpdate.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(outboxAttentionUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({deliveryState: 'manual_attention'}),
    )
  })

  it('redacts provider errors in the operator summary', async () => {
    const adapter = createAdapter()
    adapter.getWorkItem.mockImplementationOnce(async () => {
      throw new PlaneAdapterError(
        'Plane response body: Authorization: Bearer super-secret-token-value; X-API-Key: super-secret-api-key',
        'manual_attention',
      )
    })
    const cycleAttentionUpdate = createUpdateQuery()
    const outboxAttentionUpdate = createUpdateQuery()
    setupResolution()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({updates: [createUpdateQuery()]})),
    )
    transaction.mockImplementationOnce(async (callback) =>
      callback(
        createManualAttentionTransaction(
          [baseCycle()],
          [cycleAttentionUpdate, outboxAttentionUpdate],
        ),
      ),
    )
    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: adapter,
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })
    expect(result).toMatchObject({outcome: 'manual_attention'})
    expect(JSON.stringify(result)).not.toContain('super-secret-token-value')
    expect(JSON.stringify(result)).not.toContain('super-secret-api-key')
    expect(JSON.stringify(outboxAttentionUpdate.set.mock.calls)).not.toContain(
      'super-secret-token-value',
    )
    expect(JSON.stringify(outboxAttentionUpdate.set.mock.calls)).not.toContain(
      'super-secret-api-key',
    )
  })

  it('rejects a lost claim lease fence so the reservation transaction cannot commit', async () => {
    const adapter = createAdapter()
    const reservationUpdate = createUpdateQuery()
    const claimUpdate = createUpdateQuery(0)
    const load = {
      cycleRows: [{...baseCycle(), state: 'intake_pending'}],
      updates: [reservationUpdate, claimUpdate],
    }
    let committed = false
    setupResolution(load)
    transaction.mockImplementationOnce(async (callback) => {
      const trx = createTransaction(load)
      try {
        const result = await callback(trx)
        committed = true
        return result
      } catch (error) {
        throw error
      }
    })

    await expect(
      reconcilePlaneDefectOneShot({
        input,
        config,
        planeAdapter: adapter,
        enabled: true,
        now: new Date('2026-08-22T00:01:00.000Z'),
      }),
    ).rejects.toThrow('Plane create outbox lease fence was lost')
    expect(committed).toBe(false)
    expect(reservationUpdate.set).toHaveBeenCalledWith({
      state: 'manual_attention',
    })
    expect(adapter.getWorkItem).not.toHaveBeenCalled()
  })

  it('rolls back cycle linking when the outbox completion lease fence is lost', async () => {
    const finalize = createFinalizeTransaction(
      [baseCycle()],
      [createUpdateQuery(), createUpdateQuery(0)],
    )
    let rolledBack = false
    setupResolution()
    transaction.mockImplementationOnce(async (callback) =>
      callback(createTransaction({updates: [createUpdateQuery()]})),
    )
    transaction.mockImplementationOnce(async (callback) => {
      try {
        return await callback(finalize)
      } catch (error) {
        rolledBack = true
        throw error
      }
    })
    transaction.mockImplementationOnce(async (callback) =>
      callback(createManualAttentionTransaction()),
    )

    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter: createAdapter(),
      enabled: true,
      now: new Date('2026-08-22T00:01:00.000Z'),
    })
    expect(rolledBack).toBe(true)
    expect(result).toMatchObject({outcome: 'manual_attention'})
  })

  it('refuses finalization after a concurrent lifecycle transition', async () => {
    const adapter = createAdapter()
    const finalize = createFinalizeTransaction([
      {...baseCycle(), state: 'ready_for_retest'},
    ])
    const manualOutboxUpdate = createUpdateQuery()
    const result = await run({
      adapter,
      finalize,
      manualAttention: createManualAttentionTransaction(
        [{...baseCycle(), state: 'ready_for_retest'}],
        [manualOutboxUpdate],
      ),
    })

    expect(result).toMatchObject({outcome: 'manual_attention'})
    expect(finalize.update).not.toHaveBeenCalled()
    expect(manualOutboxUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({deliveryState: 'manual_attention'}),
    )
  })
})
