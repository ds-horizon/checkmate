import {randomUUID} from 'node:crypto'
import {and, asc, eq, isNull, lte, or, sql} from 'drizzle-orm'
import {
  defectCycles,
  resultOutbox,
  resultRevisions,
  PlaneDefectIntent,
} from '@schema/resultRevisions'
import {runs, testRunMap} from '@schema/runs'
import {tests} from '@schema/tests'
import {dbClient} from '~/db/client'
import {
  PlaneAdapterConfig,
  PlaneOneShotAdapter,
  PlaneWorkItem,
  sanitizePlaneError,
} from './planeAdapter'

export const PLANE_CANARY_ONE_SHOT_DESTINATION = 'biz-development' as const
export const PLANE_CANARY_ONE_SHOT_FLAG = 'PLANE_CANARY_ONE_SHOT_ENABLED'

const PLANE_PROVIDER = 'plane'
const CREATE_EVENT_TYPE = 'plane_defect_create_requested'
const CREATE_EVENT_KEY = (defectCycleId: number) =>
  `defect-cycle:${defectCycleId}:plane-create`
const DEFAULT_LEASE_MS = 430_000
const MIN_LEASE_MS = 1_000
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000
export const PLANE_ONE_SHOT_MAX_DEADLOCK_ATTEMPTS = 3
export const PLANE_ONE_SHOT_FINALIZATION_FAILURE_MARKER =
  'operator_reconciliation_required: provider GET succeeded; finalization failed'
export const PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER =
  'operator_reconciliation_required: provider call started'
export const PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER =
  'operator_reconciliation_required: BIZ-41 provider observation recovery started'
export const PLANE_ONE_SHOT_BIZ41_RECOVERY_PAYLOAD_DIGEST =
  '2be2537060cd11f4127efe99f599fbb9d61beea96443af679114eff3c81bf61d'

const BIZ41_RECOVERY = {
  projectId: 4,
  runId: 17,
  testId: 394,
  testRunMapId: 386,
  defectCycleId: 1,
  resultRevisionId: 1,
  resultOutboxId: 1,
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  providerWorkItemId: '48eef479-5be4-4356-a77d-a0c881e5cff7',
  providerIntakeId: 'fe8b9bb8-bcbe-4ff9-a09c-ec9f9a402aae',
  correlationKey: 'checkmate:6fff5133-a23f-47d1-ad0d-b47fce28f441',
  providerSequenceId: 41,
  payloadDigest:
    PLANE_ONE_SHOT_BIZ41_RECOVERY_PAYLOAD_DIGEST,
} as const

const BLOCKING_WORKER_FLAGS = [
  'PLANE_DELIVERY_WORKER_ENABLED',
  'PLANE_RETEST_READINESS_ENABLED',
  'PLANE_RETEST_READINESS_WORKER_ENABLED',
] as const

type PlaneOneShotDestination = typeof PLANE_CANARY_ONE_SHOT_DESTINATION
type DefectCycleState = (typeof defectCycles.state.enumValues)[number]

export type PlaneOneShotReconciliationInput = {
  projectId: number
  runId: number
  testId: number
  expectedWorkItemId: string
  expectedIntakeId: string
  expectedCorrelationKey: string
  expectedDestination: PlaneOneShotDestination
  recoverBiz41ProviderObservationMismatch?: boolean
  recoveryPayloadDigest?: string
}

export type PlaneOneShotReconciliationResult =
  | {
      outcome: 'reconciled' | 'matched'
      projectId: number
      runId: number
      testId: number
      testRunMapId: number
      defectCycleId: number
      resultOutboxId: number
      providerWorkItemId: string
      providerIntakeId: string
      providerStateId: string
    }
  | {
      outcome: 'verified'
      repairRequired?: boolean
      projectId: number
      runId: number
      testId: number
      testRunMapId: number
      defectCycleId: number
      resultOutboxId: number
      cycleState: DefectCycleState
      outboxDeliveryState: string
      providerWorkItemId: string
      providerIntakeId: string
      providerStateId: string
    }
  | {
      outcome: 'refused' | 'manual_attention'
      projectId: number
      runId: number
      testId: number
      reason: string
      testRunMapId?: number
      defectCycleId?: number
      resultOutboxId?: number
    }

type ReconciliationMap = {
  testRunMapId: number
  projectId: number
  testProjectId: number | null
  runId: number | null
  testId: number | null
  isIncluded: boolean | null
  currentResultRevisionId: number | null
  runProjectId: number | null
  runStatus: string | null
}

type ReconciliationCycle = {
  defectCycleId: number
  testRunMapId: number
  projectId: number
  runId: number
  testId: number
  activeMarker: number | null
  state: DefectCycleState
  currentEvidenceRevisionId: number
  provider: string | null
  providerWorkspaceId: string | null
  providerProjectId: string | null
  providerWorkItemId: string | null
  providerIntakeId: string | null
  providerStateId: string | null
  providerSequenceId: number | null
  providerUrl: string | null
  createCorrelationKey: string | null
}

type ReconciliationRevision = {
  resultRevisionId: number
  testRunMapId: number
  projectId: number
  runId: number
  testId: number
}

type ReconciliationOutbox = {
  resultOutboxId: number
  eventKey: string
  eventType: string
  aggregateType: string
  aggregateId: number
  resultRevisionId: number
  payload: {
    resultRevisionId?: number
    testRunMapId?: number
    projectId?: number
    runId?: number
    testId?: number
    defectCycleId?: number
    planeDefectIntent?: PlaneDefectIntent
  }
  payloadDigest?: string
  deliveryState: string
  availableOn: Date
  leaseToken: string | null
  leaseExpiresOn: Date | null
  deliveredOn: Date | null
  lastError: string | null
}

type ClaimedReconciliation = {
  input: PlaneOneShotReconciliationInput
  map: ReconciliationMap
  cycle: ReconciliationCycle
  revision: ReconciliationRevision
  outbox: ReconciliationOutbox
  leaseToken: string
  leaseExpiresOn: Date
  leaseMs: number
  now: Date
  config: PlaneAdapterConfig
  legacyRepair?: boolean
  biz41Recovery?: boolean
}

type PlaneObservedFields = {
  workspaceId: string | null
  projectId: string | null
  projectIdentifier: string | null
  intakeId: string | null
  correlationKey: string | null
  sequenceId: number | null
  title: string | null
  description: string | null
}

type SelectQueryLike = {
  from(table: unknown): SelectQueryLike
  leftJoin(table: unknown, condition: unknown): SelectQueryLike
  innerJoin(table: unknown, condition: unknown): SelectQueryLike
  where(condition: unknown): SelectQueryLike
  orderBy(...orders: unknown[]): SelectQueryLike
  limit(value: number): SelectQueryLike
  for(mode: 'update'): SelectQueryLike
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?:
      | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>
}

type UpdateQueryLike = {
  set(values: unknown): {
    where(condition: unknown): PromiseLike<Array<{affectedRows: number}>>
  }
}

type TransactionLike = {
  select(selection: unknown): SelectQueryLike
  update(table: unknown): UpdateQueryLike
}

export type OneShotDatabase = {
  select(selection: unknown): SelectQueryLike
  transaction<T>(callback: (trx: TransactionLike) => Promise<T>): Promise<T>
}

const isPositiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0

export const isPlaneOneShotDeadlock = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const mysqlError = error as {
    code?: unknown
    errno?: unknown
    sqlState?: unknown
    sqlstate?: unknown
    SQLSTATE?: unknown
  }
  return (
    mysqlError.code === 'ER_LOCK_DEADLOCK' ||
    mysqlError.errno === 1213 ||
    [mysqlError.sqlState, mysqlError.sqlstate, mysqlError.SQLSTATE].includes(
      '40001',
    )
  )
}

export const withPlaneOneShotDeadlockRetry = async <T>(
  operation: (attempt: number) => Promise<T>,
): Promise<T> => {
  for (
    let attempt = 1;
    attempt <= PLANE_ONE_SHOT_MAX_DEADLOCK_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (
        !isPlaneOneShotDeadlock(error) ||
        attempt === PLANE_ONE_SHOT_MAX_DEADLOCK_ATTEMPTS
      ) {
        throw error
      }
    }
  }
  throw new Error('Plane one-shot deadlock retry loop exhausted')
}

export const arePlaneOneShotWorkerRolesDisabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => BLOCKING_WORKER_FLAGS.every((flag) => environment[flag] !== 'true')

