import {and, eq, inArray, isNotNull, isNull} from 'drizzle-orm'
import {
  defectCycles,
  integrationReconciliations,
  resultRevisions,
} from '@schema/resultRevisions'
import {runs, testRunMap} from '@schema/runs'
import {dbClient} from '~/db/client'
import type {PlaneRetestReadinessApplyOutcome} from './planeRetestReadiness'

const PLANE_PROVIDER = 'plane'

export type PlaneReconciliationConfig = {
  doneStateId: string
  workspaceId: string
  projectId: string
}

export type PlaneReconciliationSnapshot = {
  defectCycleId: number
  testRunMapId: number
  runId: number
  testId: number
  projectId: number
  state: string
  currentEvidenceRevisionId: number
  reopenState: string | null
  providerStateId: string | null
  mappingTestRunMapId: number | null
  mappingRunId: number | null
  mappingTestId: number | null
  mappingProjectId: number | null
  isIncluded: boolean | null
  currentResultRevisionId: number | null
  runStatus: string | null
  revisionTestRunMapId: number | null
  revisionRunId: number | null
  revisionTestId: number | null
  revisionProjectId: number | null
}

export type PlaneReconciliationFinding = {
  findingKey: string
  findingType: string
  severity: 'warning' | 'critical'
  expectedSnapshot: Record<string, unknown>
  actualSnapshot: Record<string, unknown>
}

const findingKey = (defectCycleId: number, suffix: string) =>
  `plane-cycle:${defectCycleId}:${suffix}`

const knownFindingKeys = (defectCycleId: number) => [
  findingKey(defectCycleId, 'aggregate-integrity'),
  findingKey(defectCycleId, 'readiness-state'),
  findingKey(defectCycleId, 'notification-recipient'),
]

const hasValidAggregate = (snapshot: PlaneReconciliationSnapshot) =>
  snapshot.mappingTestRunMapId === snapshot.testRunMapId &&
  snapshot.mappingRunId === snapshot.runId &&
  snapshot.mappingTestId === snapshot.testId &&
  snapshot.mappingProjectId === snapshot.projectId &&
  snapshot.isIncluded === true &&
  snapshot.runStatus === 'Active' &&
  snapshot.currentResultRevisionId === snapshot.currentEvidenceRevisionId &&
  snapshot.revisionTestRunMapId === snapshot.testRunMapId &&
  snapshot.revisionRunId === snapshot.runId &&
  snapshot.revisionTestId === snapshot.testId &&
  snapshot.revisionProjectId === snapshot.projectId

export const buildPlaneReconciliationFindings = ({
  snapshot,
  authoritativeStateId,
  readinessOutcome,
  config,
}: {
  snapshot: PlaneReconciliationSnapshot
  authoritativeStateId: string
  readinessOutcome: PlaneRetestReadinessApplyOutcome
  config: PlaneReconciliationConfig
}): PlaneReconciliationFinding[] => {
  if (!hasValidAggregate(snapshot)) {
    return [
      {
        findingKey: findingKey(snapshot.defectCycleId, 'aggregate-integrity'),
        findingType: 'plane_cycle_aggregate_integrity',
        severity: 'critical',
        expectedSnapshot: {
          testRunMapId: snapshot.testRunMapId,
          runId: snapshot.runId,
          testId: snapshot.testId,
          projectId: snapshot.projectId,
          currentEvidenceRevisionId: snapshot.currentEvidenceRevisionId,
          isIncluded: true,
          runStatus: 'Active',
        },
        actualSnapshot: {
          mappingTestRunMapId: snapshot.mappingTestRunMapId,
          mappingRunId: snapshot.mappingRunId,
          mappingTestId: snapshot.mappingTestId,
          mappingProjectId: snapshot.mappingProjectId,
          isIncluded: snapshot.isIncluded,
          currentResultRevisionId: snapshot.currentResultRevisionId,
          runStatus: snapshot.runStatus,
          revisionTestRunMapId: snapshot.revisionTestRunMapId,
          revisionRunId: snapshot.revisionRunId,
          revisionTestId: snapshot.revisionTestId,
          revisionProjectId: snapshot.revisionProjectId,
        },
      },
    ]
  }

  const providerReady = authoritativeStateId === config.doneStateId
  const localReady = snapshot.state === 'ready_for_retest'
  const reopenBlocksReadiness =
    providerReady &&
    ['pending', 'delivered', 'manual_attention'].includes(
      snapshot.reopenState ?? '',
    )
  const findings: PlaneReconciliationFinding[] = []

  if (reopenBlocksReadiness || localReady !== providerReady) {
    findings.push({
      findingKey: findingKey(snapshot.defectCycleId, 'readiness-state'),
      findingType: reopenBlocksReadiness
        ? 'plane_reopen_not_authoritatively_observed'
        : 'plane_readiness_state_mismatch',
      severity: 'warning',
      expectedSnapshot: reopenBlocksReadiness
        ? {
            providerStateId: `not:${config.doneStateId}`,
            reopenState: 'observed',
          }
        : {
            providerReady: localReady,
            localCycleState: snapshot.state,
          },
      actualSnapshot: {
        providerStateId: authoritativeStateId,
        locallyObservedProviderStateId: snapshot.providerStateId,
        reopenState: snapshot.reopenState,
        localCycleState: snapshot.state,
      },
    })
  }

  if (readinessOutcome === 'manual_attention') {
    findings.push({
      findingKey: findingKey(snapshot.defectCycleId, 'notification-recipient'),
      findingType: 'plane_retest_notification_recipient_missing',
      severity: 'warning',
      expectedSnapshot: {activeRecipientAvailable: true},
      actualSnapshot: {activeRecipientAvailable: false},
    })
  }

  return findings
}

