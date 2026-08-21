import {and, eq} from 'drizzle-orm'
import {defectCycles, resultOutbox} from '@schema/resultRevisions'
import {dbClient} from '~/db/client'

export type PlaneDefectRetryResult =
  | {outcome: 'retried'}
  | {outcome: 'refused'; reason: string}

const validOutboxId = (value: number) =>
  Number.isInteger(value) && value > 0

/**
 * Re-enables exactly one previously failed, never-created Plane Intake.
 * This does not contact Plane and intentionally never inserts an outbox row.
 */
export const retryManualAttentionPlaneDefectCreate = async ({
  resultOutboxId,
  correlationKey,
  now = new Date(),
}: {
  resultOutboxId: number
  correlationKey: string
  now?: Date
}): Promise<PlaneDefectRetryResult> => {
  if (!validOutboxId(resultOutboxId)) {
    throw new Error('Plane defect retry requires a positive integer outbox ID')
  }
  if (!correlationKey.trim()) {
    throw new Error('Plane defect retry requires a correlation key')
  }

  return dbClient.transaction(async (trx) => {
    const [outbox] = await trx
      .select({
        eventType: resultOutbox.eventType,
        aggregateType: resultOutbox.aggregateType,
        aggregateId: resultOutbox.aggregateId,
        payload: resultOutbox.payload,
        deliveryState: resultOutbox.deliveryState,
      })
      .from(resultOutbox)
      .where(eq(resultOutbox.resultOutboxId, resultOutboxId))
      .limit(1)
      .for('update')

    const intent = outbox?.payload.planeDefectIntent
    if (
      !outbox ||
      outbox.eventType !== 'plane_defect_create_requested' ||
      outbox.aggregateType !== 'defect_cycle' ||
      outbox.deliveryState !== 'manual_attention' ||
      !intent?.create ||
      intent.defectCycleId !== outbox.aggregateId ||
      intent.correlationKey !== correlationKey
    ) {
      return {outcome: 'refused', reason: 'Outbox event is not retryable'}
    }

    const [cycle] = await trx
      .select({
        state: defectCycles.state,
        providerIntakeId: defectCycles.providerIntakeId,
        providerWorkItemId: defectCycles.providerWorkItemId,
        providerSequenceId: defectCycles.providerSequenceId,
        providerStateId: defectCycles.providerStateId,
        providerUrl: defectCycles.providerUrl,
        createCorrelationKey: defectCycles.createCorrelationKey,
      })
      .from(defectCycles)
      .where(eq(defectCycles.defectCycleId, intent.defectCycleId))
      .limit(1)
      .for('update')

    if (
      !cycle ||
      cycle.state !== 'manual_attention' ||
      cycle.createCorrelationKey !== correlationKey ||
      cycle.providerIntakeId !== null ||
      cycle.providerWorkItemId !== null ||
      cycle.providerSequenceId !== null ||
      cycle.providerStateId !== null ||
      cycle.providerUrl !== null
    ) {
      return {outcome: 'refused', reason: 'Defect cycle is not retryable'}
    }

    const cycleUpdate = await trx
      .update(defectCycles)
      .set({state: 'intake_pending'})
      .where(
        and(
          eq(defectCycles.defectCycleId, intent.defectCycleId),
          eq(defectCycles.state, 'manual_attention'),
          eq(defectCycles.createCorrelationKey, correlationKey),
        ),
      )
    if (cycleUpdate[0].affectedRows !== 1) {
      return {outcome: 'refused', reason: 'Defect cycle retry fence was lost'}
    }

    const outboxUpdate = await trx
      .update(resultOutbox)
      .set({
        deliveryState: 'pending',
        availableOn: now,
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: null,
        deliveredOn: null,
      })
      .where(
        and(
          eq(resultOutbox.resultOutboxId, resultOutboxId),
          eq(resultOutbox.deliveryState, 'manual_attention'),
        ),
      )
    if (outboxUpdate[0].affectedRows !== 1) {
      // The cycle reset above must not commit without its matching outbox
      // reset, so force the enclosing transaction to roll back.
      throw new Error('Outbox retry fence was lost')
    }
    return {outcome: 'retried'}
  })
}