const requireInput = (value: string, name: string) => {
  if (!value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

const destinationMatchesConfig = (config: PlaneAdapterConfig) =>
  (config.apiBaseUrl === 'https://plane-dev.geep-fence.ts.net' ||
    config.apiBaseUrl ===
      'http://plane-app-api.plane.svc.cluster.local:8000') &&
  config.publicBaseUrl === 'https://plane-dev.geep-fence.ts.net' &&
  config.workspaceSlug === 'infinimind' &&
  config.workspaceId === 'e36dfd86-953a-4e33-a410-856208893bb9' &&
  config.projectId === '67726ee5-7d0c-4656-8bc8-b2f8a959d5da' &&
  config.projectIdentifier === 'BIZ'

const listField = (raw: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = raw[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return String(value)
    }
  }
  return null
}

const exactStringField = (raw: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = raw[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

const nestedId = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as {id?: unknown}).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

const observedFields = (workItem: PlaneWorkItem): PlaneObservedFields => {
  const raw = workItem.raw
  const project = raw.project
  const workspace = raw.workspace
  const intake = raw.intake
  const intakeIssue = raw.intake_issue ?? raw.intakeIssue
  const issue = raw.issue
  const issueDetail = raw.issue_detail

  const description =
    exactStringField(raw, ['description']) ??
    (issueDetail &&
    typeof issueDetail === 'object' &&
    !Array.isArray(issueDetail)
      ? exactStringField(issueDetail as Record<string, unknown>, [
          'description',
        ])
      : null)
  const describedCorrelation = description?.match(
    /(?:^|\n)Correlation:\s*([^\n\r]+)(?:\r?\n|$)/,
  )?.[1]

  return {
    workspaceId:
      listField(raw, ['workspace_id', 'workspaceId']) ?? nestedId(workspace),
    projectId: listField(raw, ['project_id', 'projectId']) ?? nestedId(project),
    projectIdentifier:
      listField(raw, ['project_identifier', 'projectIdentifier']) ??
      (project && typeof project === 'object' && !Array.isArray(project)
        ? listField(project as Record<string, unknown>, [
            'identifier',
            'project_identifier',
          ])
        : null),
    intakeId:
      listField(raw, [
        'intake_id',
        'intakeId',
        'intake_issue_id',
        'intakeIssueId',
      ]) ??
      nestedId(intake) ??
      nestedId(intakeIssue) ??
      (issue && typeof issue === 'object' && !Array.isArray(issue)
        ? listField(issue as Record<string, unknown>, ['intake_id', 'intakeId'])
        : null) ??
      (issue && typeof issue === 'object' && !Array.isArray(issue)
        ? nestedId((issue as Record<string, unknown>).intake)
        : null) ??
      (issueDetail &&
      typeof issueDetail === 'object' &&
      !Array.isArray(issueDetail)
        ? listField(issueDetail as Record<string, unknown>, [
            'intake_id',
            'intakeId',
          ])
        : null),
    correlationKey:
      listField(raw, [
        'correlation_key',
        'correlationKey',
        'create_correlation_key',
        'createCorrelationKey',
      ]) ??
      describedCorrelation ??
      null,
    sequenceId: (() => {
      const value = listField(raw, ['sequence_id', 'sequenceId'])
      if (!value) return null
      const parsed = Number(value)
      return Number.isSafeInteger(parsed) ? parsed : null
    })(),
    title:
      exactStringField(raw, ['name', 'title']) ??
      (issueDetail &&
      typeof issueDetail === 'object' &&
      !Array.isArray(issueDetail)
        ? exactStringField(issueDetail as Record<string, unknown>, [
            'name',
            'title',
          ])
        : null),
    description,
  }
}

const validateProviderObservation = ({
  workItem,
  input,
  config,
  intent,
  payload,
}: {
  workItem: PlaneWorkItem
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  intent: PlaneDefectIntent
  payload: ReconciliationOutbox['payload']
}) => {
  if (workItem.workItemId !== input.expectedWorkItemId) {
    throw new Error('Plane work-item identity did not match the exact target')
  }
  const observed = observedFields(workItem)
  if (
    observed.workspaceId !== config.workspaceId ||
    observed.projectId !== config.projectId ||
    (observed.projectIdentifier !== null &&
      observed.projectIdentifier !== config.projectIdentifier)
  ) {
    throw new Error(
      'Plane work item was not observed in the exact BIZ destination',
    )
  }
  if (observed.intakeId !== input.expectedIntakeId) {
    throw new Error('Plane Intake identity did not match the exact target')
  }
  if (observed.correlationKey !== input.expectedCorrelationKey) {
    throw new Error('Plane provider correlation did not match the exact target')
  }
  if (observed.title !== intent.title) {
    throw new Error('Plane work-item title did not match the Checkmate intent')
  }
  if (observed.description !== intent.description) {
    throw new Error(
      'Plane work-item description did not match the Checkmate intent',
    )
  }
  if (intent.correlationKey !== input.expectedCorrelationKey) {
    throw new Error('Plane correlation did not match the exact target')
  }
  if (
    payload.projectId !== input.projectId ||
    payload.runId !== input.runId ||
    payload.testId !== input.testId ||
    payload.testRunMapId === undefined
  ) {
    throw new Error('Plane outbox payload IDs did not match the exact target')
  }
  if (!workItem.stateId.trim()) {
    throw new Error('Plane work item did not return an authoritative state')
  }
  return observed
}

const claimable = (outbox: ReconciliationOutbox, now: Date) =>
  outbox.deliveryState === 'manual_attention' ||
  (['pending', 'retry_due', 'failed'].includes(outbox.deliveryState) &&
    outbox.availableOn.getTime() <= now.getTime()) ||
  (outbox.deliveryState === 'leased' &&
    outbox.leaseExpiresOn !== null &&
    outbox.leaseExpiresOn.getTime() <= now.getTime())

const selectRows = async <T>(query: SelectQueryLike): Promise<T[]> =>
  query as unknown as Promise<T[]>

const refusal = (
  input: PlaneOneShotReconciliationInput,
  reason: string,
  ids: {
    testRunMapId?: number
    defectCycleId?: number
    resultOutboxId?: number
  } = {},
): PlaneOneShotReconciliationResult => ({
  outcome: 'refused',
  projectId: input.projectId,
  runId: input.runId,
  testId: input.testId,
  reason,
  ...ids,
})

type OneShotCandidate = {
  testRunMapId: number
  resultRevisionId: number
  defectCycleId: number
  resultOutboxId: number
  providerStateId?: string
  legacyRepair?: boolean
}

type CandidateResolution =
  | {outcome: 'ready'; candidate: OneShotCandidate}
  | {outcome: 'refused'; result: PlaneOneShotReconciliationResult}

type DeliveredReplayResolution =
  | {outcome: 'none'}
  | {outcome: 'ready'; candidate: OneShotCandidate}
  | {outcome: 'refused'; result: PlaneOneShotReconciliationResult}

const hasProviderCallFence = (lastError: string | null) =>
  Boolean(
    lastError?.startsWith(PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER) ||
      lastError?.startsWith(PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER) ||
      lastError?.startsWith(PLANE_ONE_SHOT_FINALIZATION_FAILURE_MARKER),
  )

/**
 * Find a completed create event by its historical identity before looking
 * for an active cycle. A delivered cycle may legitimately be ready for
 * retest, validated, or inactive, so replay must not depend on active-marker
 * or current-map gates. The locked transaction repeats every predicate.
 */
const resolveDeliveredReplay = async ({
  input,
  config,
  database,
}: {
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  database: OneShotDatabase
}): Promise<DeliveredReplayResolution> => {
  const cycles = await selectRows<ReconciliationCycle>(
    database
      .select({
        defectCycleId: defectCycles.defectCycleId,
        testRunMapId: defectCycles.testRunMapId,
        projectId: defectCycles.projectId,
        runId: defectCycles.runId,
        testId: defectCycles.testId,
        activeMarker: defectCycles.activeMarker,
        state: defectCycles.state,
        currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
        provider: defectCycles.provider,
        providerWorkspaceId: defectCycles.providerWorkspaceId,
        providerProjectId: defectCycles.providerProjectId,
        providerWorkItemId: defectCycles.providerWorkItemId,
        providerIntakeId: defectCycles.providerIntakeId,
        providerStateId: defectCycles.providerStateId,
        providerSequenceId: defectCycles.providerSequenceId,
        providerUrl: defectCycles.providerUrl,
        createCorrelationKey: defectCycles.createCorrelationKey,
      })
      .from(defectCycles)
      .innerJoin(
        testRunMap,
        eq(testRunMap.testRunMapId, defectCycles.testRunMapId),
      )
      .innerJoin(runs, eq(runs.runId, defectCycles.runId))
      .innerJoin(tests, eq(tests.testId, defectCycles.testId))
      .where(
        and(
          eq(defectCycles.projectId, input.projectId),
          eq(defectCycles.runId, input.runId),
          eq(defectCycles.testId, input.testId),
          eq(testRunMap.projectId, input.projectId),
          eq(runs.projectId, input.projectId),
          eq(tests.projectId, input.projectId),
          eq(defectCycles.provider, PLANE_PROVIDER),
          eq(defectCycles.providerWorkspaceId, config.workspaceId),
          eq(defectCycles.providerProjectId, config.projectId),
          eq(defectCycles.createCorrelationKey, input.expectedCorrelationKey),
        ),
      )
      .orderBy(asc(defectCycles.defectCycleId))
      .limit(2),
  )
  if (cycles.length === 0) return {outcome: 'none'}
  if (cycles.length > 1) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'More than one historical Plane cycle matched the exact replay tuple',
      ),
    }
  }
  const cycle = cycles[0]

  const outboxes = await selectRows<ReconciliationOutbox>(
    database
      .select({
        resultOutboxId: resultOutbox.resultOutboxId,
        eventKey: resultOutbox.eventKey,
        eventType: resultOutbox.eventType,
        aggregateType: resultOutbox.aggregateType,
        aggregateId: resultOutbox.aggregateId,
        resultRevisionId: resultOutbox.resultRevisionId,
        payload: resultOutbox.payload,
        deliveryState: resultOutbox.deliveryState,
        availableOn: resultOutbox.availableOn,
        leaseToken: resultOutbox.leaseToken,
        leaseExpiresOn: resultOutbox.leaseExpiresOn,
        deliveredOn: resultOutbox.deliveredOn,
        lastError: resultOutbox.lastError,
      })
      .from(resultOutbox)
      .where(
        and(
          eq(resultOutbox.eventType, CREATE_EVENT_TYPE),
          eq(resultOutbox.aggregateType, 'defect_cycle'),
          eq(resultOutbox.aggregateId, cycle.defectCycleId),
          eq(resultOutbox.deliveryState, 'delivered'),
        ),
      )
      .orderBy(asc(resultOutbox.resultOutboxId))
      .limit(2),
  )
  if (outboxes.length === 0) return {outcome: 'none'}
  if (outboxes.length > 1) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'More than one delivered Plane create outbox matched the exact replay tuple',
        {
          testRunMapId: cycle.testRunMapId,
          defectCycleId: cycle.defectCycleId,
        },
      ),
    }
  }
  const outbox = outboxes[0]
  const intent = outbox.payload.planeDefectIntent
  if (
    cycle.providerWorkItemId !== input.expectedWorkItemId ||
    cycle.providerIntakeId !== input.expectedIntakeId ||
    !outbox.deliveredOn ||
    outbox.leaseToken !== null ||
    outbox.leaseExpiresOn !== null ||
    outbox.eventKey !== CREATE_EVENT_KEY(cycle.defectCycleId) ||
    outbox.aggregateId !== cycle.defectCycleId ||
    outbox.payload.resultRevisionId !== outbox.resultRevisionId ||
    outbox.payload.testRunMapId !== cycle.testRunMapId ||
    outbox.payload.projectId !== input.projectId ||
    outbox.payload.runId !== input.runId ||
    outbox.payload.testId !== input.testId ||
    outbox.payload.defectCycleId !== cycle.defectCycleId ||
    !intent?.create ||
    intent.defectCycleId !== cycle.defectCycleId ||
    intent.correlationKey !== input.expectedCorrelationKey
  ) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'Delivered historical Plane identity or tuple did not match the exact replay target',
        {
          testRunMapId: cycle.testRunMapId,
          defectCycleId: cycle.defectCycleId,
          resultOutboxId: outbox.resultOutboxId,
        },
      ),
    }
  }

  if (hasProviderCallFence(outbox.lastError)) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'A prior provider call started or database finalization failed; explicit operator reconciliation is required',
        {
          testRunMapId: cycle.testRunMapId,
          defectCycleId: cycle.defectCycleId,
          resultOutboxId: outbox.resultOutboxId,
        },
      ),
    }
  }

  if (!cycle.providerStateId?.trim()) {
    if (
      cycle.providerStateId === null &&
      cycle.activeMarker === 1 &&
      cycle.state === 'intake_open' &&
      outbox.lastError === null
    ) {
      return {
        outcome: 'ready',
        candidate: {
          testRunMapId: cycle.testRunMapId,
          resultRevisionId: outbox.resultRevisionId,
          defectCycleId: cycle.defectCycleId,
          resultOutboxId: outbox.resultOutboxId,
          legacyRepair: true,
        },
      }
    }
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'Delivered historical Plane identity or tuple did not contain a repairable provider state',
        {
          testRunMapId: cycle.testRunMapId,
          defectCycleId: cycle.defectCycleId,
          resultOutboxId: outbox.resultOutboxId,
        },
      ),
    }
  }

  return {
    outcome: 'ready',
    candidate: {
      testRunMapId: cycle.testRunMapId,
      resultRevisionId: outbox.resultRevisionId,
      defectCycleId: cycle.defectCycleId,
      resultOutboxId: outbox.resultOutboxId,
      providerStateId: cycle.providerStateId ?? undefined,
    },
  }
}

/**
 * Verify the map and revision identity for a delivered replay in a fresh,
 * read-only transaction. Historical cycles may be inactive or on a later
 * lifecycle state, but they must still belong to the exact requested map,
 * run, test, and project before verify-only can report a match.
 */