export type PlaneReconciliationStore = {
  loadSnapshot(input: {
    workItemId: string
    config: PlaneReconciliationConfig
  }): Promise<PlaneReconciliationSnapshot | null>
  persist(input: {
    defectCycleId: number
    findings: PlaneReconciliationFinding[]
    now: Date
  }): Promise<void>
}

export const planeReconciliationStore: PlaneReconciliationStore = {
  loadSnapshot: async ({workItemId, config}) => {
    const [snapshot] = await dbClient
      .select({
        defectCycleId: defectCycles.defectCycleId,
        testRunMapId: defectCycles.testRunMapId,
        runId: defectCycles.runId,
        testId: defectCycles.testId,
        projectId: defectCycles.projectId,
        state: defectCycles.state,
        currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
        reopenState: defectCycles.reopenState,
        providerStateId: defectCycles.providerStateId,
        mappingTestRunMapId: testRunMap.testRunMapId,
        mappingRunId: testRunMap.runId,
        mappingTestId: testRunMap.testId,
        mappingProjectId: testRunMap.projectId,
        isIncluded: testRunMap.isIncluded,
        currentResultRevisionId: testRunMap.currentResultRevisionId,
        runStatus: runs.status,
        revisionTestRunMapId: resultRevisions.testRunMapId,
        revisionRunId: resultRevisions.runId,
        revisionTestId: resultRevisions.testId,
        revisionProjectId: resultRevisions.projectId,
      })
      .from(defectCycles)
      .leftJoin(
        testRunMap,
        eq(testRunMap.testRunMapId, defectCycles.testRunMapId),
      )
      .leftJoin(runs, eq(runs.runId, defectCycles.runId))
      .leftJoin(
        resultRevisions,
        eq(
          resultRevisions.resultRevisionId,
          defectCycles.currentEvidenceRevisionId,
        ),
      )
      .where(
        and(
          eq(defectCycles.provider, PLANE_PROVIDER),
          eq(defectCycles.providerWorkspaceId, config.workspaceId),
          eq(defectCycles.providerProjectId, config.projectId),
          eq(defectCycles.providerWorkItemId, workItemId),
          eq(defectCycles.activeMarker, 1),
          isNotNull(defectCycles.providerWorkItemId),
        ),
      )
      .limit(1)
    return snapshot ?? null
  },
  persist: async ({defectCycleId, findings, now}) => {
    const activeKeys = new Set(findings.map((finding) => finding.findingKey))
    const aggregateIntegrityKey = findingKey(
      defectCycleId,
      'aggregate-integrity',
    )
    const resolvedKeys = activeKeys.has(aggregateIntegrityKey)
      ? []
      : knownFindingKeys(defectCycleId).filter((key) => !activeKeys.has(key))

    await dbClient.transaction(async (trx) => {
      for (const finding of findings) {
        await trx
          .insert(integrationReconciliations)
          .values({
            ...finding,
            aggregateType: 'defect_cycle',
            aggregateId: defectCycleId,
            state: 'manual_attention',
            firstDetectedOn: now,
            lastDetectedOn: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              findingType: finding.findingType,
              severity: finding.severity,
              state: 'manual_attention',
              expectedSnapshot: finding.expectedSnapshot,
              actualSnapshot: finding.actualSnapshot,
              lastDetectedOn: now,
              resolvedOn: null,
              resolutionNote: null,
            },
          })
      }

      if (resolvedKeys.length > 0) {
        await trx
          .update(integrationReconciliations)
          .set({
            state: 'resolved',
            resolvedOn: now,
            resolutionNote: 'Authoritative Plane reconciliation matched',
          })
          .where(
            and(
              eq(integrationReconciliations.aggregateType, 'defect_cycle'),
              eq(integrationReconciliations.aggregateId, defectCycleId),
              inArray(integrationReconciliations.findingKey, resolvedKeys),
              isNull(integrationReconciliations.resolvedOn),
            ),
          )
      }
    })
  },
}

export const reconcilePlaneRetestReadiness = async ({
  workItemId,
  authoritativeStateId,
  readinessOutcome,
  config,
  store = planeReconciliationStore,
  now = new Date(),
}: {
  workItemId: string
  authoritativeStateId: string
  readinessOutcome: PlaneRetestReadinessApplyOutcome
  config: PlaneReconciliationConfig
  store?: PlaneReconciliationStore
  now?: Date
}): Promise<'recorded' | 'matched' | 'no_op'> => {
  const snapshot = await store.loadSnapshot({workItemId, config})
  if (!snapshot) return 'no_op'
  const findings = buildPlaneReconciliationFindings({
    snapshot,
    authoritativeStateId,
    readinessOutcome,
    config,
  })
  await store.persist({
    defectCycleId: snapshot.defectCycleId,
    findings,
    now,
  })
  return findings.length > 0 ? 'recorded' : 'matched'
}
