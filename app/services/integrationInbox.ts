import {createHash, randomUUID} from 'node:crypto'
import {and, asc, eq, inArray, lte, or, sql} from 'drizzle-orm'
import {
  IntegrationEventPayload,
  integrationInbox,
  integrationPollCursors,
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

const isDuplicateKey = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const mysqlError = error as {code?: unknown; errno?: unknown}
  return mysqlError.code === 'ER_DUP_ENTRY' || mysqlError.errno === 1062
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    )
  }
  return value
}

export class IntegrationInboxError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'IntegrationInboxError'
  }
}

export const fingerprintIntegrationEvent = ({
  eventType,
  payload,
}: {
  eventType: string
  payload: IntegrationEventPayload
}): string =>
  createHash('sha256')
    .update(JSON.stringify({eventType, payload: canonicalize(payload)}), 'utf8')
    .digest('hex')

export const recordVerifiedIntegrationEvent = async ({
  provider,
  providerDeliveryId,
  eventType,
  payload,
  signatureState = 'verified',
}: {
  provider: string
  providerDeliveryId: string
  eventType: string
  payload: IntegrationEventPayload
  signatureState?: 'verified' | 'not_applicable'
}): Promise<{integrationInboxId: number; replayed: boolean}> => {
  const eventFingerprint = fingerprintIntegrationEvent({eventType, payload})

  try {
    const insertResult = await dbClient.insert(integrationInbox).values({
      provider,
      providerDeliveryId,
      eventType,
      eventFingerprint,
      payload,
      signatureState,
      deliveryState: 'pending',
    })
    return {integrationInboxId: insertResult[0].insertId, replayed: false}
  } catch (error) {
    if (!isDuplicateKey(error)) throw error

    const [existing] = await dbClient
      .select({
        integrationInboxId: integrationInbox.integrationInboxId,
        eventFingerprint: integrationInbox.eventFingerprint,
      })
      .from(integrationInbox)
      .where(
        and(
          eq(integrationInbox.provider, provider),
          eq(integrationInbox.providerDeliveryId, providerDeliveryId),
        ),
      )
      .limit(1)

    if (!existing || existing.eventFingerprint !== eventFingerprint) {
      throw new IntegrationInboxError(
        'Provider delivery ID was reused with a different payload',
        409,
      )
    }
    return {integrationInboxId: existing.integrationInboxId, replayed: true}
  }
}

export type ClaimedIntegrationInboxEvent = {
  integrationInboxId: number
  provider: string
  providerDeliveryId: string
  eventType: string
  payload: IntegrationEventPayload
  attemptCount: number
  leaseToken: string
  leaseExpiresOn: Date
}

