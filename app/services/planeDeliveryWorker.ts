import type {
  PlaneCycleActionIntent,
  PlaneDefectIntent,
  ResultRevisionCommittedPayload,
} from '@schema/resultRevisions'
import {
  claimResultOutboxEvents,
  ClaimedResultOutboxEvent,
  finalizeResultOutboxEvent,
} from './resultOutbox'
import {
  arePlaneApiWritesEnabled,
  isPlaneDeliveryWorkerEnabled,
} from './resultRevisionFlags'
import {PlaneAdapterError, sanitizePlaneError} from './planeAdapter'

const DEFAULT_RETRY_DELAY_MS = 60_000
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000
const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 100
const DEFAULT_LEASE_MS = 70_000
const MIN_LEASE_SAFETY_MS = 5_000

export type PlaneDeliveryPayload = ResultRevisionCommittedPayload & {
  planeDefectIntent?: PlaneDefectIntent
  planeCycleActionIntent?: PlaneCycleActionIntent
}

export type PlaneResultDeliveryAdapter = {
  maxDeliveryMs: number
  deliverResultRevision(
    event: ClaimedResultOutboxEvent & {payload: PlaneDeliveryPayload},
  ): Promise<
    | {outcome: 'delivered'}
    | {outcome: 'retry_due'; reason: string; retryAfterMs?: number}
    | {outcome: 'manual_attention'; reason: string}
  >
}

export type PlaneDeliveryBatchSummary = {
  enabled: boolean
  claimed: number
  delivered: number
  skippedWithoutIntent: number
  retryDue: number
  manualAttention: number
  staleLeases: number
}

const boundedRetryDelay = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RETRY_DELAY_MS
  }
  return Math.max(1, Math.min(Math.trunc(value), MAX_RETRY_DELAY_MS))
}

const messageFromUnknown = (error: unknown) =>
  error instanceof Error
    ? sanitizePlaneError(error)
    : 'Unexpected Plane delivery error'

export const runPlaneDeliveryBatch = async ({
  adapter,
  environment = process.env,
  limit,
  leaseMs,
  clock = () => new Date(),
}: {
  adapter: PlaneResultDeliveryAdapter
  environment?: Readonly<Record<string, string | undefined>>
  limit?: number
  leaseMs?: number
  clock?: () => Date
}): Promise<PlaneDeliveryBatchSummary> => {
  const summary: PlaneDeliveryBatchSummary = {
    enabled: false,
    claimed: 0,
    delivered: 0,
    skippedWithoutIntent: 0,
    retryDue: 0,
    manualAttention: 0,
    staleLeases: 0,
  }

  if (
    !isPlaneDeliveryWorkerEnabled(environment) ||
    !arePlaneApiWritesEnabled(environment)
  ) {
    return summary
  }
  summary.enabled = true

  const batchSize = limit ?? DEFAULT_BATCH_SIZE
  const effectiveLeaseMs = leaseMs ?? DEFAULT_LEASE_MS
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `Plane delivery batch size must be between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  if (!Number.isInteger(adapter.maxDeliveryMs) || adapter.maxDeliveryMs < 1) {
    throw new Error(
      'Plane adapter max delivery time must be a positive integer',
    )
  }
  if (effectiveLeaseMs < adapter.maxDeliveryMs + MIN_LEASE_SAFETY_MS) {
    throw new Error(
      'Plane outbox lease must exceed the adapter delivery timeout',
    )
  }

  for (let index = 0; index < batchSize; index += 1) {
    const claimNow = clock()
    const [rawEvent] = await claimResultOutboxEvents({
      limit: 1,
      leaseMs: effectiveLeaseMs,
      now: claimNow,
    })
    if (!rawEvent) break
    summary.claimed += 1
    const event = rawEvent as ClaimedResultOutboxEvent & {
      payload: PlaneDeliveryPayload
    }
    const defectIntent = event.payload.planeDefectIntent
    const evidenceIntent = event.payload.planeEvidenceIntent
    const actionIntent = event.payload.planeCycleActionIntent

    if (!defectIntent?.create && !evidenceIntent && !actionIntent) {
      const finalized = await finalizeResultOutboxEvent({
        resultOutboxId: event.resultOutboxId,
        leaseToken: event.leaseToken,
        outcome: 'delivered',
        now: clock(),
      })
      if (finalized) {
        summary.delivered += 1
        summary.skippedWithoutIntent += 1
      } else {
        summary.staleLeases += 1
      }
      continue
    }

    let finalization:
      | {outcome: 'delivered'; error?: null; availableOn?: undefined}
      | {outcome: 'retry_due'; error: string; availableOn: Date}
      | {outcome: 'manual_attention'; error: string; availableOn?: undefined}

    try {
      const result = await adapter.deliverResultRevision(event)
      const completedOn = clock()
      if (result.outcome === 'delivered') {
        finalization = {outcome: 'delivered'}
      } else if (result.outcome === 'retry_due') {
        finalization = {
          outcome: 'retry_due',
          error: result.reason,
          availableOn: new Date(
            completedOn.getTime() + boundedRetryDelay(result.retryAfterMs),
          ),
        }
      } else {
        finalization = {
          outcome: 'manual_attention',
          error: result.reason,
        }
      }
    } catch (error) {
      if (error instanceof PlaneAdapterError && error.kind === 'retryable') {
        const completedOn = clock()
        finalization = {
          outcome: 'retry_due',
          error: error.message,
          availableOn: new Date(
            completedOn.getTime() + boundedRetryDelay(error.retryAfterMs),
          ),
        }
      } else {
        finalization = {
          outcome: 'manual_attention',
          error: messageFromUnknown(error),
        }
      }
    }

    const finalized = await finalizeResultOutboxEvent({
      resultOutboxId: event.resultOutboxId,
      leaseToken: event.leaseToken,
      ...finalization,
      now: clock(),
    })
    if (!finalized) {
      summary.staleLeases += 1
    } else if (finalization.outcome === 'delivered') {
      summary.delivered += 1
    } else if (finalization.outcome === 'retry_due') {
      summary.retryDue += 1
    } else {
      summary.manualAttention += 1
    }
  }

  return summary
}