const validateDeliveredReplayIdentity = async ({
  input,
  candidate,
  database,
}: {
  input: PlaneOneShotReconciliationInput
  candidate: OneShotCandidate
  database: OneShotDatabase
}): Promise<PlaneOneShotReconciliationResult | null> => {
  const validation = await database.transaction(async (trx) => {
    const maps = await selectRows<ReconciliationMap>(
      trx
        .select({
          testRunMapId: testRunMap.testRunMapId,
          projectId: testRunMap.projectId,
          testProjectId: tests.projectId,
          runId: testRunMap.runId,
          testId: testRunMap.testId,
          isIncluded: testRunMap.isIncluded,
          currentResultRevisionId: testRunMap.currentResultRevisionId,
          runProjectId: runs.projectId,
          runStatus: runs.status,
        })
        .from(testRunMap)
        .leftJoin(runs, eq(runs.runId, testRunMap.runId))
        .leftJoin(tests, eq(tests.testId, testRunMap.testId))
        .where(eq(testRunMap.testRunMapId, candidate.testRunMapId))
        .limit(2),
    )
    const [revision] = await selectRows<ReconciliationRevision>(
      trx
        .select({
          resultRevisionId: resultRevisions.resultRevisionId,
          testRunMapId: resultRevisions.testRunMapId,
          projectId: resultRevisions.projectId,
          runId: resultRevisions.runId,
          testId: resultRevisions.testId,
        })
        .from(resultRevisions)
        .where(eq(resultRevisions.resultRevisionId, candidate.resultRevisionId))
        .limit(2),
    )
    const map = maps[0]
    const valid =
      maps.length === 1 &&
      map.testRunMapId === candidate.testRunMapId &&
      map.projectId === input.projectId &&
      map.testProjectId === input.projectId &&
      map.runId === input.runId &&
      map.testId === input.testId &&
      revision?.resultRevisionId === candidate.resultRevisionId &&
      revision.testRunMapId === candidate.testRunMapId &&
      revision.projectId === input.projectId &&
      revision.runId === input.runId &&
      revision.testId === input.testId
    return valid
      ? null
      : refusal(
          input,
          'Historical replay map or result revision did not match the exact target',
          {
            testRunMapId: candidate.testRunMapId,
            defectCycleId: candidate.defectCycleId,
            resultOutboxId: candidate.resultOutboxId,
          },
        )
  })
  return validation
}

const validateLegacyDeliveredReplay = async ({
  input,
  config,
  candidate,
  database,
}: {
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  candidate: OneShotCandidate
  database: OneShotDatabase
}): Promise<
  | {
      map: ReconciliationMap
      cycle: ReconciliationCycle
      revision: ReconciliationRevision
      outbox: ReconciliationOutbox
      intent: PlaneDefectIntent
    }
  | PlaneOneShotReconciliationResult
> => {
  const preflight = await database.transaction(async (trx) => {
    const [map] = await selectRows<ReconciliationMap>(
      trx
        .select({
          testRunMapId: testRunMap.testRunMapId,
          projectId: testRunMap.projectId,
          testProjectId: tests.projectId,
          runId: testRunMap.runId,
          testId: testRunMap.testId,
          isIncluded: testRunMap.isIncluded,
          currentResultRevisionId: testRunMap.currentResultRevisionId,
          runProjectId: runs.projectId,
          runStatus: runs.status,
        })
        .from(testRunMap)
        .leftJoin(runs, eq(runs.runId, testRunMap.runId))
        .leftJoin(tests, eq(tests.testId, testRunMap.testId))
        .where(eq(testRunMap.testRunMapId, candidate.testRunMapId))
        .limit(2),
    )
    const [cycle] = await selectRows<ReconciliationCycle>(
      trx
        .select({
          defectCycleId: defectCycles.defectCycleId,
          testRunMapId: defectCycles.testRunMapId,
          projectId: defectCycles.projectId,
          runId: defectCycles.runId,
          testId: defectCycles.testId,
          activeMarker: defectCycles.activeMarker,
          state: defectCycles.state,
          currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
          provider: defectCycles.provider,
          providerWorkspaceId: defectCycles.providerWorkspaceId,
          providerProjectId: defectCycles.providerProjectId,
          providerWorkItemId: defectCycles.providerWorkItemId,
          providerIntakeId: defectCycles.providerIntakeId,
          providerStateId: defectCycles.providerStateId,
          providerSequenceId: defectCycles.providerSequenceId,
          providerUrl: defectCycles.providerUrl,
          createCorrelationKey: defectCycles.createCorrelationKey,
        })
        .from(defectCycles)
        .where(eq(defectCycles.defectCycleId, candidate.defectCycleId))
        .limit(2),
    )
    const [outbox] = await selectRows<ReconciliationOutbox>(
      trx
        .select({
          resultOutboxId: resultOutbox.resultOutboxId,
          eventKey: resultOutbox.eventKey,
          eventType: resultOutbox.eventType,
          aggregateType: resultOutbox.aggregateType,
          aggregateId: resultOutbox.aggregateId,
          resultRevisionId: resultOutbox.resultRevisionId,
          payload: resultOutbox.payload,
          deliveryState: resultOutbox.deliveryState,
          availableOn: resultOutbox.availableOn,
          leaseToken: resultOutbox.leaseToken,
          leaseExpiresOn: resultOutbox.leaseExpiresOn,
          deliveredOn: resultOutbox.deliveredOn,
          lastError: resultOutbox.lastError,
        })
        .from(resultOutbox)
        .where(eq(resultOutbox.resultOutboxId, candidate.resultOutboxId))
        .limit(2),
    )
    const [revision] = await selectRows<ReconciliationRevision>(
      trx
        .select({
          resultRevisionId: resultRevisions.resultRevisionId,
          testRunMapId: resultRevisions.testRunMapId,
          projectId: resultRevisions.projectId,
          runId: resultRevisions.runId,
          testId: resultRevisions.testId,
        })
        .from(resultRevisions)
        .where(eq(resultRevisions.resultRevisionId, candidate.resultRevisionId))
        .limit(2),
    )
    const intent = outbox?.payload.planeDefectIntent
    const valid = Boolean(
      map &&
        cycle &&
        outbox &&
        revision &&
        intent?.create &&
        map.testRunMapId === candidate.testRunMapId &&
        map.projectId === input.projectId &&
        map.testProjectId === input.projectId &&
        map.runId === input.runId &&
        map.testId === input.testId &&
        map.isIncluded === true &&
        map.currentResultRevisionId === candidate.resultRevisionId &&
        map.runProjectId === input.projectId &&
        map.runStatus === 'Active' &&
        cycle.defectCycleId === candidate.defectCycleId &&
        cycle.testRunMapId === candidate.testRunMapId &&
        cycle.projectId === input.projectId &&
        cycle.runId === input.runId &&
        cycle.testId === input.testId &&
        cycle.activeMarker === 1 &&
        cycle.state === 'intake_open' &&
        cycle.currentEvidenceRevisionId === candidate.resultRevisionId &&
        cycle.provider === PLANE_PROVIDER &&
        cycle.providerWorkspaceId === config.workspaceId &&
        cycle.providerProjectId === config.projectId &&
        cycle.providerWorkItemId === input.expectedWorkItemId &&
        cycle.providerIntakeId === input.expectedIntakeId &&
        cycle.providerStateId === null &&
        cycle.createCorrelationKey === input.expectedCorrelationKey &&
        revision.resultRevisionId === candidate.resultRevisionId &&
        revision.testRunMapId === candidate.testRunMapId &&
        revision.projectId === input.projectId &&
        revision.runId === input.runId &&
        revision.testId === input.testId &&
        outbox.resultOutboxId === candidate.resultOutboxId &&
        outbox.eventKey === CREATE_EVENT_KEY(candidate.defectCycleId) &&
        outbox.eventType === CREATE_EVENT_TYPE &&
        outbox.aggregateType === 'defect_cycle' &&
        outbox.aggregateId === candidate.defectCycleId &&
        outbox.resultRevisionId === candidate.resultRevisionId &&
        outbox.deliveryState === 'delivered' &&
        outbox.deliveredOn !== null &&
        outbox.leaseToken === null &&
        outbox.leaseExpiresOn === null &&
        outbox.lastError === null &&
        outbox.payload.resultRevisionId === candidate.resultRevisionId &&
        outbox.payload.testRunMapId === candidate.testRunMapId &&
        outbox.payload.projectId === input.projectId &&
        outbox.payload.runId === input.runId &&
        outbox.payload.testId === input.testId &&
        outbox.payload.defectCycleId === candidate.defectCycleId &&
        intent.defectCycleId === candidate.defectCycleId &&
        intent.correlationKey === input.expectedCorrelationKey,
    )
    if (!valid || !map || !cycle || !outbox || !revision || !intent?.create) {
      return refusal(
        input,
        'Legacy delivered Plane repair preconditions did not match the exact target',
        {
          testRunMapId: candidate.testRunMapId,
          defectCycleId: candidate.defectCycleId,
          resultOutboxId: candidate.resultOutboxId,
        },
      )
    }
    return {map, cycle, revision, outbox, intent}
  })
  return preflight
}

/**
 * Resolve candidate identifiers without locks. The locked transaction repeats
 * these lookups in map -> cycle -> outbox -> revision order, so stale reads
 * can only produce a refusal and never a partial write.
 */
const resolveCandidate = async ({
  input,
  database,
}: {
  input: PlaneOneShotReconciliationInput
  database: OneShotDatabase
}): Promise<CandidateResolution> => {
  const maps = await selectRows<ReconciliationMap>(
    database
      .select({
        testRunMapId: testRunMap.testRunMapId,
        projectId: testRunMap.projectId,
        testProjectId: tests.projectId,
        runId: testRunMap.runId,
        testId: testRunMap.testId,
        isIncluded: testRunMap.isIncluded,
        currentResultRevisionId: testRunMap.currentResultRevisionId,
        runProjectId: runs.projectId,
        runStatus: runs.status,
      })
      .from(testRunMap)
      .leftJoin(runs, eq(runs.runId, testRunMap.runId))
      .leftJoin(tests, eq(tests.testId, testRunMap.testId))
      .where(
        and(
          eq(testRunMap.projectId, input.projectId),
          eq(testRunMap.runId, input.runId),
          eq(testRunMap.testId, input.testId),
        ),
      )
      .orderBy(asc(testRunMap.testRunMapId))
      .limit(2),
  )
  if (maps.length !== 1) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        maps.length === 0
          ? 'No exact testRunMap matched the target'
          : 'More than one exact testRunMap matched the target',
      ),
    }
  }
  const map = maps[0]
  if (map.testProjectId !== input.projectId) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'Target test did not belong to the exact project',
        {
          testRunMapId: map.testRunMapId,
        },
      ),
    }
  }
  if (map.currentResultRevisionId === null) {
    return {
      outcome: 'refused',
      result: refusal(input, 'Target map had no current result revision', {
        testRunMapId: map.testRunMapId,
      }),
    }
  }

  const cycles = await selectRows<Pick<ReconciliationCycle, 'defectCycleId'>>(
    database
      .select({defectCycleId: defectCycles.defectCycleId})
      .from(defectCycles)
      .where(
        and(
          eq(defectCycles.testRunMapId, map.testRunMapId),
          eq(defectCycles.activeMarker, 1),
        ),
      )
      .orderBy(asc(defectCycles.defectCycleId))
      .limit(2),
  )
  if (cycles.length !== 1) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        cycles.length === 0
          ? 'No active defect cycle matched the exact map'
          : 'More than one active defect cycle matched the exact map',
        {testRunMapId: map.testRunMapId},
      ),
    }
  }
  const cycle = cycles[0]

  const outboxes = await selectRows<
    Pick<ReconciliationOutbox, 'resultOutboxId'>
  >(
    database
      .select({resultOutboxId: resultOutbox.resultOutboxId})
      .from(resultOutbox)
      .where(
        and(
          eq(resultOutbox.eventType, CREATE_EVENT_TYPE),
          eq(resultOutbox.aggregateType, 'defect_cycle'),
          eq(resultOutbox.aggregateId, cycle.defectCycleId),
          eq(resultOutbox.resultRevisionId, map.currentResultRevisionId),
        ),
      )
      .orderBy(asc(resultOutbox.resultOutboxId))
      .limit(2),
  )
  if (outboxes.length !== 1) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        outboxes.length === 0
          ? 'No exact Plane create outbox event matched the active cycle'
          : 'More than one exact Plane create outbox event matched the active cycle',
        {testRunMapId: map.testRunMapId, defectCycleId: cycle.defectCycleId},
      ),
    }
  }

  return {
    outcome: 'ready',
    candidate: {
      testRunMapId: map.testRunMapId,
      resultRevisionId: map.currentResultRevisionId,
      defectCycleId: cycle.defectCycleId,
      resultOutboxId: outboxes[0].resultOutboxId,
    },
  }
}

