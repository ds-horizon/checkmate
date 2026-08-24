import {createHash} from 'node:crypto'
import {and, asc, eq, gt, inArray, isNotNull, isNull} from 'drizzle-orm'
import {
  defectCycles,
  integrationReconciliations,
  resultNotifications,
  resultRevisions,
} from '@schema/resultRevisions'
import {runs, testRunMap} from '@schema/runs'
import {tests} from '@schema/tests'
import {users} from '@schema/users'
import {dbClient} from '~/db/client'
import {
  claimIntegrationInboxEvents,
  claimIntegrationPollCursor,
  finalizeIntegrationInboxEvent,
  finalizeIntegrationPollCursor,
  recordVerifiedIntegrationEvent,
} from './integrationInbox'
import {
  createPlaneAdapter,
  createPlaneRequestLimiter,
  PlaneAdapter,
  PlaneAdapterError,
  PlaneRequestLimiter,
  readPlaneAdapterConfig,
  sanitizePlaneError,
} from './planeAdapter'
import {
  PLANE_DESTINATIONS,
  PlaneDestinationKey,
  planeDestinationForProviderIds,
  planeDestinationMatchesProviderIds,
  planeDestinationStateId,
} from './planeRouting'
import {reconcilePlaneRetestReadiness} from './planeReconciliation'
import {isPlaneRetestReadinessEnabled} from './resultRevisionFlags'

const PLANE_PROVIDER = 'plane'
const DEFAULT_BATCH_SIZE = 1
const MAX_BATCH_SIZE = 10
const DEFAULT_LEASE_MS = 710_000
const DEFAULT_RETRY_MS = 60_000
const MAX_RETRY_MS = 60 * 60 * 1000
const MIN_LEASE_SAFETY_MS = 10_000

type Environment = Readonly<Record<string, string | undefined>>