export const claimIntegrationInboxEvents = async ({
  limit = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  now = new Date(),
}: {
  limit?: number
  leaseMs?: number
  now?: Date
} = {}): Promise<ClaimedIntegrationInboxEvent[]> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(`Inbox claim limit must be between 1 and ${MAX_BATCH_SIZE}`)
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    throw new Error('Inbox lease duration must be a positive integer')
  }

  const claimOnce = () =>
    dbClient.transaction(async (trx) => {
      const dueEvents = await trx
        .select({
          integrationInboxId: integrationInbox.integrationInboxId,
          provider: integrationInbox.provider,
          providerDeliveryId: integrationInbox.providerDeliveryId,
          eventType: integrationInbox.eventType,
          payload: integrationInbox.payload,
          attemptCount: integrationInbox.attemptCount,
        })
        .from(integrationInbox)
        .where(
          and(
            lte(integrationInbox.availableOn, now),
            or(
              inArray(integrationInbox.deliveryState, ['pending', 'retry_due']),
              and(
                eq(integrationInbox.deliveryState, 'leased'),
                lte(integrationInbox.leaseExpiresOn, now),
              ),
            ),
          ),
        )
        .orderBy(
          asc(integrationInbox.availableOn),
          asc(integrationInbox.integrationInboxId),
        )
        .limit(limit)
        .for('update', {skipLocked: true})

      const leaseExpiresOn = new Date(now.getTime() + leaseMs)
      const claimed: ClaimedIntegrationInboxEvent[] = []

      for (const event of dueEvents) {
        const leaseToken = randomUUID()
        const updateResult = await trx
          .update(integrationInbox)
          .set({
            deliveryState: 'leased',
            leaseToken,
            leaseExpiresOn,
            attemptCount: sql`${integrationInbox.attemptCount} + 1`,
            lastError: null,
          })
          .where(
            eq(integrationInbox.integrationInboxId, event.integrationInboxId),
          )

        if (updateResult[0].affectedRows !== 1) {
          throw new Error('Inbox claim did not affect exactly one row')
        }
        claimed.push({
          ...event,
          attemptCount: event.attemptCount + 1,
          leaseToken,
          leaseExpiresOn,
        })
      }

      return claimed
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

  throw new Error('Inbox claim exhausted deadlock retries')
}

export const finalizeIntegrationInboxEvent = async ({
  integrationInboxId,
  leaseToken,
  outcome,
  error = null,
  availableOn,
  now = new Date(),
}: {
  integrationInboxId: number
  leaseToken: string
  outcome: 'applied' | 'no_op' | 'retry_due' | 'manual_attention'
  error?: string | null
  availableOn?: Date
  now?: Date
}): Promise<boolean> => {
  if (outcome === 'retry_due' && !availableOn) {
    throw new Error('Retry finalization requires the next available time')
  }
  if (outcome === 'manual_attention' && !error) {
    throw new Error('Manual-attention finalization requires a reason')
  }

  const result = await dbClient
    .update(integrationInbox)
    .set({
      deliveryState: outcome,
      leaseToken: null,
      leaseExpiresOn: null,
      lastError: outcome === 'applied' || outcome === 'no_op' ? null : error,
      appliedOn: outcome === 'applied' || outcome === 'no_op' ? now : null,
      ...(outcome === 'retry_due' ? {availableOn: availableOn as Date} : {}),
    })
    .where(
      and(
        eq(integrationInbox.integrationInboxId, integrationInboxId),
        eq(integrationInbox.deliveryState, 'leased'),
        eq(integrationInbox.leaseToken, leaseToken),
      ),
    )

  return result[0].affectedRows === 1
}

export const claimIntegrationPollCursor = async ({
  provider,
  destinationKey,
  leaseMs = DEFAULT_LEASE_MS,
  now = new Date(),
}: {
  provider: string
  destinationKey: string
  leaseMs?: number
  now?: Date
}): Promise<{
  integrationPollCursorId: number
  cursorValue: string | null
  leaseToken: string
  leaseExpiresOn: Date
} | null> => {
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    throw new Error('Poll lease duration must be a positive integer')
  }

  return dbClient.transaction(async (trx) => {
    const [cursor] = await trx
      .select({
        integrationPollCursorId: integrationPollCursors.integrationPollCursorId,
        cursorValue: integrationPollCursors.cursorValue,
        leaseExpiresOn: integrationPollCursors.leaseExpiresOn,
      })
      .from(integrationPollCursors)
      .where(
        and(
          eq(integrationPollCursors.provider, provider),
          eq(integrationPollCursors.destinationKey, destinationKey),
        ),
      )
      .for('update')

    if (!cursor) {
      throw new IntegrationInboxError('Poll cursor is not configured', 404)
    }
    if (cursor.leaseExpiresOn && cursor.leaseExpiresOn > now) return null

    const leaseToken = randomUUID()
    const leaseExpiresOn = new Date(now.getTime() + leaseMs)
    const result = await trx
      .update(integrationPollCursors)
      .set({leaseToken, leaseExpiresOn, lastError: null})
      .where(
        eq(
          integrationPollCursors.integrationPollCursorId,
          cursor.integrationPollCursorId,
        ),
      )

    if (result[0].affectedRows !== 1) {
      throw new Error('Poll cursor claim did not affect exactly one row')
    }
    return {...cursor, leaseToken, leaseExpiresOn}
  })
}

export const finalizeIntegrationPollCursor = async ({
  integrationPollCursorId,
  leaseToken,
  cursorValue,
  error = null,
  now = new Date(),
}: {
  integrationPollCursorId: number
  leaseToken: string
  cursorValue?: string | null
  error?: string | null
  now?: Date
}): Promise<boolean> => {
  const result = await dbClient
    .update(integrationPollCursors)
    .set({
      leaseToken: null,
      leaseExpiresOn: null,
      lastPolledOn: now,
      lastError: error,
      ...(cursorValue === undefined ? {} : {cursorValue}),
    })
    .where(
      and(
        eq(
          integrationPollCursors.integrationPollCursorId,
          integrationPollCursorId,
        ),
        eq(integrationPollCursors.leaseToken, leaseToken),
      ),
    )

  return result[0].affectedRows === 1
}
