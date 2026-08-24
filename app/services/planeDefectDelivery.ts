import {and, eq} from 'drizzle-orm'
import {
  defectCycles,
  PlaneCycleActionIntent,
  PlaneDefectIntent,
  PlaneEvidenceIntent,
} from '@schema/resultRevisions'
import {dbClient} from '~/db/client'
import {
  createPlaneAdapter,
  createPlaneRequestLimiter,
  MAX_PLANE_API_REQUESTS_PER_DELIVERY,
  PlaneAdapter,
  PlaneAdapterConfig,
  PlaneAdapterError,
  PlaneIntakeCreateResponse,
  readPlaneAdapterConfig,
  sanitizePlaneError,
} from './planeAdapter'
import {
  PLANE_DESTINATIONS,
  PlaneDestinationKey,
  planeDestinationForProviderIds,
  planeDestinationStateId,
} from './planeRouting'
import {
  PlaneDeliveryBatchSummary,
  PlaneResultDeliveryAdapter,
  runPlaneDeliveryBatch,
} from './planeDeliveryWorker'
import {
  arePlaneApiWritesEnabled,
  isPlaneDeliveryWorkerEnabled,
  isPlaneEvidenceCopyEnabled,
} from './resultRevisionFlags'
import {
  deliverPlaneEvidence,
  PlaneEvidenceDeliveryStore,
} from './planeEvidenceDelivery'

type CycleReservation =
  | {outcome: 'reserved'}
  | {outcome: 'delivered'}
  | {outcome: 'manual_attention'; reason: string}

type LinkedWorkItem =
  | {outcome: 'linked'; workItemId: string}
  | {outcome: 'retry_due'; reason: string; retryAfterMs?: number}
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
  resolveLinkedWorkItem(
    intent: PlaneEvidenceIntent,
    config: PlaneAdapterConfig,
  ): Promise<LinkedWorkItem>
  reserveCycleAction(
    intent: PlaneCycleActionIntent,
    config: PlaneAdapterConfig,
  ): Promise<CycleReservation>
  completeCycleAction(intent: PlaneCycleActionIntent): Promise<boolean>
  markCycleActionManualAttention(intent: PlaneCycleActionIntent): Promise<void>
}

const providerUrl = (
  config: PlaneAdapterConfig,
  response: PlaneIntakeCreateResponse,
) =>
  response.sequenceId === null
    ? null
    : `${config.publicBaseUrl}/${config.workspaceSlug}/browse/${config.projectIdentifier}-${response.sequenceId}/`

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

  resolveLinkedWorkItem: async (intent, config) => {
    const [cycle] = await dbClient
      .select({
        provider: defectCycles.provider,
        providerWorkspaceId: defectCycles.providerWorkspaceId,
        providerProjectId: defectCycles.providerProjectId,
        providerWorkItemId: defectCycles.providerWorkItemId,
        state: defectCycles.state,
      })
      .from(defectCycles)
      .where(eq(defectCycles.defectCycleId, intent.defectCycleId))
      .limit(1)

    if (!cycle) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane defect cycle was not found for evidence delivery',
      }
    }
    if (
      cycle.provider !== 'plane' ||
      cycle.providerWorkspaceId !== config.workspaceId ||
      cycle.providerProjectId !== config.projectId
    ) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane evidence cycle destination did not match',
      }
    }
    if (cycle.providerWorkItemId) {
      return {outcome: 'linked', workItemId: cycle.providerWorkItemId}
    }
    if (cycle.state === 'intake_pending') {
      return {
        outcome: 'retry_due',
        reason: 'Plane evidence is waiting for the defect work item',
        retryAfterMs: 5_000,
      }
    }
    return {
      outcome: 'manual_attention',
      reason: `Plane evidence has no linked work item in cycle state: ${cycle.state}`,
    }
  },

  reserveCycleAction: async (intent, config) => {
    const [cycle] = await dbClient
      .select({
        state: defectCycles.state,
        provider: defectCycles.provider,
        providerWorkspaceId: defectCycles.providerWorkspaceId,
        providerProjectId: defectCycles.providerProjectId,
        providerWorkItemId: defectCycles.providerWorkItemId,
        reopenState: defectCycles.reopenState,
        reopenRevisionId: defectCycles.reopenRevisionId,
      })
      .from(defectCycles)
      .where(eq(defectCycles.defectCycleId, intent.defectCycleId))
      .limit(1)

    if (!cycle) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane defect cycle was not found for lifecycle delivery',
      }
    }
    if (
      cycle.provider !== 'plane' ||
      cycle.providerWorkspaceId !== config.workspaceId ||
      cycle.providerProjectId !== config.projectId ||
      cycle.providerWorkItemId !== intent.workItemId
    ) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane lifecycle action destination did not match',
      }
    }

    if (intent.action === 'different_issue_superseded') {
      return cycle.state === 'superseded'
        ? {outcome: 'reserved'}
        : {
            outcome: 'manual_attention',
            reason: `Plane lifecycle action found cycle state: ${cycle.state}`,
          }
    }

    if (intent.action === 'validated_pass') {
      return cycle.state === 'validated'
        ? {outcome: 'reserved'}
        : {
            outcome: 'manual_attention',
            reason: `Plane validation notice found cycle state: ${cycle.state}`,
          }
    }

    if (
      cycle.reopenRevisionId !== intent.resultRevisionId ||
      cycle.state !== 'work_item_open'
    ) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane reopen action lost its cycle revision fence',
      }
    }
    if (cycle.reopenState === 'delivered' || cycle.reopenState === 'observed') {
      return {outcome: 'delivered'}
    }
    return cycle.reopenState === 'pending'
      ? {outcome: 'reserved'}
      : {
          outcome: 'manual_attention',
          reason: `Plane reopen action found reopen state: ${cycle.reopenState}`,
        }
  },

  completeCycleAction: async (intent) => {
    if (intent.action !== 'same_issue_reopen') return true
    const result = await dbClient
      .update(defectCycles)
      .set({reopenState: 'delivered'})
      .where(
        and(
          eq(defectCycles.defectCycleId, intent.defectCycleId),
          eq(defectCycles.reopenRevisionId, intent.resultRevisionId),
          eq(defectCycles.reopenState, 'pending'),
        ),
      )
    return result[0].affectedRows === 1
  },

  markCycleActionManualAttention: async (intent) => {
    if (intent.action !== 'same_issue_reopen') return
    await dbClient
      .update(defectCycles)
      .set({reopenState: 'manual_attention'})
      .where(
        and(
          eq(defectCycles.defectCycleId, intent.defectCycleId),
          eq(defectCycles.reopenRevisionId, intent.resultRevisionId),
          eq(defectCycles.reopenState, 'pending'),
        ),
      )
  },
}