const loadAndClaim = async ({
  input,
  config,
  now,
  leaseMs,
  database,
}: {
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  now: Date
  leaseMs: number
  database: OneShotDatabase
}): Promise<
  | {outcome: 'claimed'; claim: ClaimedReconciliation}
  | {outcome: 'matched'; claim: ClaimedReconciliation}
  | {outcome: 'refused'; result: PlaneOneShotReconciliationResult}
> => {
  const isBiz41Recovery = input.recoverBiz41ProviderObservationMismatch === true
  if (isBiz41Recovery && !recoveryInputMatchesIncident(input)) {
    return {
      outcome: 'refused',
      result: refusal(
        input,
        'BIZ-41 recovery input did not match the exact recorded incident identity or payload digest',
      ),
    }
  }
  if (isBiz41Recovery && !destinationMatchesConfig(config)) {
    return {
      outcome: 'refused',
      result: refusal(input, 'Plane adapter destination was not the exact BIZ destination'),
    }
  }
  const recoveryCandidate: OneShotCandidate = {
    testRunMapId: BIZ41_RECOVERY.testRunMapId,
    resultRevisionId: BIZ41_RECOVERY.resultRevisionId,
    defectCycleId: BIZ41_RECOVERY.defectCycleId,
    resultOutboxId: BIZ41_RECOVERY.resultOutboxId,
    legacyRepair: true,
  }
  const replay = isBiz41Recovery
    ? ({outcome: 'none'} as const)
    : await resolveDeliveredReplay({input, config, database})
  if (replay.outcome === 'refused') return replay
  const replayCandidate = replay.outcome === 'ready' ? replay.candidate : null
  const resolved = isBiz41Recovery
    ? {outcome: 'ready' as const, candidate: recoveryCandidate}
    : replayCandidate
    ? {outcome: 'ready' as const, candidate: replayCandidate}
    : await resolveCandidate({input, database})
  if (resolved.outcome === 'refused') return resolved
  const isLegacyRepair = isBiz41Recovery || replayCandidate?.legacyRepair === true
  const isReplay = replayCandidate !== null && !isLegacyRepair

  const claimTransaction = () =>
    database.transaction(async (trx) => {
      // Lock testRunMap before defectCycle, matching saveHumanResult's
      // established human-save order. The candidate IDs came from an unlocked
      // read; every cardinality and scope predicate is repeated below while the
      // rows are held. The normal worker's outbox lease is fenced independently
      // below, so a lock-order/deadlock failure is retried only by the bounded
      // MySQL deadlock helper with a fresh transaction and lease token.
      const maps = await selectRows<ReconciliationMap>(
        trx
          .select({
            testRunMapId: testRunMap.testRunMapId,
            projectId: testRunMap.projectId,
            testProjectId: tests.projectId,
            runId: testRunMap.runId,
            testId: testRunMap.testId,
            isIncluded: testRunMap.isIncluded,
            currentResultRevisionId: testRunMap.currentResultRevisionId,
            runProjectId: runs.projectId,
            runStatus: runs.status,
          })
          .from(testRunMap)
          .leftJoin(runs, eq(runs.runId, testRunMap.runId))
          .leftJoin(tests, eq(tests.testId, testRunMap.testId))
          .where(
            and(
              eq(testRunMap.projectId, input.projectId),
              eq(testRunMap.runId, input.runId),
              eq(testRunMap.testId, input.testId),
              ...(isBiz41Recovery
                ? [eq(testRunMap.testRunMapId, BIZ41_RECOVERY.testRunMapId)]
                : []),
            ),
          )
          .orderBy(asc(testRunMap.testRunMapId))
          .limit(2)
          .for('update'),
      )
      if (maps.length !== 1) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            maps.length === 0
              ? 'No exact testRunMap matched the target during lock'
              : 'More than one exact testRunMap matched the target during lock',
          ),
        }
      }
      const map = maps[0]

      const cycles = await selectRows<ReconciliationCycle>(
        trx
          .select({
            defectCycleId: defectCycles.defectCycleId,
            testRunMapId: defectCycles.testRunMapId,
            projectId: defectCycles.projectId,
            runId: defectCycles.runId,
            testId: defectCycles.testId,
            activeMarker: defectCycles.activeMarker,
            state: defectCycles.state,
            currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
            provider: defectCycles.provider,
            providerWorkspaceId: defectCycles.providerWorkspaceId,
            providerProjectId: defectCycles.providerProjectId,
            providerWorkItemId: defectCycles.providerWorkItemId,
            providerIntakeId: defectCycles.providerIntakeId,
            providerStateId: defectCycles.providerStateId,
            providerSequenceId: defectCycles.providerSequenceId,
            providerUrl: defectCycles.providerUrl,
            createCorrelationKey: defectCycles.createCorrelationKey,
          })
          .from(defectCycles)
          .where(
            isReplay || isBiz41Recovery
              ? eq(defectCycles.defectCycleId, resolved.candidate.defectCycleId)
              : and(
                  eq(
                    defectCycles.testRunMapId,
                    resolved.candidate.testRunMapId,
                  ),
                  eq(defectCycles.activeMarker, 1),
                ),
          )
          .orderBy(asc(defectCycles.defectCycleId))
          .limit(2)
          .for('update'),
      )
      if (cycles.length !== 1) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            cycles.length === 0
              ? 'No active defect cycle matched the exact map during lock'
              : 'More than one active defect cycle matched the exact map during lock',
            {testRunMapId: resolved.candidate.testRunMapId},
          ),
        }
      }
      const cycle = cycles[0]

      const outboxSelection = {
        resultOutboxId: resultOutbox.resultOutboxId,
        eventKey: resultOutbox.eventKey,
        eventType: resultOutbox.eventType,
        aggregateType: resultOutbox.aggregateType,
        aggregateId: resultOutbox.aggregateId,
        resultRevisionId: resultOutbox.resultRevisionId,
        payload: resultOutbox.payload,
        deliveryState: resultOutbox.deliveryState,
        availableOn: resultOutbox.availableOn,
        leaseToken: resultOutbox.leaseToken,
        leaseExpiresOn: resultOutbox.leaseExpiresOn,
        deliveredOn: resultOutbox.deliveredOn,
        lastError: resultOutbox.lastError,
        ...(isBiz41Recovery
          ? {
              payloadDigest: sql<string>`SHA2(CAST(${resultOutbox.payload} AS CHAR), 256)`,
            }
          : {}),
      }
      const outboxes = await selectRows<ReconciliationOutbox>(
        trx
          .select(outboxSelection)
          .from(resultOutbox)
          .where(
            and(
              eq(resultOutbox.eventType, CREATE_EVENT_TYPE),
              eq(resultOutbox.aggregateType, 'defect_cycle'),
              eq(resultOutbox.aggregateId, resolved.candidate.defectCycleId),
              eq(
                resultOutbox.resultRevisionId,
                resolved.candidate.resultRevisionId,
              ),
              ...(isReplay
                ? [
                    eq(
                      resultOutbox.resultOutboxId,
                      resolved.candidate.resultOutboxId,
                    ),
                  ]
                : []),
              ...(isBiz41Recovery
                ? [
                    eq(
                      resultOutbox.resultOutboxId,
                      resolved.candidate.resultOutboxId,
                    ),
                  ]
                : []),
            ),
          )
          .limit(2)
          .for('update'),
      )
      if (outboxes.length !== 1) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            outboxes.length === 0
              ? 'Exact Plane create outbox row disappeared during lock'
              : 'More than one exact Plane create outbox row matched during lock',
            {
              testRunMapId: resolved.candidate.testRunMapId,
              defectCycleId: resolved.candidate.defectCycleId,
              resultOutboxId: resolved.candidate.resultOutboxId,
            },
          ),
        }
      }
      const outbox = outboxes[0]

      if (outbox.resultOutboxId !== resolved.candidate.resultOutboxId) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Exact Plane create outbox identity changed during lock',
            {
              testRunMapId: resolved.candidate.testRunMapId,
              defectCycleId: resolved.candidate.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      const recoveryOriginalFence =
        isBiz41Recovery &&
        outbox.lastError === PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER
      if (hasProviderCallFence(outbox.lastError) && !recoveryOriginalFence) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'A prior provider call started or database finalization failed; explicit operator reconciliation is required',
            {
              testRunMapId: resolved.candidate.testRunMapId,
              defectCycleId: resolved.candidate.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      const [revision] = await selectRows<ReconciliationRevision>(
        trx
          .select({
            resultRevisionId: resultRevisions.resultRevisionId,
            testRunMapId: resultRevisions.testRunMapId,
            projectId: resultRevisions.projectId,
            runId: resultRevisions.runId,
            testId: resultRevisions.testId,
          })
          .from(resultRevisions)
          .where(
            eq(
              resultRevisions.resultRevisionId,
              resolved.candidate.resultRevisionId,
            ),
          )
          .limit(1)
          .for('update'),
      )

      if (
        outbox.eventType !== CREATE_EVENT_TYPE ||
        outbox.aggregateType !== 'defect_cycle' ||
        outbox.aggregateId !== resolved.candidate.defectCycleId ||
        outbox.resultRevisionId !== resolved.candidate.resultRevisionId ||
        cycle.defectCycleId !== resolved.candidate.defectCycleId ||
        cycle.testRunMapId !== resolved.candidate.testRunMapId ||
        map.testRunMapId !== resolved.candidate.testRunMapId ||
        map.projectId !== input.projectId ||
        map.testProjectId !== input.projectId ||
        map.runId !== input.runId ||
        map.testId !== input.testId ||
        (!isReplay &&
          (map.currentResultRevisionId !==
            resolved.candidate.resultRevisionId ||
            map.isIncluded !== true ||
            map.runProjectId !== input.projectId ||
            map.runStatus !== 'Active'))
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Target map, cycle, or outbox scope changed during lock',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      if (
        cycle.projectId !== input.projectId ||
        cycle.runId !== input.runId ||
        cycle.testId !== input.testId ||
        cycle.provider !== PLANE_PROVIDER ||
        cycle.providerWorkspaceId !== config.workspaceId ||
        cycle.providerProjectId !== config.projectId ||
        cycle.createCorrelationKey !== input.expectedCorrelationKey ||
        (!isReplay &&
          ![
            'intake_pending',
            'manual_attention',
            'intake_open',
            'work_item_open',
          ].includes(cycle.state))
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Active defect cycle did not match the exact Plane destination, correlation, or lifecycle state',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
            },
          ),
        }
      }

      if (
        isBiz41Recovery &&
        (cycle.defectCycleId !== BIZ41_RECOVERY.defectCycleId ||
          cycle.state !== 'manual_attention' ||
          cycle.activeMarker !== 1 ||
          cycle.providerWorkItemId !== BIZ41_RECOVERY.providerWorkItemId ||
          cycle.providerIntakeId !== BIZ41_RECOVERY.providerIntakeId ||
          cycle.providerStateId !== null ||
          cycle.providerSequenceId !== BIZ41_RECOVERY.providerSequenceId)
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'BIZ-41 recovery cycle identity, state, or provider fence did not match',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      if (
        cycle.providerWorkItemId !== null &&
        cycle.providerWorkItemId !== input.expectedWorkItemId
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Existing provider work-item identity conflicted before GET',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }
      if (
        cycle.providerIntakeId !== null &&
        cycle.providerIntakeId !== input.expectedIntakeId
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Existing provider Intake identity conflicted before GET',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      if (
        !revision ||
        (!isReplay &&
          cycle.currentEvidenceRevisionId !== map.currentResultRevisionId) ||
        revision.testRunMapId !== map.testRunMapId ||
        revision.projectId !== input.projectId ||
        revision.runId !== input.runId ||
        revision.testId !== input.testId
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Current result revision did not match the exact active cycle',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      const intent = outbox.payload.planeDefectIntent
      if (
        outbox.eventKey !== CREATE_EVENT_KEY(cycle.defectCycleId) ||
        outbox.payload.resultRevisionId !== revision.resultRevisionId ||
        outbox.payload.testRunMapId !== map.testRunMapId ||
        outbox.payload.projectId !== input.projectId ||
        outbox.payload.runId !== input.runId ||
        outbox.payload.testId !== input.testId ||
        outbox.payload.defectCycleId !== cycle.defectCycleId ||
        !intent?.create ||
        intent.defectCycleId !== cycle.defectCycleId ||
        intent.correlationKey !== input.expectedCorrelationKey
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Plane create outbox tuple did not match the exact cycle and revision',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }
      if (
        isBiz41Recovery &&
        (outbox.deliveryState !== 'delivered' ||
          outbox.deliveredOn === null ||
          outbox.leaseToken !== null ||
          outbox.leaseExpiresOn !== null ||
          outbox.lastError !== PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER ||
          outbox.payloadDigest !== BIZ41_RECOVERY.payloadDigest)
      ) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'BIZ-41 recovery outbox identity, payload, or original marker did not match',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }
      if (!destinationMatchesConfig(config)) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Plane adapter destination was not the exact BIZ destination',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      const claim: ClaimedReconciliation = {
        input,
        map,
        cycle: {...cycle, state: isReplay ? cycle.state : 'manual_attention'},
        revision,
        outbox,
        leaseToken: randomUUID(),
        leaseExpiresOn: new Date(now.getTime() + leaseMs),
        leaseMs,
        now,
        config,
        legacyRepair: isLegacyRepair,
        biz41Recovery: isBiz41Recovery,
      }
      if (isReplay) {
        if (
          outbox.deliveryState !== 'delivered' ||
          !outbox.deliveredOn ||
          outbox.leaseToken !== null ||
          outbox.leaseExpiresOn !== null ||
          cycle.providerWorkItemId !== input.expectedWorkItemId ||
          cycle.providerIntakeId !== input.expectedIntakeId ||
          !cycle.providerStateId?.trim()
        ) {
          return {
            outcome: 'refused' as const,
            result: refusal(
              input,
              'Delivered historical Plane identity or state changed during lock',
              {
                testRunMapId: map.testRunMapId,
                defectCycleId: cycle.defectCycleId,
                resultOutboxId: outbox.resultOutboxId,
              },
            ),
          }
        }
        return {outcome: 'matched' as const, claim}
      }
      if (outbox.deliveryState === 'delivered') {
        if (isLegacyRepair) {
          if (isBiz41Recovery) {
            const fenceUpdate = await trx
              .update(resultOutbox)
              .set({lastError: PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER})
              .where(
                and(
                  eq(resultOutbox.resultOutboxId, outbox.resultOutboxId),
                  eq(resultOutbox.eventKey, outbox.eventKey),
                  eq(resultOutbox.deliveryState, 'delivered'),
                  isNull(resultOutbox.leaseToken),
                  isNull(resultOutbox.leaseExpiresOn),
                  eq(
                    resultOutbox.lastError,
                    PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
                  ),
                  sql`${resultOutbox.deliveredOn} is not null`,
                ),
              )
            if (fenceUpdate[0].affectedRows !== 1) {
              throw new Error('BIZ-41 recovery marker CAS was lost')
            }
            return {outcome: 'claimed' as const, claim}
          }
          if (
            cycle.state !== 'intake_open' ||
            cycle.activeMarker !== 1 ||
            cycle.providerStateId !== null ||
            cycle.providerWorkItemId !== input.expectedWorkItemId ||
            cycle.providerIntakeId !== input.expectedIntakeId ||
            outbox.deliveredOn === null ||
            outbox.leaseToken !== null ||
            outbox.leaseExpiresOn !== null ||
            outbox.lastError !== null
          ) {
            return {
              outcome: 'refused' as const,
              result: refusal(
                input,
                'Legacy delivered Plane repair identity or fence changed during lock',
                {
                  testRunMapId: map.testRunMapId,
                  defectCycleId: cycle.defectCycleId,
                  resultOutboxId: outbox.resultOutboxId,
                },
              ),
            }
          }

          const cycleReservation = await trx
            .update(defectCycles)
            .set({state: 'manual_attention'})
            .where(
              and(
                eq(defectCycles.defectCycleId, cycle.defectCycleId),
                eq(defectCycles.activeMarker, 1),
                eq(defectCycles.state, 'intake_open'),
                eq(
                  defectCycles.currentEvidenceRevisionId,
                  revision.resultRevisionId,
                ),
                eq(
                  defectCycles.createCorrelationKey,
                  input.expectedCorrelationKey,
                ),
                isNull(defectCycles.providerStateId),
                eq(
                  defectCycles.providerWorkItemId,
                  input.expectedWorkItemId,
                ),
                eq(defectCycles.providerIntakeId, input.expectedIntakeId),
              ),
            )
          if (cycleReservation[0].affectedRows !== 1) {
            return {
              outcome: 'refused' as const,
              result: refusal(
                input,
                'Legacy Plane cycle reservation lost its lifecycle fence',
                {
                  testRunMapId: map.testRunMapId,
                  defectCycleId: cycle.defectCycleId,
                  resultOutboxId: outbox.resultOutboxId,
                },
              ),
            }
          }

          const fenceUpdate = await trx
            .update(resultOutbox)
            .set({lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER})
            .where(
              and(
                eq(resultOutbox.resultOutboxId, outbox.resultOutboxId),
                eq(resultOutbox.eventKey, outbox.eventKey),
                eq(resultOutbox.deliveryState, 'delivered'),
                isNull(resultOutbox.leaseToken),
                isNull(resultOutbox.leaseExpiresOn),
                isNull(resultOutbox.lastError),
                sql`${resultOutbox.deliveredOn} is not null`,
              ),
            )
          if (fenceUpdate[0].affectedRows !== 1) {
            throw new Error('Legacy Plane provider-call fence was lost')
          }
          return {outcome: 'claimed' as const, claim}
        }
        if (
          cycle.state === 'work_item_open' &&
          Boolean(outbox.deliveredOn) &&
          outbox.leaseToken === null &&
          outbox.leaseExpiresOn === null &&
          cycle.providerWorkItemId === input.expectedWorkItemId &&
          cycle.providerIntakeId === input.expectedIntakeId &&
          cycle.providerStateId?.trim()
        ) {
          return {outcome: 'matched' as const, claim}
        }
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Delivered outbox did not contain complete stored provider identity/state',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }
      if (!claimable(outbox, now)) {
        return {
          outcome: 'refused' as const,
          result: refusal(
            input,
            'Plane create outbox event is currently leased by another worker',
            {
              testRunMapId: map.testRunMapId,
              defectCycleId: cycle.defectCycleId,
              resultOutboxId: outbox.resultOutboxId,
            },
          ),
        }
      }

      if (cycle.state !== 'manual_attention') {
        const cycleReservation = await trx
          .update(defectCycles)
          .set({state: 'manual_attention'})
          .where(
            and(
              eq(defectCycles.defectCycleId, cycle.defectCycleId),
              eq(defectCycles.activeMarker, 1),
              eq(defectCycles.state, cycle.state),
              eq(
                defectCycles.currentEvidenceRevisionId,
                revision.resultRevisionId,
              ),
              eq(
                defectCycles.createCorrelationKey,
                input.expectedCorrelationKey,
              ),
              or(
                isNull(defectCycles.providerWorkItemId),
                eq(defectCycles.providerWorkItemId, input.expectedWorkItemId),
              ),
              or(
                isNull(defectCycles.providerIntakeId),
                eq(defectCycles.providerIntakeId, input.expectedIntakeId),
              ),
            ),
          )
        if (cycleReservation[0].affectedRows !== 1) {
          return {
            outcome: 'refused' as const,
            result: refusal(
              input,
              'Plane cycle reservation lost its lifecycle fence',
              {
                testRunMapId: map.testRunMapId,
                defectCycleId: cycle.defectCycleId,
                resultOutboxId: outbox.resultOutboxId,
              },
            ),
          }
        }
      }

      const claimUpdate = await trx
        .update(resultOutbox)
        .set({
          deliveryState: 'leased',
          leaseToken: claim.leaseToken,
          leaseExpiresOn: claim.leaseExpiresOn,
          attemptCount: sql`${resultOutbox.attemptCount} + 1`,
          // This marker is committed in the claim transaction before the
          // external GET. It is the durable operator fence if finalization or
          // even the later manual-attention write fails.
          lastError: PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
        })
        .where(
          and(
            eq(resultOutbox.resultOutboxId, outbox.resultOutboxId),
            eq(resultOutbox.eventKey, outbox.eventKey),
            or(
              eq(resultOutbox.deliveryState, 'manual_attention'),
              and(
                or(
                  eq(resultOutbox.deliveryState, 'pending'),
                  eq(resultOutbox.deliveryState, 'retry_due'),
                  eq(resultOutbox.deliveryState, 'failed'),
                ),
                lte(resultOutbox.availableOn, now),
              ),
              and(
                eq(resultOutbox.deliveryState, 'leased'),
                lte(resultOutbox.leaseExpiresOn, now),
              ),
            ),
          ),
        )
      if (claimUpdate[0].affectedRows !== 1) {
        // Throw inside the claim transaction. The cycle reservation above must
        // roll back with this lease-fence failure; returning a refusal would
        // commit manual_attention without a durable outbox lease.
        throw new Error('Plane create outbox lease fence was lost')
      }
      return {outcome: 'claimed' as const, claim}
    })
  return isBiz41Recovery
    ? claimTransaction()
    : withPlaneOneShotDeadlockRetry(() => claimTransaction())
}

