const transaction = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {transaction, select: jest.fn()},
}))

import {
  buildPlaneReconciliationFindings,
  planeReconciliationStore,
  PlaneReconciliationSnapshot,
  reconcilePlaneRetestReadiness,
} from '../planeReconciliation'

const config = {
  doneStateId: 'done-state-id',
  workspaceId: 'workspace-id',
  projectId: 'project-id',
}

const validSnapshot = (
  overrides: Partial<PlaneReconciliationSnapshot> = {},
): PlaneReconciliationSnapshot => ({
  defectCycleId: 73,
  testRunMapId: 17,
  runId: 7,
  testId: 11,
  projectId: 5,
  state: 'work_item_open',
  currentEvidenceRevisionId: 41,
  reopenState: null,
  providerStateId: 'todo-state-id',
  mappingTestRunMapId: 17,
  mappingRunId: 7,
  mappingTestId: 11,
  mappingProjectId: 5,
  isIncluded: true,
  currentResultRevisionId: 41,
  runStatus: 'Active',
  revisionTestRunMapId: 17,
  revisionRunId: 7,
  revisionTestId: 11,
  revisionProjectId: 5,
  ...overrides,
})

describe('Plane reconciliation', () => {
  beforeEach(() => transaction.mockReset())

  it('records critical aggregate drift before interpreting provider state', () => {
    const findings = buildPlaneReconciliationFindings({
      snapshot: validSnapshot({currentResultRevisionId: 42}),
      authoritativeStateId: 'done-state-id',
      readinessOutcome: 'no_op',
      config,
    })

    expect(findings).toEqual([
      expect.objectContaining({
        findingKey: 'plane-cycle:73:aggregate-integrity',
        findingType: 'plane_cycle_aggregate_integrity',
        severity: 'critical',
      }),
    ])
  })

  it('records a blocked reopen until authoritative non-Done is observed', () => {
    const findings = buildPlaneReconciliationFindings({
      snapshot: validSnapshot({reopenState: 'delivered'}),
      authoritativeStateId: 'done-state-id',
      readinessOutcome: 'no_op',
      config,
    })

    expect(findings).toEqual([
      expect.objectContaining({
        findingKey: 'plane-cycle:73:readiness-state',
        findingType: 'plane_reopen_not_authoritatively_observed',
        severity: 'warning',
      }),
    ])
  })

  it('records a missing durable notification recipient', () => {
    const findings = buildPlaneReconciliationFindings({
      snapshot: validSnapshot(),
      authoritativeStateId: 'todo-state-id',
      readinessOutcome: 'manual_attention',
      config,
    })

    expect(findings).toEqual([
      expect.objectContaining({
        findingKey: 'plane-cycle:73:notification-recipient',
        findingType: 'plane_retest_notification_recipient_missing',
      }),
    ])
  })

  it('matches when local and authoritative readiness agree', () => {
    expect(
      buildPlaneReconciliationFindings({
        snapshot: validSnapshot({
          state: 'ready_for_retest',
          providerStateId: 'done-state-id',
        }),
        authoritativeStateId: 'done-state-id',
        readinessOutcome: 'no_op',
        config,
      }),
    ).toEqual([])
  })

  it('persists findings and lets the store resolve absent finding keys', async () => {
    const persist = jest.fn()
    const now = new Date('2026-08-20T00:00:00.000Z')
    const outcome = await reconcilePlaneRetestReadiness({
      workItemId: 'work-item-id',
      authoritativeStateId: 'done-state-id',
      readinessOutcome: 'no_op',
      config,
      now,
      store: {
        loadSnapshot: async () => validSnapshot({reopenState: 'delivered'}),
        persist,
      },
    })

    expect(outcome).toBe('recorded')
    expect(persist).toHaveBeenCalledWith({
      defectCycleId: 73,
      findings: [
        expect.objectContaining({
          findingType: 'plane_reopen_not_authoritatively_observed',
        }),
      ],
      now,
    })
  })

  it('does not create a finding for an inactive or unknown correlation', async () => {
    const persist = jest.fn()
    await expect(
      reconcilePlaneRetestReadiness({
        workItemId: 'unknown-work-item-id',
        authoritativeStateId: 'done-state-id',
        readinessOutcome: 'no_op',
        config,
        store: {loadSnapshot: async () => null, persist},
      }),
    ).resolves.toBe('no_op')
    expect(persist).not.toHaveBeenCalled()
  })

  it('upserts active findings and resolves owned keys that no longer mismatch', async () => {
    const insertedValues: unknown[] = []
    const duplicateUpdates: unknown[] = []
    const resolvedValues: unknown[] = []
    const trx = {
      insert: jest.fn(() => ({
        values: jest.fn((values: unknown) => {
          insertedValues.push(values)
          return {
            onDuplicateKeyUpdate: jest.fn(async (update: unknown) => {
              duplicateUpdates.push(update)
            }),
          }
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          resolvedValues.push(values)
          return {where: jest.fn(async () => [{affectedRows: 2}])}
        }),
      })),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    const now = new Date('2026-08-20T00:00:00.000Z')
    const finding = buildPlaneReconciliationFindings({
      snapshot: validSnapshot({reopenState: 'delivered'}),
      authoritativeStateId: 'done-state-id',
      readinessOutcome: 'no_op',
      config,
    })

    await planeReconciliationStore.persist({
      defectCycleId: 73,
      findings: finding,
      now,
    })

    expect(insertedValues).toEqual([
      expect.objectContaining({
        findingKey: 'plane-cycle:73:readiness-state',
        aggregateType: 'defect_cycle',
        aggregateId: 73,
        state: 'manual_attention',
        firstDetectedOn: now,
        lastDetectedOn: now,
      }),
    ])
    expect(duplicateUpdates).toEqual([
      expect.objectContaining({
        set: expect.objectContaining({
          state: 'manual_attention',
          resolvedOn: null,
          lastDetectedOn: now,
        }),
      }),
    ])
    expect(resolvedValues).toEqual([
      {
        state: 'resolved',
        resolvedOn: now,
        resolutionNote: 'Authoritative Plane reconciliation matched',
      },
    ])
  })

  it('does not resolve other findings while aggregate integrity is unknown', async () => {
    const trx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onDuplicateKeyUpdate: jest.fn(async () => undefined),
        })),
      })),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))
    const now = new Date('2026-08-20T00:00:00.000Z')

    await planeReconciliationStore.persist({
      defectCycleId: 73,
      findings: buildPlaneReconciliationFindings({
        snapshot: validSnapshot({currentResultRevisionId: 42}),
        authoritativeStateId: 'done-state-id',
        readinessOutcome: 'no_op',
        config,
      }),
      now,
    })

    expect(trx.insert).toHaveBeenCalledTimes(1)
    expect(trx.update).not.toHaveBeenCalled()
  })
})