export const createPlaneResultDeliveryAdapter = ({
  config,
  planeAdapter,
  cycleStore = planeDefectCycleStore,
  evidenceCopyEnabled = false,
  evidenceStore,
  reopenStateId,
  clock = () => new Date(),
}: {
  config: PlaneAdapterConfig
  planeAdapter: PlaneAdapter
  cycleStore?: PlaneDefectCycleStore
  evidenceCopyEnabled?: boolean
  evidenceStore?: PlaneEvidenceDeliveryStore
  reopenStateId?: string
  clock?: () => Date
}): PlaneResultDeliveryAdapter => ({
  // Lease safety covers every documented Plane API request, including its
  // proactive limiter wait immediately before the request and its timeout.
  maxDeliveryMs:
    MAX_PLANE_API_REQUESTS_PER_DELIVERY *
    (config.timeoutMs + config.maxRequestWaitMs),
  async deliverResultRevision(event) {
    const actionIntent = event.payload.planeCycleActionIntent
    if (actionIntent) {
      const reservation = await cycleStore.reserveCycleAction(
        actionIntent,
        config,
      )
      if (reservation.outcome !== 'reserved') return reservation
      try {
        await planeAdapter.ensureComment({
          workItemId: actionIntent.workItemId,
          marker: actionIntent.marker,
          commentHtml: actionIntent.commentHtml,
        })
        if (actionIntent.action === 'same_issue_reopen') {
          if (!reopenStateId) {
            await cycleStore.markCycleActionManualAttention(actionIntent)
            return {
              outcome: 'manual_attention',
              reason: 'Plane reopen state is not configured',
            }
          }
          await planeAdapter.ensureWorkItemState({
            workItemId: actionIntent.workItemId,
            stateId: reopenStateId,
          })
        }
      } catch (error) {
        if (error instanceof PlaneAdapterError && error.kind === 'retryable') {
          return {
            outcome: 'retry_due',
            reason: error.message,
            retryAfterMs: error.retryAfterMs,
          }
        }
        await cycleStore.markCycleActionManualAttention(actionIntent)
        return {
          outcome: 'manual_attention',
          reason:
            error instanceof PlaneAdapterError
              ? error.message
              : sanitizePlaneError(error),
        }
      }
      const completed = await cycleStore.completeCycleAction(actionIntent)
      return completed
        ? {outcome: 'delivered'}
        : {
            outcome: 'manual_attention',
            reason: 'Plane lifecycle action lost its completion fence',
          }
    }

    const evidenceIntent = event.payload.planeEvidenceIntent
    if (evidenceIntent) {
      if (!evidenceCopyEnabled) {
        return {
          outcome: 'retry_due',
          reason: 'Plane evidence copy is disabled',
          retryAfterMs: 60 * 60 * 1000,
        }
      }
      const linkedWorkItem = await cycleStore.resolveLinkedWorkItem(
        evidenceIntent,
        config,
      )
      if (linkedWorkItem.outcome !== 'linked') return linkedWorkItem
      return deliverPlaneEvidence({
        intent: evidenceIntent,
        leaseToken: event.leaseToken,
        leaseExpiresOn: event.leaseExpiresOn,
        workItemId: linkedWorkItem.workItemId,
        config,
        planeAdapter,
        ...(evidenceStore ? {store: evidenceStore} : {}),
        clock,
      })
    }

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

export const createPlaneDestinationDeliveryAdapters = ({
  environment,
  requestLimiter,
}: {
  environment: Readonly<Record<string, string | undefined>>
  requestLimiter?: ReturnType<typeof createPlaneRequestLimiter>
}) => {
  const configured = readPlaneAdapterConfig(environment)
  const sharedLimiter =
    requestLimiter ??
    createPlaneRequestLimiter({
      requestsPerMinute: configured.maxRequestsPerMinute,
    })
  const destinationKeys = Object.keys(PLANE_DESTINATIONS) as PlaneDestinationKey[]
  return new Map(
    destinationKeys.map((destinationKey) => {
      const routeConfig = readPlaneAdapterConfig(environment, destinationKey)
      return [
        destinationKey,
        createPlaneResultDeliveryAdapter({
          config: routeConfig,
          planeAdapter: createPlaneAdapter(
            environment,
            fetch,
            sharedLimiter,
            destinationKey,
          ),
          evidenceCopyEnabled: isPlaneEvidenceCopyEnabled(environment),
          reopenStateId:
            planeDestinationStateId(destinationKey, 'todo') ??
            (environment.PLANE_RETEST_REOPEN_STATE_ID?.trim() || undefined),
        }),
      ] as const
    }),
  )
}

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

  const configuredLeaseMs = environment.PLANE_DELIVERY_LEASE_MS
  const environmentLeaseMs =
    configuredLeaseMs === undefined ? undefined : Number(configuredLeaseMs)
  if (
    environmentLeaseMs !== undefined &&
    (!Number.isInteger(environmentLeaseMs) || environmentLeaseMs < 1)
  ) {
    throw new Error('PLANE_DELIVERY_LEASE_MS must be a positive integer')
  }
  const adapters = createPlaneDestinationDeliveryAdapters({environment})
  const adapter: PlaneResultDeliveryAdapter = {
    maxDeliveryMs: Math.max(
      ...Array.from(adapters.values()).map(
        (candidate) => candidate.maxDeliveryMs,
      ),
    ),
    async deliverResultRevision(event) {
      const payload = event.payload
      const intents = [
        payload.planeCycleActionIntent,
        payload.planeEvidenceIntent,
        payload.planeDefectIntent,
      ].filter((intent): intent is NonNullable<typeof intent> => Boolean(intent))
      // Events without a Plane intent have no provider work to perform. Keep
      // the legacy idempotent no-op behavior; only an explicit, malformed
      // destination is rejected below.
      if (intents.length === 0) return {outcome: 'delivered'}
      const destinationKeys = intents.map((intent) =>
        planeDestinationForProviderIds(
          intent.providerWorkspaceId,
          intent.providerProjectId,
        ),
      )
      const destinationKey = destinationKeys[0]
      if (
        !destinationKey ||
        destinationKeys.some((candidate) => candidate !== destinationKey)
      ) {
        return {
          outcome: 'manual_attention',
          reason: 'Plane event destination is not allowlisted',
        }
      }
      const selected = adapters.get(destinationKey)
      if (!selected) {
        return {
          outcome: 'manual_attention',
          reason: 'Plane event destination is not configured',
        }
      }
      return selected.deliverResultRevision(event)
    },
  }
  return runPlaneDeliveryBatch({
    adapter,
    environment,
    limit,
    leaseMs: leaseMs ?? environmentLeaseMs,
  })
}