const recoveryInputMatchesIncident = (
  input: PlaneOneShotReconciliationInput,
) =>
  input.recoverBiz41ProviderObservationMismatch === true &&
  input.recoveryPayloadDigest === BIZ41_RECOVERY.payloadDigest &&
  input.projectId === BIZ41_RECOVERY.projectId &&
  input.runId === BIZ41_RECOVERY.runId &&
  input.testId === BIZ41_RECOVERY.testId &&
  input.expectedWorkItemId === BIZ41_RECOVERY.providerWorkItemId &&
  input.expectedIntakeId === BIZ41_RECOVERY.providerIntakeId &&
  input.expectedCorrelationKey === BIZ41_RECOVERY.correlationKey &&
  input.expectedDestination === PLANE_CANARY_ONE_SHOT_DESTINATION

const manualAttention = async ({
  claim,
  reason,
  finalizationFailure = false,
  database,
}: {
  claim: ClaimedReconciliation
  reason: string
  finalizationFailure?: boolean
  database: OneShotDatabase
}) =>
  withPlaneOneShotDeadlockRetry((attempt) =>
    database.transaction(async (trx) => {
      const activeClaim =
        attempt === 1
          ? claim
          : {
              ...claim,
              leaseToken: randomUUID(),
              leaseExpiresOn: new Date(claim.now.getTime() + claim.leaseMs),
            }
      // Keep the same outbox -> cycle order as claim/finalize and never let a
      // stale one-shot clobber a lifecycle state such as ready_for_retest.
      const [outbox] = await selectRows<
        Pick<ReconciliationOutbox, 'deliveryState' | 'leaseToken' | 'eventKey'>
      >(
        trx
          .select({
            deliveryState: resultOutbox.deliveryState,
            leaseToken: resultOutbox.leaseToken,
            eventKey: resultOutbox.eventKey,
          })
          .from(resultOutbox)
          .where(eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId))
          .limit(1)
          .for('update'),
      )
      if (
        !outbox ||
        outbox.deliveryState !== 'leased' ||
        outbox.leaseToken !== claim.leaseToken ||
        outbox.eventKey !== claim.outbox.eventKey
      ) {
        throw new Error(
          'Plane create outbox lease fence was lost while recording manual attention',
        )
      }
      if (attempt > 1) {
        const leaseRefresh = await trx
          .update(resultOutbox)
          .set({
            leaseToken: activeClaim.leaseToken,
            leaseExpiresOn: activeClaim.leaseExpiresOn,
          })
          .where(
            and(
              eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId),
              eq(resultOutbox.eventKey, claim.outbox.eventKey),
              eq(resultOutbox.deliveryState, 'leased'),
              eq(resultOutbox.leaseToken, claim.leaseToken),
            ),
          )
        if (leaseRefresh[0].affectedRows !== 1) {
          throw new Error(
            'Plane create outbox lease fence was lost while retrying manual attention',
          )
        }
      }

      const [cycle] = await selectRows<
        Pick<
          ReconciliationCycle,
          | 'state'
          | 'activeMarker'
          | 'currentEvidenceRevisionId'
          | 'createCorrelationKey'
        >
      >(
        trx
          .select({
            state: defectCycles.state,
            activeMarker: defectCycles.activeMarker,
            currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
            createCorrelationKey: defectCycles.createCorrelationKey,
          })
          .from(defectCycles)
          .where(eq(defectCycles.defectCycleId, claim.cycle.defectCycleId))
          .limit(1)
          .for('update'),
      )
      if (!cycle) {
        throw new Error(
          'Plane defect cycle disappeared while recording manual attention',
        )
      }

      if (
        cycle.state !== 'manual_attention' &&
        ['intake_pending', 'intake_open', 'work_item_open'].includes(
          cycle.state,
        ) &&
        cycle.activeMarker === 1 &&
        cycle.currentEvidenceRevisionId === claim.revision.resultRevisionId &&
        cycle.createCorrelationKey === claim.input.expectedCorrelationKey
      ) {
        const cycleUpdate = await trx
          .update(defectCycles)
          .set({state: 'manual_attention'})
          .where(
            and(
              eq(defectCycles.defectCycleId, claim.cycle.defectCycleId),
              eq(defectCycles.state, cycle.state),
              eq(defectCycles.activeMarker, 1),
              eq(
                defectCycles.currentEvidenceRevisionId,
                claim.revision.resultRevisionId,
              ),
              eq(
                defectCycles.createCorrelationKey,
                claim.input.expectedCorrelationKey,
              ),
            ),
          )
        if (cycleUpdate[0].affectedRows !== 1) {
          throw new Error(
            'Plane defect cycle lifecycle fence was lost while recording manual attention',
          )
        }
      }

      const manualAttentionMarker = claim.biz41Recovery
        ? PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER
        : finalizationFailure
          ? PLANE_ONE_SHOT_FINALIZATION_FAILURE_MARKER
          : PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER
      const update = await trx
        .update(resultOutbox)
        .set({
          deliveryState: 'manual_attention',
          leaseToken: null,
          leaseExpiresOn: null,
          lastError: `${manualAttentionMarker}: ${sanitizePlaneError(reason)}`,
          deliveredOn: null,
        })
        .where(
          and(
            eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId),
            eq(resultOutbox.eventKey, claim.outbox.eventKey),
            eq(resultOutbox.deliveryState, 'leased'),
            eq(resultOutbox.leaseToken, activeClaim.leaseToken),
          ),
        )
      if (update[0].affectedRows !== 1) {
        throw new Error(
          'Plane create outbox lease fence was lost while recording manual attention',
        )
      }
    }),
  )

