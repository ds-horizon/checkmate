import {and, eq} from 'drizzle-orm'
import {defectCycles, PlaneDefectIntent} from '@schema/resultRevisions'
import {dbClient} from '~/db/client'
import {
  createPlaneAdapter,
  PlaneAdapter,
  PlaneAdapterConfig,
  PlaneAdapterError,
  PlaneIntakeCreateResponse,
  readPlaneAdapterConfig,
  sanitizePlaneError,
} from './planeAdapter'
import {
  PlaneDeliveryBatchSummary,
  PlaneResultDeliveryAdapter,
  runPlaneDeliveryBatch,
} from './planeDeliveryWorker'
import {
  arePlaneApiWritesEnabled,
  isPlaneDeliveryWorkerEnabled,
} from './resultRevisionFlags'

type CycleReservation =
  | {outcome: 'reserved'}
  | {outcome: 'delivered'}
  | {outcome: 'manual_attention'; reason: string}

export type PlaneDefectCycleStore = {
  reserve(
    intent: PlaneDefectIntent,
    config: PlaneAdapterConfig,
  ): Promise<CycleReservation>
  complete(
    intent: PlaneDefectIntent,
    config: PlaneAdapterConfig,
    response: PlaneIntakeCreateResponse,
    observedOn: Date,
  ): Promise<boolean>
  releaseRetry(intent: PlaneDefectIntent): Promise<boolean>
}

const providerUrl = (
  config: PlaneAdapterConfig,
  response: PlaneIntakeCreateResponse,
) =>
  response.sequenceId === null
    ? null
    : `${config.baseUrl}/${config.workspaceSlug}/browse/${config.projectIdentifier}-${response.sequenceId}/`

export const planeDefectCycleStore: PlaneDefectCycleStore = {
  reserve: (intent, config) =>
    dbClient.transaction(async (trx) => {
      const [cycle] = await trx
        .select({
          state: defectCycles.state,
          provider: defectCycles.provider,
          providerWorkspaceId: defectCycles.providerWorkspaceId,
          providerProjectId: defectCycles.providerProjectId,
          providerWorkItemId: defectCycles.providerWorkItemId,
          createCorrelationKey: defectCycles.createCorrelationKey,
        })
        .from(defectCycles)
        .where(eq(defectCycles.defectCycleId, intent.defectCycleId))
        .limit(1)
        .for('update')

      if (!cycle) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane defect cycle was not found',
        }
      }
      if (
        cycle.provider !== 'plane' ||
        cycle.providerWorkspaceId !== config.workspaceId ||
        cycle.providerProjectId !== config.projectId ||
        cycle.createCorrelationKey !== intent.correlationKey
      ) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane defect cycle destination or correlation did not match',
        }
      }
      if (cycle.providerWorkItemId) return {outcome: 'delivered' as const}
      if (cycle.state !== 'intake_pending') {
        return {
          outcome: 'manual_attention' as const,
          reason: `Plane defect cycle is not pending: ${cycle.state}`,
        }
      }

      const result = await trx
        .update(defectCycles)
        // Fail closed before the non-transactional provider call. If the
        // process exits, a later lease will not blindly create a duplicate.
        .set({state: 'manual_attention'})
        .where(
          and(
            eq(defectCycles.defectCycleId, intent.defectCycleId),
            eq(defectCycles.state, 'intake_pending'),
            eq(defectCycles.createCorrelationKey, intent.correlationKey),
          ),
        )

      return result[0].affectedRows === 1
        ? {outcome: 'reserved' as const}
        : {
            outcome: 'manual_attention' as const,
            reason: 'Plane defect cycle reservation lost its fence',
          }
    }),

  complete: async (intent, config, response, observedOn) => {
    if (
      response.projectIdentifier !== null &&
      response.projectIdentifier !== config.projectIdentifier
    ) {
      return false
    }

    const result = await dbClient
      .update(defectCycles)
      .set({
        state: response.intakeId ? 'intake_open' : 'work_item_open',
        providerIntakeId: response.intakeId,
        providerWorkItemId: response.workItemId,
        providerSequenceId: response.sequenceId,
        providerUrl: providerUrl(config, response),
        lastProviderObservedOn: observedOn,
      })
      .where(
        and(
          eq(defectCycles.defectCycleId, intent.defectCycleId),
          eq(defectCycles.state, 'manual_attention'),
          eq(defectCycles.createCorrelationKey, intent.correlationKey),
        ),
      )

    return result[0].affectedRows === 1
  },

  releaseRetry: async (intent) => {
    const result = await dbClient
      .update(defectCycles)
      .set({state: 'intake_pending'})
      .where(
        and(
          eq(defectCycles.defectCycleId, intent.defectCycleId),
          eq(defectCycles.state, 'manual_attention'),
          eq(defectCycles.createCorrelationKey, intent.correlationKey),
        ),
      )

    return result[0].affectedRows === 1
  },
}

export const createPlaneResultDeliveryAdapter = ({
  config,
  planeAdapter,
  cycleStore = planeDefectCycleStore,
  clock = () => new Date(),
}: {
  config: PlaneAdapterConfig
  planeAdapter: PlaneAdapter
  cycleStore?: PlaneDefectCycleStore
  clock?: () => Date
}): PlaneResultDeliveryAdapter => ({
  maxDeliveryMs: config.timeoutMs,
  async deliverResultRevision(event) {
    const intent = event.payload.planeDefectIntent
    if (!intent?.create) return {outcome: 'delivered'}

    const reservation = await cycleStore.reserve(intent, config)
    if (reservation.outcome === 'delivered') return reservation
    if (reservation.outcome === 'manual_attention') return reservation

    let response: PlaneIntakeCreateResponse
    try {
      response = await planeAdapter.createIntake({
        title: intent.title,
        description: intent.description,
        priority: intent.priority,
      })
    } catch (error) {
      if (error instanceof PlaneAdapterError && error.kind === 'retryable') {
        const released = await cycleStore.releaseRetry(intent)
        return released
          ? {
              outcome: 'retry_due',
              reason: error.message,
              retryAfterMs: error.retryAfterMs,
            }
          : {
              outcome: 'manual_attention',
              reason: 'Plane retry could not release its cycle reservation',
            }
      }
      return {
        outcome: 'manual_attention',
        reason:
          error instanceof PlaneAdapterError
            ? error.message
            : sanitizePlaneError(error),
      }
    }

    const completed = await cycleStore.complete(
      intent,
      config,
      response,
      clock(),
    )
    return completed
      ? {outcome: 'delivered'}
      : {
          outcome: 'manual_attention',
          reason:
            'Plane intake was created but durable cycle correlation failed',
        }
  },
})

export const runConfiguredPlaneDeliveryBatch = async ({
  environment = process.env,
  limit,
  leaseMs,
}: {
  environment?: Readonly<Record<string, string | undefined>>
  limit?: number
  leaseMs?: number
} = {}): Promise<PlaneDeliveryBatchSummary> => {
  if (
    !isPlaneDeliveryWorkerEnabled(environment) ||
    !arePlaneApiWritesEnabled(environment)
  ) {
    return runPlaneDeliveryBatch({
      adapter: {
        maxDeliveryMs: 1,
        deliverResultRevision: async () => ({outcome: 'delivered'}),
      },
      environment,
      limit,
      leaseMs,
    })
  }

  const config = readPlaneAdapterConfig(environment)
  const adapter = createPlaneResultDeliveryAdapter({
    config,
    planeAdapter: createPlaneAdapter(environment),
  })
  return runPlaneDeliveryBatch({adapter, environment, limit, leaseMs})
}