export const readPlaneRetestReadinessBatchSize = (
  environment: Environment = process.env,
) => {
  const configured = environment.PLANE_RETEST_READINESS_BATCH_SIZE
  if (configured === undefined) return DEFAULT_BATCH_SIZE

  if (!/^[1-9][0-9]*$/.test(configured)) {
    throw new Error(
      `PLANE_RETEST_READINESS_BATCH_SIZE must be an integer between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  const value = Number(configured)
  if (!Number.isSafeInteger(value) || value > MAX_BATCH_SIZE) {
    throw new Error(
      `PLANE_RETEST_READINESS_BATCH_SIZE must be an integer between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  return value
}

export type PlaneRetestReadinessConfig = {
  doneStateId: string
  workspaceId: string
  projectId: string
  apiTimeoutMs: number
  maxRequestWaitMs: number
  destinationKey: string
  planeDestination: PlaneDestinationKey
}

export type PlaneRetestReadinessPollTarget = {
  defectCycleId: number
  workItemId: string
  readinessGeneration: number
}

export type PlaneRetestReadinessApplyOutcome =
  | 'applied'
  | 'no_op'
  | 'manual_attention'

export type PlaneRetestReadinessBatchSummary = {
  enabled: boolean
  claimedCursor: boolean
  observed: number
  persisted: number
  replayed: number
  applied: number
  noOp: number
  retryDue: number
  manualAttention: number
  staleLeases: number
}

const readDoneStateId = (
  environment: Environment,
  destination: PlaneDestinationKey,
) => {
  const value =
    planeDestinationStateId(destination, 'done') ??
    environment.PLANE_RETEST_READINESS_DONE_STATE_ID?.trim()
  if (!value) {
    throw new Error(
      'PLANE_RETEST_READINESS_DONE_STATE_ID is required when Plane retest readiness is enabled',
    )
  }
  if (value.length > 64) {
    throw new Error('PLANE_RETEST_READINESS_DONE_STATE_ID is too long')
  }
  return value
}

export const readPlaneRetestReadinessConfig = (
  environment: Environment = process.env,
  destination: PlaneDestinationKey = environment.PLANE_DESTINATION as PlaneDestinationKey,
): PlaneRetestReadinessConfig => {
  const plane = readPlaneAdapterConfig(environment, destination)
  return {
    doneStateId: readDoneStateId(environment, destination),
    workspaceId: plane.workspaceId,
    projectId: plane.projectId,
    apiTimeoutMs: plane.timeoutMs,
    maxRequestWaitMs: plane.maxRequestWaitMs,
    destinationKey: `${PLANE_PROVIDER}:${plane.workspaceId}:${plane.projectId}`,
    planeDestination: destination,
  }
}

const parseCursor = (value: string | null) => {
  if (value === null) return null
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('Plane readiness poll cursor is invalid')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('Plane readiness poll cursor is invalid')
  }
  return parsed
}

const PLANE_READINESS_ELIGIBLE_STATES = [
  'intake_open',
  'work_item_open',
  'ready_for_retest',
] as const

type InvalidPlaneReadinessRoute = {
  defectCycleId: number
  providerWorkspaceId: string | null
  providerProjectId: string | null
}

/**
 * Fence malformed active cycles before either allowlisted poller selects work.
 * The UUID pair is the only durable route identity; invalid rows must be
 * visible to operators rather than disappearing behind destination predicates.
 */
export const fenceInvalidPlaneRetestReadinessRoutes = async ({
  now = new Date(),
}: {
  now?: Date
} = {}) => {
  return dbClient.transaction(async (trx) => {
    const cycles = await trx
      .select({
        defectCycleId: defectCycles.defectCycleId,
        providerWorkspaceId: defectCycles.providerWorkspaceId,
        providerProjectId: defectCycles.providerProjectId,
      })
      .from(defectCycles)
      .where(
        and(
          eq(defectCycles.provider, PLANE_PROVIDER),
          eq(defectCycles.activeMarker, 1),
          inArray(defectCycles.state, [...PLANE_READINESS_ELIGIBLE_STATES]),
          isNotNull(defectCycles.providerWorkItemId),
        ),
      )
      .for('update')

    const invalidRoutes = cycles.filter(
      (cycle): cycle is InvalidPlaneReadinessRoute =>
        planeDestinationForProviderIds(
          cycle.providerWorkspaceId,
          cycle.providerProjectId,
        ) === null,
    )
    let fenced = 0
    for (const cycle of invalidRoutes) {
      const updated = await trx
        .update(defectCycles)
        .set({state: 'manual_attention'})
        .where(
          and(
            eq(defectCycles.defectCycleId, cycle.defectCycleId),
            eq(defectCycles.provider, PLANE_PROVIDER),
            eq(defectCycles.activeMarker, 1),
            inArray(defectCycles.state, [...PLANE_READINESS_ELIGIBLE_STATES]),
          ),
        )
      if (updated[0]?.affectedRows !== 1) continue

      await trx
        .insert(integrationReconciliations)
        .values({
          findingKey: `plane-cycle:${cycle.defectCycleId}:route-identity`,
          findingType: 'plane_invalid_route_identity',
          aggregateType: 'defect_cycle',
          aggregateId: cycle.defectCycleId,
          severity: 'critical',
          state: 'manual_attention',
          expectedSnapshot: {
            provider: PLANE_PROVIDER,
            routeIdentity: 'allowlisted workspace/project UUID pair',
          },
          actualSnapshot: {
            providerWorkspaceId: cycle.providerWorkspaceId,
            providerProjectId: cycle.providerProjectId,
          },
          firstDetectedOn: now,
          lastDetectedOn: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            findingType: 'plane_invalid_route_identity',
            severity: 'critical',
            state: 'manual_attention',
            expectedSnapshot: {
              provider: PLANE_PROVIDER,
              routeIdentity: 'allowlisted workspace/project UUID pair',
            },
            actualSnapshot: {
              providerWorkspaceId: cycle.providerWorkspaceId,
              providerProjectId: cycle.providerProjectId,
            },
            lastDetectedOn: now,
            resolvedOn: null,
            resolutionNote: null,
          },
        })
      fenced += 1
    }
    return fenced
  })
}