const finalizeSuccess = async ({
  claim,
  observed,
  providerStateId,
  database,
}: {
  claim: ClaimedReconciliation
  observed: PlaneObservedFields
  providerStateId: string
  database: OneShotDatabase
}) =>
  withPlaneOneShotDeadlockRetry((attempt) =>
    database.transaction(async (trx) => {
      const activeClaim =
        attempt === 1
          ? claim
          : {
              ...claim,
              leaseToken: randomUUID(),
              leaseExpiresOn: new Date(claim.now.getTime() + claim.leaseMs),
            }
      const [leasedOutbox] = await selectRows<
        Pick<ReconciliationOutbox, 'eventKey' | 'deliveryState' | 'leaseToken'>
      >(
        trx
          .select({
            eventKey: resultOutbox.eventKey,
            deliveryState: resultOutbox.deliveryState,
            leaseToken: resultOutbox.leaseToken,
          })
          .from(resultOutbox)
          .where(eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId))
          .limit(1)
          .for('update'),
      )
      if (
        !leasedOutbox ||
        leasedOutbox.eventKey !== claim.outbox.eventKey ||
        leasedOutbox.deliveryState !== 'leased' ||
        leasedOutbox.leaseToken !== claim.leaseToken
      ) {
        throw new Error('Plane create outbox completion lease fence was lost')
      }
      if (attempt > 1) {
        const leaseRefresh = await trx
          .update(resultOutbox)
          .set({
            leaseToken: activeClaim.leaseToken,
            leaseExpiresOn: activeClaim.leaseExpiresOn,
          })
          .where(
            and(
              eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId),
              eq(resultOutbox.eventKey, claim.outbox.eventKey),
              eq(resultOutbox.deliveryState, 'leased'),
              eq(resultOutbox.leaseToken, claim.leaseToken),
            ),
          )
        if (leaseRefresh[0].affectedRows !== 1) {
          throw new Error(
            'Plane create outbox completion lease fence was lost while retrying',
          )
        }
      }

      const [cycle] = await selectRows<ReconciliationCycle>(
        trx
          .select({
            defectCycleId: defectCycles.defectCycleId,
            testRunMapId: defectCycles.testRunMapId,
            projectId: defectCycles.projectId,
            runId: defectCycles.runId,
            testId: defectCycles.testId,
            activeMarker: defectCycles.activeMarker,
            state: defectCycles.state,
            currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
            provider: defectCycles.provider,
            providerWorkspaceId: defectCycles.providerWorkspaceId,
            providerProjectId: defectCycles.providerProjectId,
            providerWorkItemId: defectCycles.providerWorkItemId,
            providerIntakeId: defectCycles.providerIntakeId,
            providerStateId: defectCycles.providerStateId,
            providerSequenceId: defectCycles.providerSequenceId,
            providerUrl: defectCycles.providerUrl,
            createCorrelationKey: defectCycles.createCorrelationKey,
          })
          .from(defectCycles)
          .where(eq(defectCycles.defectCycleId, claim.cycle.defectCycleId))
          .limit(1)
          .for('update'),
      )
      if (!cycle)
        throw new Error('Plane defect cycle disappeared during reconciliation')
      if (
        cycle.testRunMapId !== claim.map.testRunMapId ||
        cycle.projectId !== claim.input.projectId ||
        cycle.runId !== claim.input.runId ||
        cycle.testId !== claim.input.testId ||
        cycle.activeMarker !== 1 ||
        cycle.currentEvidenceRevisionId !== claim.revision.resultRevisionId ||
        cycle.provider !== PLANE_PROVIDER ||
        cycle.providerWorkspaceId !== claim.config.workspaceId ||
        cycle.providerProjectId !== claim.config.projectId ||
        cycle.createCorrelationKey !== claim.input.expectedCorrelationKey ||
        cycle.state !== 'manual_attention'
      ) {
        throw new Error(
          'Plane defect cycle fence changed during reconciliation',
        )
      }
      if (
        (cycle.providerWorkItemId !== null &&
          cycle.providerWorkItemId !== claim.input.expectedWorkItemId) ||
        (cycle.providerIntakeId !== null &&
          cycle.providerIntakeId !== claim.input.expectedIntakeId)
      ) {
        throw new Error('Plane provider identity changed during reconciliation')
      }

      const cycleUpdate = await trx
        .update(defectCycles)
        .set({
          state: 'work_item_open',
          provider: PLANE_PROVIDER,
          providerWorkspaceId: claim.config.workspaceId,
          providerProjectId: claim.config.projectId,
          providerWorkItemId: claim.input.expectedWorkItemId,
          providerIntakeId: claim.input.expectedIntakeId,
          providerSequenceId: observed.sequenceId,
          providerStateId,
          providerUrl:
            observed.sequenceId === null
              ? null
              : [
                  claim.config.publicBaseUrl,
                  claim.config.workspaceSlug,
                  'browse',
                  `${claim.config.projectIdentifier}-${observed.sequenceId}`,
                ].join('/') + '/',
          lastProviderObservedOn: claim.now,
        })
        .where(
          and(
            eq(defectCycles.defectCycleId, claim.cycle.defectCycleId),
            eq(defectCycles.activeMarker, 1),
            eq(defectCycles.state, 'manual_attention'),
            eq(
              defectCycles.currentEvidenceRevisionId,
              claim.revision.resultRevisionId,
            ),
            eq(
              defectCycles.createCorrelationKey,
              claim.input.expectedCorrelationKey,
            ),
            or(
              isNull(defectCycles.providerWorkItemId),
              eq(
                defectCycles.providerWorkItemId,
                claim.input.expectedWorkItemId,
              ),
            ),
            or(
              isNull(defectCycles.providerIntakeId),
              eq(defectCycles.providerIntakeId, claim.input.expectedIntakeId),
            ),
          ),
        )
      if (cycleUpdate[0].affectedRows !== 1) {
        throw new Error('Plane defect cycle completion fence was lost')
      }

      const outboxUpdate = await trx
        .update(resultOutbox)
        .set({
          deliveryState: 'delivered',
          leaseToken: null,
          leaseExpiresOn: null,
          lastError: null,
          deliveredOn: claim.now,
        })
        .where(
          and(
            eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId),
            eq(resultOutbox.eventKey, claim.outbox.eventKey),
            eq(resultOutbox.deliveryState, 'leased'),
            eq(resultOutbox.leaseToken, activeClaim.leaseToken),
          ),
        )
      if (outboxUpdate[0].affectedRows !== 1) {
        throw new Error('Plane create outbox completion fence was lost')
      }
    }),
  )

