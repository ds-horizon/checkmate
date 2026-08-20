import {randomUUID} from 'node:crypto'
import {and, asc, eq, inArray, lte, or, sql} from 'drizzle-orm'
import {
  resultOutbox,
  ResultRevisionCommittedPayload,
} from '@schema/resultRevisions'
import {dbClient} from '~/db/client'

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 100
const MAX_DEADLOCK_ATTEMPTS = 3

const isMySqlDeadlock = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false

  const mysqlError = error as {code?: unknown; errno?: unknown}
  return mysqlError.code === 'ER_LOCK_DEADLOCK' || mysqlError.errno === 1213
}

export type ClaimedResultOutboxEvent = {
  resultOutboxId: number
  eventKey: string
  eventType: string
  aggregateType: string
  aggregateId: number
  resultRevisionId: number
  payload: ResultRevisionCommittedPayload
  attemptCount: number
  leaseToken: string
  leaseExpiresOn: Date
}

export const claimResultOutboxEvents = async ({
  limit = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  now = new Date(),
}: {
  limit?: number
  leaseMs?: number
  now?: Date
} = {}): Promise<ClaimedResultOutboxEvent[]> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `Outbox claim limit must be between 1 and ${MAX_BATCH_SIZE}`,
    )
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    throw new Error('Outbox lease duration must be a positive integer')
  }

  const claimOnce = () =>
    dbClient.transaction(async (trx) => {
      const dueEvents = await trx
        .select({
          resultOutboxId: resultOutbox.resultOutboxId,
          eventKey: resultOutbox.eventKey,
          eventType: resultOutbox.eventType,
          aggregateType: resultOutbox.aggregateType,
          aggregateId: resultOutbox.aggregateId,
          resultRevisionId: resultOutbox.resultRevisionId,
          payload: resultOutbox.payload,
          attemptCount: resultOutbox.attemptCount,
        })
        .from(resultOutbox)
        .where(
          and(
            lte(resultOutbox.availableOn, now),
            or(
              inArray(resultOutbox.deliveryState, ['pending', 'retry_due']),
              and(
                eq(resultOutbox.deliveryState, 'leased'),
                lte(resultOutbox.leaseExpiresOn, now),
              ),
            ),
          ),
        )
        .orderBy(
          asc(resultOutbox.availableOn),
          asc(resultOutbox.resultOutboxId),
        )
        .limit(limit)
        .for('update', {skipLocked: true})

      const leaseExpiresOn = new Date(now.getTime() + leaseMs)
      const claimedEvents: ClaimedResultOutboxEvent[] = []

      for (const event of dueEvents) {
        const leaseToken = randomUUID()
        const updateResult = await trx
          .update(resultOutbox)
          .set({
            deliveryState: 'leased',
            leaseToken,
            leaseExpiresOn,
            attemptCount: sql`${resultOutbox.attemptCount} + 1`,
            lastError: null,
          })
          .where(eq(resultOutbox.resultOutboxId, event.resultOutboxId))

        if (updateResult[0].affectedRows !== 1) {
          throw new Error('Outbox claim did not affect exactly one row')
        }

        claimedEvents.push({
          ...event,
          attemptCount: event.attemptCount + 1,
          leaseToken,
          leaseExpiresOn,
        })
      }

      return claimedEvents
    })

  for (let attempt = 1; attempt <= MAX_DEADLOCK_ATTEMPTS; attempt += 1) {
    try {
      return await claimOnce()
    } catch (error) {
      if (!isMySqlDeadlock(error) || attempt === MAX_DEADLOCK_ATTEMPTS) {
        throw error
      }
    }
  }

  throw new Error('Outbox claim exhausted deadlock retries')
}

type FinalizeResultOutboxEvent = {
  resultOutboxId: number
  leaseToken: string
  outcome: 'delivered' | 'retry_due' | 'manual_attention'
  error?: string | null
  availableOn?: Date
  now?: Date
}

export const finalizeResultOutboxEvent = async ({
  resultOutboxId,
  leaseToken,
  outcome,
  error = null,
  availableOn,
  now = new Date(),
}: FinalizeResultOutboxEvent): Promise<boolean> => {
  if (outcome === 'retry_due' && !availableOn) {
    throw new Error('Retry finalization requires the next available time')
  }
  if (outcome === 'manual_attention' && !error) {
    throw new Error('Manual-attention finalization requires a reason')
  }

  const updateValues = {
    deliveryState: outcome,
    leaseToken: null,
    leaseExpiresOn: null,
    lastError: outcome === 'delivered' ? null : error,
    deliveredOn: outcome === 'delivered' ? now : null,
    ...(outcome === 'retry_due' ? {availableOn: availableOn as Date} : {}),
  }

  const result = await dbClient
    .update(resultOutbox)
    .set(updateValues)
    .where(
      and(
        eq(resultOutbox.resultOutboxId, resultOutboxId),
        eq(resultOutbox.deliveryState, 'leased'),
        eq(resultOutbox.leaseToken, leaseToken),
      ),
    )

  return result[0].affectedRows === 1
}