export const listPlaneRetestReadinessPollTargets = async ({
  config,
  cursorValue,
  limit = DEFAULT_BATCH_SIZE,
}: {
  config: PlaneRetestReadinessConfig
  cursorValue: string | null
  limit?: number
}): Promise<PlaneRetestReadinessPollTarget[]> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `Plane readiness poll limit must be between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  const cursor = parseCursor(cursorValue)
  const conditions = [
    eq(defectCycles.provider, PLANE_PROVIDER),
    eq(defectCycles.providerWorkspaceId, config.workspaceId),
    eq(defectCycles.providerProjectId, config.projectId),
    eq(defectCycles.activeMarker, 1),
    inArray(defectCycles.state, [...PLANE_READINESS_ELIGIBLE_STATES]),
    isNotNull(defectCycles.providerWorkItemId),
  ]
  if (cursor !== null) conditions.push(gt(defectCycles.defectCycleId, cursor))

  const rows = await dbClient
    .select({
      defectCycleId: defectCycles.defectCycleId,
      workItemId: defectCycles.providerWorkItemId,
      readinessGeneration: defectCycles.readinessGeneration,
    })
    .from(defectCycles)
    .where(and(...conditions))
    .orderBy(asc(defectCycles.defectCycleId))
    .limit(limit)

  return rows.flatMap((row) =>
    row.workItemId
      ? [
          {
            defectCycleId: row.defectCycleId,
            workItemId: row.workItemId,
            readinessGeneration: row.readinessGeneration,
          },
        ]
      : [],
  )
}

const correlatedCycleConditions = ({
  workItemId,
  config,
}: {
  workItemId: string
  config: PlaneRetestReadinessConfig
}) => {
  return and(
    eq(defectCycles.provider, PLANE_PROVIDER),
    eq(defectCycles.providerWorkspaceId, config.workspaceId),
    eq(defectCycles.providerProjectId, config.projectId),
    eq(defectCycles.providerWorkItemId, workItemId),
    eq(defectCycles.activeMarker, 1),
  )
}

export const planePollDeliveryId = ({
  defectCycleId,
  readinessGeneration,
  workItemId,
  stateId,
  versionMarker,
}: {
  defectCycleId: number
  readinessGeneration: number
  workItemId: string
  stateId: string
  versionMarker: string | null
}): string => {
  const authoritativeIdentity = JSON.stringify({
    defectCycleId,
    readinessGeneration,
    workItemId,
    stateId,
    versionMarker,
  })
  return `plane-poll:${createHash('sha256')
    .update(authoritativeIdentity, 'utf8')
    .digest('hex')}`
}

export const applyPlaneRetestReadiness = async ({
  workItemId,
  stateId,
  config,
  now = new Date(),
}: {
  workItemId: string
  stateId: string
  config: PlaneRetestReadinessConfig
  now?: Date
}): Promise<PlaneRetestReadinessApplyOutcome> => {
  return dbClient.transaction(async (trx) => {
    const [cycle] = await trx
      .select({
        defectCycleId: defectCycles.defectCycleId,
        testRunMapId: defectCycles.testRunMapId,
        runId: defectCycles.runId,
        testId: defectCycles.testId,
        projectId: defectCycles.projectId,
        openingRevisionId: defectCycles.openingRevisionId,
        state: defectCycles.state,
        currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
        readinessGeneration: defectCycles.readinessGeneration,
        reopenState: defectCycles.reopenState,
        reopenRevisionId: defectCycles.reopenRevisionId,
      })
      .from(defectCycles)
      .where(correlatedCycleConditions({workItemId, config}))
      .limit(1)
      .for('update')
    if (
      !cycle ||
      !['intake_open', 'work_item_open', 'ready_for_retest'].includes(
        cycle.state,
      )
    ) {
      return 'no_op'
    }

    const [mapping] = await trx
      .select({
        testRunMapId: testRunMap.testRunMapId,
        runId: testRunMap.runId,
        testId: testRunMap.testId,
        projectId: testRunMap.projectId,
        isIncluded: testRunMap.isIncluded,
        currentResultRevisionId: testRunMap.currentResultRevisionId,
        runStatus: runs.status,
      })
      .from(testRunMap)
      .innerJoin(runs, eq(testRunMap.runId, runs.runId))
      .where(eq(testRunMap.testRunMapId, cycle.testRunMapId))
      .limit(1)
      .for('update')
    if (
      !mapping ||
      !mapping.isIncluded ||
      mapping.runStatus !== 'Active' ||
      mapping.runId !== cycle.runId ||
      mapping.testId !== cycle.testId ||
      mapping.projectId !== cycle.projectId ||
      mapping.currentResultRevisionId !== cycle.currentEvidenceRevisionId
    ) {
      return 'no_op'
    }

    const [revision] = await trx
      .select({
        resultRevisionId: resultRevisions.resultRevisionId,
        testRunMapId: resultRevisions.testRunMapId,
        runId: resultRevisions.runId,
        testId: resultRevisions.testId,
        projectId: resultRevisions.projectId,
      })
      .from(resultRevisions)
      .where(
        eq(resultRevisions.resultRevisionId, cycle.currentEvidenceRevisionId),
      )
      .limit(1)
      .for('update')
    if (
      !revision ||
      revision.testRunMapId !== mapping.testRunMapId ||
      revision.runId !== mapping.runId ||
      revision.testId !== mapping.testId ||
      revision.projectId !== mapping.projectId
    ) {
      return 'no_op'
    }

    if (cycle.state === 'ready_for_retest') {
      if (stateId === config.doneStateId) return 'no_op'
      const cycleUpdate = await trx
        .update(defectCycles)
        .set({
          state: 'work_item_open',
          providerStateId: stateId,
          lastProviderObservedOn: now,
        })
        .where(eq(defectCycles.defectCycleId, cycle.defectCycleId))
      if (cycleUpdate[0].affectedRows !== 1) {
        throw new Error(
          'Plane retest readiness withdrawal did not update exactly one cycle',
        )
      }
      await trx
        .update(resultNotifications)
        .set({invalidatedOn: now})
        .where(
          and(
            eq(resultNotifications.defectCycleId, cycle.defectCycleId),
            eq(resultNotifications.channel, 'checkmate_retest_ready'),
            isNull(resultNotifications.invalidatedOn),
          ),
        )
      return 'applied'
    }

    if (
      cycle.reopenState === 'pending' ||
      cycle.reopenState === 'manual_attention'
    ) {
      return 'no_op'
    }
    if (cycle.reopenState === 'delivered') {
      if (stateId === config.doneStateId) return 'no_op'
      const reopenUpdate = await trx
        .update(defectCycles)
        .set({
          reopenState: 'observed',
          providerStateId: stateId,
          lastProviderObservedOn: now,
        })
        .where(
          and(
            eq(defectCycles.defectCycleId, cycle.defectCycleId),
            eq(defectCycles.reopenState, 'delivered'),
            ...(cycle.reopenRevisionId === null
              ? []
              : [eq(defectCycles.reopenRevisionId, cycle.reopenRevisionId)]),
          ),
        )
      if (reopenUpdate[0].affectedRows !== 1) {
        throw new Error('Plane reopen observation lost its revision fence')
      }
      return 'applied'
    }
    if (stateId !== config.doneStateId) return 'no_op'
    if (cycle.reopenState && cycle.reopenState !== 'observed') {
      return 'no_op'
    }

    const [openingRecipient] = await trx
      .select({userId: users.userId})
      .from(resultRevisions)
      .innerJoin(
        users,
        and(
          eq(users.userId, resultRevisions.actorUserId),
          eq(users.status, 'active'),
        ),
      )
      .where(eq(resultRevisions.resultRevisionId, cycle.openingRevisionId))
      .limit(1)
      .for('update')

    const [evidenceRecipient] = openingRecipient
      ? []
      : await trx
          .select({userId: users.userId})
          .from(resultRevisions)
          .innerJoin(
            users,
            and(
              eq(users.userId, resultRevisions.actorUserId),
              eq(users.status, 'active'),
            ),
          )
          .where(
            eq(resultRevisions.resultRevisionId, revision.resultRevisionId),
          )
          .limit(1)
          .for('update')

    const [assignedRecipient] =
      openingRecipient || evidenceRecipient
        ? []
        : await trx
            .select({userId: users.userId})
            .from(tests)
            .innerJoin(
              users,
              and(
                eq(users.userId, tests.assignedTo),
                eq(users.status, 'active'),
              ),
            )
            .where(eq(tests.testId, mapping.testId))
            .limit(1)
            .for('update')

    const recipient = openingRecipient ?? evidenceRecipient ?? assignedRecipient
    if (!recipient) return 'manual_attention'

    const readinessGeneration = cycle.readinessGeneration + 1
    const recipientKey = `user:${recipient.userId}`
    const notificationKey = `plane-retest-ready:${recipientKey}:${cycle.defectCycleId}:${readinessGeneration}`
    const [existingNotification] = await trx
      .select({resultNotificationId: resultNotifications.resultNotificationId})
      .from(resultNotifications)
      .where(eq(resultNotifications.notificationKey, notificationKey))
      .limit(1)
      .for('update')

    const cycleUpdate = await trx
      .update(defectCycles)
      .set({
        state: 'ready_for_retest',
        readinessGeneration,
        providerStateId: stateId,
        lastProviderObservedOn: now,
      })
      .where(eq(defectCycles.defectCycleId, cycle.defectCycleId))
    if (cycleUpdate[0].affectedRows !== 1) {
      throw new Error('Plane retest readiness did not update exactly one cycle')
    }

    if (!existingNotification) {
      await trx.insert(resultNotifications).values({
        notificationKey,
        defectCycleId: cycle.defectCycleId,
        resultRevisionId: revision.resultRevisionId,
        channel: 'checkmate_retest_ready',
        recipientKey,
        deliveryState: 'delivered',
        deliveredOn: now,
        payload: {
          event: 'plane_retest_ready',
          workItemId,
          stateId,
          readinessGeneration,
          testRunMapId: mapping.testRunMapId,
          deepLink: {
            projectId: mapping.projectId,
            runId: mapping.runId,
            testId: mapping.testId,
          },
        },
      })
    }

    return 'applied'
  })
}

const getEventRoute = (payload: Record<string, unknown>) => {
  const workspaceId = payload.providerWorkspaceId
  const projectId = payload.providerProjectId
  if (typeof workspaceId !== 'string' || typeof projectId !== 'string') {
    return null
  }
  const destination = planeDestinationForProviderIds(workspaceId, projectId)
  const declaredDestination = payload.providerDestinationKey
  return typeof declaredDestination === 'string' &&
    declaredDestination !== destination
    ? null
    : destination
}

const getEventFields = (payload: Record<string, unknown>) => {
  const workItemId = payload.workItemId
  const stateId = payload.stateId
  return typeof workItemId === 'string' && typeof stateId === 'string'
    ? {workItemId, stateId}
    : null
}

const boundedRetryDelay = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value)
    ? DEFAULT_RETRY_MS
    : Math.max(1, Math.min(Math.trunc(value), MAX_RETRY_MS))

const retryAt = (now: Date, error: unknown) =>
  new Date(
    now.getTime() +
      (error instanceof PlaneAdapterError
        ? boundedRetryDelay(error.retryAfterMs)
        : DEFAULT_RETRY_MS),
  )

export const planeRetestReadinessInboxLeaseMs = (
  config: PlaneRetestReadinessConfig,
) => config.maxRequestWaitMs + config.apiTimeoutMs + MIN_LEASE_SAFETY_MS

export const processPlaneRetestReadinessInbox = async ({
  config,
  adapter,
  configs,
  adapters,
  limit = DEFAULT_BATCH_SIZE,
  now = () => new Date(),
}: {
  config?: PlaneRetestReadinessConfig
  adapter?: PlaneAdapter
  configs?: Partial<Record<PlaneDestinationKey, PlaneRetestReadinessConfig>>
  adapters?: Partial<Record<PlaneDestinationKey, PlaneAdapter>>
  limit?: number
  now?: () => Date
}): Promise<
  Pick<
    PlaneRetestReadinessBatchSummary,
    'applied' | 'noOp' | 'retryDue' | 'manualAttention' | 'staleLeases'
  >
> => {
  const summary = {
    applied: 0,
    noOp: 0,
    retryDue: 0,
    manualAttention: 0,
    staleLeases: 0,
  }
  const routeConfigs = {
    ...(configs ?? {}),
    ...(config ? {[config.planeDestination]: config} : {}),
  } as Partial<Record<PlaneDestinationKey, PlaneRetestReadinessConfig>>
  const routeAdapters = {
    ...(adapters ?? {}),
    ...(config && adapter ? {[config.planeDestination]: adapter} : {}),
  } as Partial<Record<PlaneDestinationKey, PlaneAdapter>>
  const configuredLeases = Object.values(routeConfigs).map(
    (candidate) => planeRetestReadinessInboxLeaseMs(candidate),
  )
  // Claim the shared inbox once after both destination pollers have run. Each
  // event carries the durable UUID pair and is routed to exactly one adapter.
  const events =
    (await claimIntegrationInboxEvents({
      limit,
      leaseMs:
        configuredLeases.length > 0
          ? Math.max(...configuredLeases)
          : DEFAULT_LEASE_MS,
      now: now(),
      provider: PLANE_PROVIDER,
      eventType: 'plane.work_item.authoritative_state',
    })) ?? []
  for (const event of events) {
    let outcome: 'applied' | 'no_op' | 'retry_due' | 'manual_attention'
    let error: string | undefined
    let availableOn: Date | undefined
    try {
      const destination = getEventRoute(event.payload)
      const selectedConfig = destination ? routeConfigs[destination] : undefined
      const selectedAdapter = destination ? routeAdapters[destination] : undefined
      if (
        !destination ||
        !selectedConfig ||
        !selectedAdapter ||
        !planeDestinationMatchesProviderIds(
          destination,
          selectedConfig.workspaceId,
          selectedConfig.projectId,
        )
      ) {
        outcome = 'manual_attention'
        error = 'Plane readiness event destination is missing or not allowlisted'
      } else {
        const fields = getEventFields(event.payload)
        if (!fields) {
          outcome = 'manual_attention'
          error = 'Plane readiness event payload is missing work item state'
        } else {
          const workItem = await selectedAdapter.getWorkItem(fields.workItemId)
          const readinessOutcome = await applyPlaneRetestReadiness({
            workItemId: workItem.workItemId,
            stateId: workItem.stateId,
            config: selectedConfig,
            now: now(),
          })
          await reconcilePlaneRetestReadiness({
            workItemId: workItem.workItemId,
            authoritativeStateId: workItem.stateId,
            readinessOutcome,
            config: selectedConfig,
            now: now(),
          })
          if (readinessOutcome === 'manual_attention') {
            outcome = 'manual_attention'
            error = 'No active recipient is available for Plane retest readiness'
          } else {
            outcome = readinessOutcome
          }
        }
      }
    } catch (caught) {
      error = sanitizePlaneError(caught)
      if (caught instanceof PlaneAdapterError && caught.kind !== 'retryable') {
        outcome = 'manual_attention'
      } else {
        outcome = 'retry_due'
        availableOn = retryAt(now(), caught)
      }
    }

    const finalized = await finalizeIntegrationInboxEvent({
      integrationInboxId: event.integrationInboxId,
      leaseToken: event.leaseToken,
      outcome,
      ...(error ? {error} : {}),
      ...(availableOn ? {availableOn} : {}),
      now: now(),
    })
    if (!finalized) {
      summary.staleLeases += 1
    } else if (outcome === 'applied') {
      summary.applied += 1
    } else if (outcome === 'no_op') {
      summary.noOp += 1
    } else if (outcome === 'retry_due') {
      summary.retryDue += 1
    } else {
      summary.manualAttention += 1
    }
  }
  return summary
}

const emptyReadinessSummary = (): PlaneRetestReadinessBatchSummary => ({
  enabled: false,
  claimedCursor: false,
  observed: 0,
  persisted: 0,
  replayed: 0,
  applied: 0,
  noOp: 0,
  retryDue: 0,
  manualAttention: 0,
  staleLeases: 0,
})

const addReadinessSummary = (
  total: PlaneRetestReadinessBatchSummary,
  part: PlaneRetestReadinessBatchSummary,
) => {
  total.enabled ||= part.enabled
  total.claimedCursor ||= part.claimedCursor
  total.observed += part.observed
  total.persisted += part.persisted
  total.replayed += part.replayed
  total.applied += part.applied
  total.noOp += part.noOp
  total.retryDue += part.retryDue
  total.manualAttention += part.manualAttention
  total.staleLeases += part.staleLeases
}

const runPlaneRetestReadinessDestinationBatch = async ({
  environment,
  destination,
  adapter,
  requestLimiter,
  batchSize,
  leaseMs,
  now,
}: {
  environment: Environment
  destination: PlaneDestinationKey
  adapter?: PlaneAdapter
  requestLimiter?: PlaneRequestLimiter
  batchSize: number
  leaseMs: number
  now: () => Date
}): Promise<PlaneRetestReadinessBatchSummary> => {
  const summary = emptyReadinessSummary()
  const config = readPlaneRetestReadinessConfig(environment, destination)
  const maxPerPollRequestMs = config.apiTimeoutMs + config.maxRequestWaitMs
  if (leaseMs < maxPerPollRequestMs * batchSize + MIN_LEASE_SAFETY_MS) {
    throw new Error(
      'Plane readiness lease must exceed serial API limiter and timeout budget plus safety margin',
    )
  }
  summary.enabled = true
  const planeAdapter =
    adapter ??
    createPlaneAdapter(environment, fetch, requestLimiter, destination)
  const cursor = await claimIntegrationPollCursor({
    provider: PLANE_PROVIDER,
    destinationKey: config.destinationKey,
    leaseMs,
    now: now(),
  })
  if (!cursor) return summary
  summary.claimedCursor = true

  let cursorValue: string | null | undefined
  let pollError: string | null = null
  try {
    summary.manualAttention += await fenceInvalidPlaneRetestReadinessRoutes({
      now: now(),
    })
    const targets = await listPlaneRetestReadinessPollTargets({
      config,
      cursorValue: cursor.cursorValue,
      limit: batchSize,
    })
    let lastCycleId: number | null = null
    for (const target of targets) {
      const workItem = await planeAdapter.getWorkItem(target.workItemId)
      const recorded = await recordVerifiedIntegrationEvent({
        provider: PLANE_PROVIDER,
        providerDeliveryId: planePollDeliveryId({
          defectCycleId: target.defectCycleId,
          readinessGeneration: target.readinessGeneration + 1,
          workItemId: workItem.workItemId,
          stateId: workItem.stateId,
          versionMarker: workItem.versionMarker,
        }),
        eventType: 'plane.work_item.authoritative_state',
        payload: {
          workItemId: workItem.workItemId,
          stateId: workItem.stateId,
          providerWorkspaceId: config.workspaceId,
          providerProjectId: config.projectId,
          providerDestinationKey: config.planeDestination,
        },
        signatureState: 'not_applicable',
      })
      summary.observed += 1
      if (recorded.replayed) summary.replayed += 1
      else summary.persisted += 1
      lastCycleId = target.defectCycleId
    }
    cursorValue =
      targets.length === batchSize && lastCycleId !== null
        ? String(lastCycleId)
        : null
  } catch (error) {
    pollError = sanitizePlaneError(error)
    summary.retryDue += 1
  }

  const finalizedCursor = await finalizeIntegrationPollCursor({
    integrationPollCursorId: cursor.integrationPollCursorId,
    leaseToken: cursor.leaseToken,
    ...(cursorValue === undefined ? {} : {cursorValue}),
    error: pollError,
    now: now(),
  })
  if (!finalizedCursor) summary.staleLeases += 1
  if (pollError) return summary

  return summary
}

export const runConfiguredPlaneRetestReadinessBatch = async ({
  environment = process.env,
  adapter,
  adapters,
  limit,
  leaseMs = DEFAULT_LEASE_MS,
  now = () => new Date(),
}: {
  environment?: Environment
  adapter?: PlaneAdapter
  adapters?: Partial<Record<PlaneDestinationKey, PlaneAdapter>>
  limit?: number
  leaseMs?: number
  now?: () => Date
} = {}): Promise<PlaneRetestReadinessBatchSummary> => {
  const summary = emptyReadinessSummary()
  if (!isPlaneRetestReadinessEnabled(environment)) return summary

  const batchSize = limit ?? readPlaneRetestReadinessBatchSize(environment)
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `Plane readiness batch size must be between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    throw new Error('Plane readiness lease duration must be a positive integer')
  }

  // A caller-supplied adapter is a compatibility path for one-destination
  // tests and operators. The normal worker always runs both isolated routes.
  const configuredDestination =
    (environment.PLANE_DESTINATION as PlaneDestinationKey | undefined) ??
    'biz-development'
  const destinations: PlaneDestinationKey[] = adapter
    ? [configuredDestination]
    : (Object.keys(PLANE_DESTINATIONS) as PlaneDestinationKey[])
  const routeConfigs: Partial<
    Record<PlaneDestinationKey, PlaneRetestReadinessConfig>
  > = {}
  const routeAdapters: Partial<Record<PlaneDestinationKey, PlaneAdapter>> = {}
  const sharedLimiter = createPlaneRequestLimiter({
    requestsPerMinute: readPlaneAdapterConfig(environment, 'biz-development')
      .maxRequestsPerMinute,
  })
  for (const destination of destinations) {
    const routeConfig = readPlaneRetestReadinessConfig(environment, destination)
    routeConfigs[destination] = routeConfig
    const routeAdapter =
      adapters?.[destination] ??
      (destination === configuredDestination ? adapter : undefined) ??
      createPlaneAdapter(environment, fetch, sharedLimiter, destination)
    routeAdapters[destination] = routeAdapter
    addReadinessSummary(
      summary,
      await runPlaneRetestReadinessDestinationBatch({
        environment,
        destination,
        adapter: routeAdapter,
        requestLimiter: sharedLimiter,
        batchSize,
        leaseMs,
        now,
      }),
    )
  }
  const inboxSummary = await processPlaneRetestReadinessInbox({
    configs: routeConfigs,
    adapters: routeAdapters,
    limit: batchSize * destinations.length,
    now,
  })
  summary.applied += inboxSummary.applied
  summary.noOp += inboxSummary.noOp
  summary.retryDue += inboxSummary.retryDue
  summary.manualAttention += inboxSummary.manualAttention
  summary.staleLeases += inboxSummary.staleLeases
  return summary
}