const finalizeLegacyRepair = async ({
  claim,
  observed,
  providerStateId,
  database,
}: {
  claim: ClaimedReconciliation
  observed: PlaneObservedFields
  providerStateId: string
  database: OneShotDatabase
}) =>
  withPlaneOneShotDeadlockRetry(() =>
    database.transaction(async (trx) => {
      const [outbox] = await selectRows<
        Pick<
          ReconciliationOutbox,
          | 'eventKey'
          | 'eventType'
          | 'aggregateType'
          | 'aggregateId'
          | 'resultRevisionId'
          | 'payload'
          | 'deliveryState'
          | 'leaseToken'
          | 'leaseExpiresOn'
          | 'deliveredOn'
          | 'lastError'
        >
      >(
        trx
          .select({
            eventKey: resultOutbox.eventKey,
            eventType: resultOutbox.eventType,
            aggregateType: resultOutbox.aggregateType,
            aggregateId: resultOutbox.aggregateId,
            resultRevisionId: resultOutbox.resultRevisionId,
            payload: resultOutbox.payload,
            deliveryState: resultOutbox.deliveryState,
            leaseToken: resultOutbox.leaseToken,
            leaseExpiresOn: resultOutbox.leaseExpiresOn,
            deliveredOn: resultOutbox.deliveredOn,
            lastError: resultOutbox.lastError,
          })
          .from(resultOutbox)
          .where(eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId))
          .limit(1)
          .for('update'),
      )
      if (
        !outbox ||
        outbox.eventKey !== claim.outbox.eventKey ||
        outbox.eventType !== CREATE_EVENT_TYPE ||
        outbox.aggregateType !== 'defect_cycle' ||
        outbox.aggregateId !== claim.cycle.defectCycleId ||
        outbox.resultRevisionId !== claim.revision.resultRevisionId ||
        outbox.deliveryState !== 'delivered' ||
        outbox.leaseToken !== null ||
        outbox.leaseExpiresOn !== null ||
        outbox.deliveredOn === null ||
        outbox.lastError !==
          (claim.biz41Recovery
            ? PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER
            : PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER) ||
        outbox.payload.resultRevisionId !== claim.revision.resultRevisionId ||
        outbox.payload.testRunMapId !== claim.map.testRunMapId ||
        outbox.payload.projectId !== claim.input.projectId ||
        outbox.payload.runId !== claim.input.runId ||
        outbox.payload.testId !== claim.input.testId ||
        outbox.payload.defectCycleId !== claim.cycle.defectCycleId ||
        !outbox.payload.planeDefectIntent?.create ||
        outbox.payload.planeDefectIntent.defectCycleId !==
          claim.cycle.defectCycleId ||
        outbox.payload.planeDefectIntent.correlationKey !==
          claim.input.expectedCorrelationKey
      ) {
        throw new Error('Legacy Plane repair outbox fence was lost')
      }

      const [cycle] = await selectRows<ReconciliationCycle>(
        trx
          .select({
            defectCycleId: defectCycles.defectCycleId,
            testRunMapId: defectCycles.testRunMapId,
            projectId: defectCycles.projectId,
            runId: defectCycles.runId,
            testId: defectCycles.testId,
            activeMarker: defectCycles.activeMarker,
            state: defectCycles.state,
            currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
            provider: defectCycles.provider,
            providerWorkspaceId: defectCycles.providerWorkspaceId,
            providerProjectId: defectCycles.providerProjectId,
            providerWorkItemId: defectCycles.providerWorkItemId,
            providerIntakeId: defectCycles.providerIntakeId,
            providerStateId: defectCycles.providerStateId,
            providerSequenceId: defectCycles.providerSequenceId,
            providerUrl: defectCycles.providerUrl,
            createCorrelationKey: defectCycles.createCorrelationKey,
          })
          .from(defectCycles)
          .where(eq(defectCycles.defectCycleId, claim.cycle.defectCycleId))
          .limit(1)
          .for('update'),
      )
      if (
        !cycle ||
        cycle.testRunMapId !== claim.map.testRunMapId ||
        cycle.projectId !== claim.input.projectId ||
        cycle.runId !== claim.input.runId ||
        cycle.testId !== claim.input.testId ||
        cycle.activeMarker !== 1 ||
        cycle.currentEvidenceRevisionId !== claim.revision.resultRevisionId ||
        cycle.provider !== PLANE_PROVIDER ||
        cycle.providerWorkspaceId !== claim.config.workspaceId ||
        cycle.providerProjectId !== claim.config.projectId ||
        cycle.providerWorkItemId !== claim.input.expectedWorkItemId ||
        cycle.providerIntakeId !== claim.input.expectedIntakeId ||
        cycle.providerStateId !== null ||
        cycle.createCorrelationKey !== claim.input.expectedCorrelationKey ||
        cycle.state !== 'manual_attention'
      ) {
        throw new Error('Legacy Plane repair cycle fence changed')
      }

      const cycleUpdate = await trx
        .update(defectCycles)
        .set({
          state: 'work_item_open',
          providerStateId,
          providerSequenceId: observed.sequenceId,
          providerUrl:
            observed.sequenceId === null
              ? null
              : [
                  claim.config.publicBaseUrl,
                  claim.config.workspaceSlug,
                  'browse',
                  `${claim.config.projectIdentifier}-${observed.sequenceId}`,
                ].join('/') + '/',
          lastProviderObservedOn: claim.now,
        })
        .where(
          and(
            eq(defectCycles.defectCycleId, claim.cycle.defectCycleId),
            eq(defectCycles.activeMarker, 1),
            eq(defectCycles.state, 'manual_attention'),
            eq(
              defectCycles.currentEvidenceRevisionId,
              claim.revision.resultRevisionId,
            ),
            eq(
              defectCycles.createCorrelationKey,
              claim.input.expectedCorrelationKey,
            ),
            eq(defectCycles.providerWorkItemId, claim.input.expectedWorkItemId),
            eq(defectCycles.providerIntakeId, claim.input.expectedIntakeId),
            isNull(defectCycles.providerStateId),
          ),
        )
      if (cycleUpdate[0].affectedRows !== 1) {
        throw new Error('Legacy Plane repair cycle fence was lost')
      }

      const outboxUpdate = await trx
        .update(resultOutbox)
        .set({lastError: null})
        .where(
          and(
            eq(resultOutbox.resultOutboxId, claim.outbox.resultOutboxId),
            eq(resultOutbox.eventKey, claim.outbox.eventKey),
            eq(resultOutbox.eventType, CREATE_EVENT_TYPE),
            eq(resultOutbox.aggregateType, 'defect_cycle'),
            eq(resultOutbox.aggregateId, claim.cycle.defectCycleId),
            eq(resultOutbox.resultRevisionId, claim.revision.resultRevisionId),
            sql`${resultOutbox.payload} = CAST(${JSON.stringify(
              claim.outbox.payload,
            )} AS JSON)`,
            eq(resultOutbox.deliveryState, 'delivered'),
            isNull(resultOutbox.leaseToken),
            isNull(resultOutbox.leaseExpiresOn),
            sql`${resultOutbox.deliveredOn} is not null`,
            eq(
              resultOutbox.lastError,
              claim.biz41Recovery
                ? PLANE_ONE_SHOT_BIZ41_RECOVERY_MARKER
                : PLANE_ONE_SHOT_PROVIDER_CALL_STARTED_MARKER,
            ),
          ),
        )
      if (outboxUpdate[0].affectedRows !== 1) {
        throw new Error('Legacy Plane repair outbox fence was lost')
      }
    }),
  )

const verifyOnlyPreflight = async ({
  input,
  config,
  planeAdapter,
  database,
  now,
}: {
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  planeAdapter: PlaneOneShotAdapter
  database: OneShotDatabase
  now: Date
}): Promise<PlaneOneShotReconciliationResult> => {
  const replay = await resolveDeliveredReplay({input, config, database})
  if (replay.outcome === 'refused') return replay.result
  if (replay.outcome === 'ready') {
    if (replay.candidate.legacyRepair) {
      const legacy = await validateLegacyDeliveredReplay({
        input,
        config,
        candidate: replay.candidate,
        database,
      })
      if ('outcome' in legacy) return legacy
      const workItem = await planeAdapter.getIntakeWorkItem({
        workItemId: input.expectedWorkItemId,
        intakeId: input.expectedIntakeId,
      })
      const observed = validateProviderObservation({
        workItem,
        input,
        config,
        intent: legacy.intent,
        payload: legacy.outbox.payload,
      })
      return {
        outcome: 'verified',
        repairRequired: true,
        projectId: input.projectId,
        runId: input.runId,
        testId: input.testId,
        testRunMapId: legacy.map.testRunMapId,
        defectCycleId: legacy.cycle.defectCycleId,
        resultOutboxId: legacy.outbox.resultOutboxId,
        cycleState: legacy.cycle.state,
        outboxDeliveryState: legacy.outbox.deliveryState,
        providerWorkItemId: workItem.workItemId,
        providerIntakeId: observed.intakeId ?? input.expectedIntakeId,
        providerStateId: workItem.stateId,
      }
    }
    const replayIdentityFailure = await validateDeliveredReplayIdentity({
      input,
      candidate: replay.candidate,
      database,
    })
    if (replayIdentityFailure) return replayIdentityFailure
    return {
      outcome: 'matched',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      testRunMapId: replay.candidate.testRunMapId,
      defectCycleId: replay.candidate.defectCycleId,
      resultOutboxId: replay.candidate.resultOutboxId,
      providerWorkItemId: input.expectedWorkItemId,
      providerIntakeId: input.expectedIntakeId,
      providerStateId: replay.candidate.providerStateId ?? 'unknown',
    }
  }

  const resolved = await resolveCandidate({input, database})
  if (resolved.outcome === 'refused') return resolved.result

  const preflight = await database.transaction(async (trx) => {
    const maps = await selectRows<ReconciliationMap>(
      trx
        .select({
          testRunMapId: testRunMap.testRunMapId,
          projectId: testRunMap.projectId,
          testProjectId: tests.projectId,
          runId: testRunMap.runId,
          testId: testRunMap.testId,
          isIncluded: testRunMap.isIncluded,
          currentResultRevisionId: testRunMap.currentResultRevisionId,
          runProjectId: runs.projectId,
          runStatus: runs.status,
        })
        .from(testRunMap)
        .leftJoin(runs, eq(runs.runId, testRunMap.runId))
        .leftJoin(tests, eq(tests.testId, testRunMap.testId))
        .where(
          and(
            eq(testRunMap.projectId, input.projectId),
            eq(testRunMap.runId, input.runId),
            eq(testRunMap.testId, input.testId),
          ),
        )
        .limit(2),
    )
    if (maps.length !== 1) return refusal(input, 'Exact testRunMap cardinality changed during verify-only preflight')
    const map = maps[0]
    const cycles = await selectRows<ReconciliationCycle>(
      trx
        .select({
          defectCycleId: defectCycles.defectCycleId,
          testRunMapId: defectCycles.testRunMapId,
          projectId: defectCycles.projectId,
          runId: defectCycles.runId,
          testId: defectCycles.testId,
          activeMarker: defectCycles.activeMarker,
          state: defectCycles.state,
          currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
          provider: defectCycles.provider,
          providerWorkspaceId: defectCycles.providerWorkspaceId,
          providerProjectId: defectCycles.providerProjectId,
          providerWorkItemId: defectCycles.providerWorkItemId,
          providerIntakeId: defectCycles.providerIntakeId,
          providerStateId: defectCycles.providerStateId,
          providerSequenceId: defectCycles.providerSequenceId,
          providerUrl: defectCycles.providerUrl,
          createCorrelationKey: defectCycles.createCorrelationKey,
        })
        .from(defectCycles)
        .where(
          and(
            eq(defectCycles.testRunMapId, resolved.candidate.testRunMapId),
            eq(defectCycles.activeMarker, 1),
          ),
        )
        .limit(2),
    )
    if (
      cycles.length !== 1 ||
      cycles[0].defectCycleId !== resolved.candidate.defectCycleId
    )
      return refusal(
        input,
        'Exact defect cycle cardinality changed during verify-only preflight',
      )
    const cycle = cycles[0]
    const outboxes = await selectRows<ReconciliationOutbox>(
      trx
        .select({
          resultOutboxId: resultOutbox.resultOutboxId,
          eventKey: resultOutbox.eventKey,
          eventType: resultOutbox.eventType,
          aggregateType: resultOutbox.aggregateType,
          aggregateId: resultOutbox.aggregateId,
          resultRevisionId: resultOutbox.resultRevisionId,
          payload: resultOutbox.payload,
          deliveryState: resultOutbox.deliveryState,
          availableOn: resultOutbox.availableOn,
          leaseToken: resultOutbox.leaseToken,
          leaseExpiresOn: resultOutbox.leaseExpiresOn,
          deliveredOn: resultOutbox.deliveredOn,
          lastError: resultOutbox.lastError,
        })
        .from(resultOutbox)
        .where(
          and(
            eq(resultOutbox.eventType, CREATE_EVENT_TYPE),
            eq(resultOutbox.aggregateType, 'defect_cycle'),
            eq(resultOutbox.aggregateId, resolved.candidate.defectCycleId),
            eq(resultOutbox.resultRevisionId, resolved.candidate.resultRevisionId),
          ),
        )
        .limit(2),
    )
    if (
      outboxes.length !== 1 ||
      outboxes[0].resultOutboxId !== resolved.candidate.resultOutboxId
    )
      return refusal(
        input,
        'Exact create outbox cardinality changed during verify-only preflight',
      )
    const outbox = outboxes[0]
    const [revision] = await selectRows<ReconciliationRevision>(
      trx
        .select({
          resultRevisionId: resultRevisions.resultRevisionId,
          testRunMapId: resultRevisions.testRunMapId,
          projectId: resultRevisions.projectId,
          runId: resultRevisions.runId,
          testId: resultRevisions.testId,
        })
        .from(resultRevisions)
        .where(eq(resultRevisions.resultRevisionId, resolved.candidate.resultRevisionId))
        .limit(2),
    )
    const intent = outbox.payload.planeDefectIntent
    const valid =
      revision &&
      map.testRunMapId === resolved.candidate.testRunMapId &&
      map.projectId === input.projectId &&
      map.testProjectId === input.projectId &&
      map.runId === input.runId &&
      map.testId === input.testId &&
      map.isIncluded === true &&
      map.runProjectId === input.projectId &&
      map.runStatus === 'Active' &&
      map.currentResultRevisionId === resolved.candidate.resultRevisionId &&
      cycle.testRunMapId === map.testRunMapId &&
      cycle.projectId === input.projectId &&
      cycle.runId === input.runId &&
      cycle.testId === input.testId &&
      cycle.activeMarker === 1 &&
      ['intake_pending', 'manual_attention', 'intake_open', 'work_item_open'].includes(cycle.state) &&
      cycle.currentEvidenceRevisionId === resolved.candidate.resultRevisionId &&
      cycle.provider === PLANE_PROVIDER &&
      cycle.providerWorkspaceId === config.workspaceId &&
      cycle.providerProjectId === config.projectId &&
      cycle.createCorrelationKey === input.expectedCorrelationKey &&
      outbox.eventKey === CREATE_EVENT_KEY(cycle.defectCycleId) &&
      outbox.eventType === CREATE_EVENT_TYPE &&
      outbox.aggregateType === 'defect_cycle' &&
      outbox.aggregateId === cycle.defectCycleId &&
      outbox.resultRevisionId === revision.resultRevisionId &&
      outbox.payload.resultRevisionId === revision.resultRevisionId &&
      outbox.payload.testRunMapId === map.testRunMapId &&
      outbox.payload.projectId === input.projectId &&
      outbox.payload.runId === input.runId &&
      outbox.payload.testId === input.testId &&
      outbox.payload.defectCycleId === cycle.defectCycleId &&
      Boolean(intent?.create) &&
      intent?.defectCycleId === cycle.defectCycleId &&
      intent?.correlationKey === input.expectedCorrelationKey &&
      !hasProviderCallFence(outbox.lastError) &&
      outbox.deliveryState !== 'delivered' &&
      !(outbox.deliveryState === 'leased' && outbox.leaseExpiresOn && outbox.leaseExpiresOn.getTime() > now.getTime()) &&
      claimable(outbox, now) &&
      (cycle.providerWorkItemId === null || cycle.providerWorkItemId === input.expectedWorkItemId) &&
      (cycle.providerIntakeId === null || cycle.providerIntakeId === input.expectedIntakeId)
    if (!valid) return refusal(input, 'Exact map, run, test, cycle, revision, or create-outbox preconditions did not match verify-only target', {
      testRunMapId: map.testRunMapId,
      defectCycleId: cycle.defectCycleId,
      resultOutboxId: outbox.resultOutboxId,
    })
    return {map, cycle, revision, outbox, intent} as const
  })
  if ('outcome' in preflight) return preflight
  const workItem = await planeAdapter.getIntakeWorkItem({
    workItemId: input.expectedWorkItemId,
    intakeId: input.expectedIntakeId,
  })
  const observed = validateProviderObservation({
    workItem,
    input,
    config,
    intent: preflight.intent,
    payload: preflight.outbox.payload,
  })
  return {
    outcome: 'verified',
    projectId: input.projectId,
    runId: input.runId,
    testId: input.testId,
    testRunMapId: preflight.map.testRunMapId,
    defectCycleId: preflight.cycle.defectCycleId,
    resultOutboxId: preflight.outbox.resultOutboxId,
    cycleState: preflight.cycle.state,
    outboxDeliveryState: preflight.outbox.deliveryState,
    providerWorkItemId: workItem.workItemId,
    providerIntakeId: observed.intakeId ?? input.expectedIntakeId,
    providerStateId: workItem.stateId,
  }
}

export const isPlaneOneShotReconciliationEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment[PLANE_CANARY_ONE_SHOT_FLAG] === 'true'

export const reconcilePlaneDefectOneShot = async ({
  input,
  config,
  planeAdapter,
  database = dbClient as unknown as OneShotDatabase,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  environment = process.env,
  enabled = isPlaneOneShotReconciliationEnabled(environment),
  verifyOnly = false,
}: {
  input: PlaneOneShotReconciliationInput
  config: PlaneAdapterConfig
  planeAdapter: PlaneOneShotAdapter
  database?: OneShotDatabase
  now?: Date
  leaseMs?: number
  environment?: Readonly<Record<string, string | undefined>>
  enabled?: boolean
  verifyOnly?: boolean
}): Promise<PlaneOneShotReconciliationResult> => {
  if (!enabled) {
    return {
      outcome: 'refused',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      reason: `${PLANE_CANARY_ONE_SHOT_FLAG} is disabled`,
    }
  }
  if (!arePlaneOneShotWorkerRolesDisabled(environment)) {
    return {
      outcome: 'refused',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      reason:
        'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    }
  }
  if (!isPositiveInteger(input.projectId))
    throw new Error('projectId must be a positive integer')
  if (!isPositiveInteger(input.runId))
    throw new Error('runId must be a positive integer')
  if (!isPositiveInteger(input.testId))
    throw new Error('testId must be a positive integer')
  requireInput(input.expectedWorkItemId, 'expectedWorkItemId')
  requireInput(input.expectedIntakeId, 'expectedIntakeId')
  requireInput(input.expectedCorrelationKey, 'expectedCorrelationKey')
  if (input.expectedDestination !== PLANE_CANARY_ONE_SHOT_DESTINATION) {
    throw new Error(
      'expectedDestination must be the exact biz-development destination',
    )
  }
  if (!destinationMatchesConfig(config)) {
    throw new Error(
      'Plane adapter destination is not the exact BIZ destination',
    )
  }
  if (input.recoverBiz41ProviderObservationMismatch && verifyOnly) {
    throw new Error(
      'BIZ-41 provider-observation recovery cannot be combined with verify-only',
    )
  }
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < MIN_LEASE_MS ||
    leaseMs > MAX_LEASE_MS
  ) {
    throw new Error(
      `leaseMs must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS}`,
    )
  }

  if (verifyOnly) {
    return verifyOnlyPreflight({input, config, planeAdapter, database, now})
  }

  const claimed = await loadAndClaim({input, config, now, leaseMs, database})
  if (claimed.outcome === 'refused') return claimed.result
  const claim = claimed.claim
  if (claimed.outcome === 'matched') {
    return {
      outcome: 'matched',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      testRunMapId: claim.map.testRunMapId,
      defectCycleId: claim.cycle.defectCycleId,
      resultOutboxId: claim.outbox.resultOutboxId,
      providerWorkItemId: input.expectedWorkItemId,
      providerIntakeId: input.expectedIntakeId,
      providerStateId: claim.cycle.providerStateId ?? 'unknown',
    }
  }

  let workItem: PlaneWorkItem
  let observed: PlaneObservedFields
  try {
    workItem = await planeAdapter.getWorkItem(input.expectedWorkItemId)
    const intent = claim.outbox.payload.planeDefectIntent
    if (!intent?.create)
      throw new Error('Plane create intent was missing during reconciliation')
    observed = validateProviderObservation({
      workItem,
      input,
      config,
      intent,
      payload: claim.outbox.payload,
    })
  } catch (error) {
    const reason = sanitizePlaneError(error)
    if (!claim.legacyRepair) {
      try {
        await manualAttention({claim, reason, database})
      } catch (finalizeError) {
        throw new Error(
          `${reason}; could not record manual attention: ${sanitizePlaneError(
            finalizeError,
          )}`,
        )
      }
    }
    return {
      outcome: 'manual_attention',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      testRunMapId: claim.map.testRunMapId,
      defectCycleId: claim.cycle.defectCycleId,
      resultOutboxId: claim.outbox.resultOutboxId,
      reason,
    }
  }

  try {
    if (claim.legacyRepair) {
      await finalizeLegacyRepair({
        claim,
        observed,
        providerStateId: workItem.stateId,
        database,
      })
    } else {
      await finalizeSuccess({
        claim,
        observed,
        providerStateId: workItem.stateId,
        database,
      })
    }
    return {
      outcome: 'reconciled',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      testRunMapId: claim.map.testRunMapId,
      defectCycleId: claim.cycle.defectCycleId,
      resultOutboxId: claim.outbox.resultOutboxId,
      providerWorkItemId: workItem.workItemId,
      providerIntakeId: input.expectedIntakeId,
      providerStateId: workItem.stateId,
    }
  } catch (error) {
    const reason = sanitizePlaneError(error)
    if (!claim.legacyRepair) {
      try {
        await manualAttention({
          claim,
          reason,
          finalizationFailure: true,
          database,
        })
      } catch (manualAttentionError) {
        throw new Error(
          `${reason}; could not record manual attention: ${sanitizePlaneError(
            manualAttentionError,
          )}`,
        )
      }
    }
    return {
      outcome: 'manual_attention',
      projectId: input.projectId,
      runId: input.runId,
      testId: input.testId,
      testRunMapId: claim.map.testRunMapId,
      defectCycleId: claim.cycle.defectCycleId,
      resultOutboxId: claim.outbox.resultOutboxId,
      reason,
    }
  }
}
