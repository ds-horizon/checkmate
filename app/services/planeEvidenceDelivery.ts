import {createHash} from 'node:crypto'
import {and, eq, lte, or, sql} from 'drizzle-orm'
import {
  planeEvidenceDeliveries,
  PlaneEvidenceIntent,
} from '@schema/resultRevisions'
import {dbClient} from '~/db/client'
import {downloadAttachment} from './s3'
import {
  PlaneAdapter,
  PlaneAdapterConfig,
  PlaneAdapterError,
  sanitizePlaneError,
} from './planeAdapter'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

type DeliveryRecord = {
  sourceKind: 'note' | 'attachment'
  sourceIdentity: string
  sourceText: string | null
  sourceObjectKey: string | null
  sourceSha256: string
  sourceContentType: string | null
  sourceByteSize: number | null
  providerResourceName: string | null
}

type Reservation =
  | {outcome: 'delivered'}
  | {outcome: 'manual_attention'; reason: string}
  | {outcome: 'reserved'; delivery: DeliveryRecord}

type ProviderIdentity = {
  providerCommentId?: string
  providerAssetId?: string
  providerAttachmentId?: string
}

export const canReservePlaneEvidenceDelivery = ({
  deliveryState,
  leaseToken,
  leaseExpiresOn,
  requestedLeaseToken,
  now,
}: {
  deliveryState: 'pending' | 'reserved' | 'retry_due' | 'delivered' | 'manual_attention'
  leaseToken: string | null
  leaseExpiresOn: Date | null
  requestedLeaseToken: string
  now: Date
}) =>
  deliveryState === 'pending' ||
  deliveryState === 'retry_due' ||
  (deliveryState === 'reserved' &&
    (leaseToken === requestedLeaseToken ||
      (leaseExpiresOn !== null && leaseExpiresOn <= now)))

export type PlaneEvidenceDeliveryStore = {
  reserve(
    intent: PlaneEvidenceIntent,
    leaseToken: string,
    leaseExpiresOn: Date,
    now: Date,
    config: PlaneAdapterConfig,
    workItemId: string,
  ): Promise<Reservation>
  complete(
    intent: PlaneEvidenceIntent,
    leaseToken: string,
    identity: ProviderIdentity,
    deliveredOn: Date,
  ): Promise<boolean>
  fail(
    intent: PlaneEvidenceIntent,
    leaseToken: string,
    outcome: 'retry_due' | 'manual_attention',
    reason: string,
  ): Promise<boolean>
}

export const planeEvidenceDeliveryStore: PlaneEvidenceDeliveryStore = {
  reserve: (intent, leaseToken, leaseExpiresOn, now, config, workItemId) =>
    dbClient.transaction(async (trx) => {
      const [delivery] = await trx
        .select({
          defectCycleId: planeEvidenceDeliveries.defectCycleId,
          resultRevisionId: planeEvidenceDeliveries.resultRevisionId,
          sourceKind: planeEvidenceDeliveries.sourceKind,
          sourceIdentity: planeEvidenceDeliveries.sourceIdentity,
          sourceText: planeEvidenceDeliveries.sourceText,
          sourceObjectKey: planeEvidenceDeliveries.sourceObjectKey,
          sourceSha256: planeEvidenceDeliveries.sourceSha256,
          sourceContentType: planeEvidenceDeliveries.sourceContentType,
          sourceByteSize: planeEvidenceDeliveries.sourceByteSize,
          providerResourceName: planeEvidenceDeliveries.providerResourceName,
          provider: planeEvidenceDeliveries.provider,
          providerWorkspaceId: planeEvidenceDeliveries.providerWorkspaceId,
          providerProjectId: planeEvidenceDeliveries.providerProjectId,
          deliveryState: planeEvidenceDeliveries.deliveryState,
          leaseToken: planeEvidenceDeliveries.leaseToken,
          leaseExpiresOn: planeEvidenceDeliveries.leaseExpiresOn,
          lastError: planeEvidenceDeliveries.lastError,
        })
        .from(planeEvidenceDeliveries)
        .where(
          eq(
            planeEvidenceDeliveries.planeEvidenceDeliveryId,
            intent.planeEvidenceDeliveryId,
          ),
        )
        .limit(1)
        .for('update')

      if (!delivery) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane evidence delivery was not found',
        }
      }
      if (
        delivery.defectCycleId !== intent.defectCycleId ||
        delivery.resultRevisionId !== intent.resultRevisionId ||
        delivery.provider !== 'plane' ||
        delivery.providerWorkspaceId !== config.workspaceId ||
        delivery.providerProjectId !== config.projectId
      ) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane evidence destination or source identity did not match',
        }
      }
      if (delivery.deliveryState === 'delivered') {
        return {outcome: 'delivered' as const}
      }
      if (delivery.deliveryState === 'manual_attention') {
        return {
          outcome: 'manual_attention' as const,
          reason: delivery.lastError ?? 'Plane evidence needs operator attention',
        }
      }
      if (!canReservePlaneEvidenceDelivery({
        deliveryState: delivery.deliveryState,
        leaseToken: delivery.leaseToken,
        leaseExpiresOn: delivery.leaseExpiresOn,
        requestedLeaseToken: leaseToken,
        now,
      })) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane evidence delivery is reserved by an active worker',
        }
      }
      if (
        delivery.deliveryState === 'reserved' &&
        delivery.leaseToken === leaseToken
      ) {
        return {
          outcome: 'reserved' as const,
          delivery: {
            sourceKind: delivery.sourceKind,
            sourceIdentity: delivery.sourceIdentity,
            sourceText: delivery.sourceText,
            sourceObjectKey: delivery.sourceObjectKey,
            sourceSha256: delivery.sourceSha256,
            sourceContentType: delivery.sourceContentType,
            sourceByteSize: delivery.sourceByteSize,
            providerResourceName: delivery.providerResourceName,
          },
        }
      }

      const result = await trx
        .update(planeEvidenceDeliveries)
        .set({
          deliveryState: 'reserved',
          leaseToken,
          leaseExpiresOn,
          providerWorkItemId: workItemId,
          attemptCount: sql`${planeEvidenceDeliveries.attemptCount} + 1`,
          lastError: null,
        })
        .where(
          and(
            eq(
              planeEvidenceDeliveries.planeEvidenceDeliveryId,
              intent.planeEvidenceDeliveryId,
            ),
            or(
              eq(planeEvidenceDeliveries.deliveryState, 'pending'),
              eq(planeEvidenceDeliveries.deliveryState, 'retry_due'),
              and(
                eq(planeEvidenceDeliveries.deliveryState, 'reserved'),
                lte(planeEvidenceDeliveries.leaseExpiresOn, now),
              ),
            ),
          ),
        )
      if (result[0].affectedRows !== 1) {
        return {
          outcome: 'manual_attention' as const,
          reason: 'Plane evidence reservation lost its fence',
        }
      }
      return {
        outcome: 'reserved' as const,
        delivery: {
          sourceKind: delivery.sourceKind,
          sourceIdentity: delivery.sourceIdentity,
          sourceText: delivery.sourceText,
          sourceObjectKey: delivery.sourceObjectKey,
          sourceSha256: delivery.sourceSha256,
          sourceContentType: delivery.sourceContentType,
          sourceByteSize: delivery.sourceByteSize,
          providerResourceName: delivery.providerResourceName,
        },
      }
    }),

  complete: async (intent, leaseToken, identity, deliveredOn) => {
    const result = await dbClient
      .update(planeEvidenceDeliveries)
      .set({
        deliveryState: 'delivered',
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: null,
        deliveredOn,
        ...identity,
      })
      .where(
        and(
          eq(
            planeEvidenceDeliveries.planeEvidenceDeliveryId,
            intent.planeEvidenceDeliveryId,
          ),
          eq(planeEvidenceDeliveries.deliveryState, 'reserved'),
          eq(planeEvidenceDeliveries.leaseToken, leaseToken),
        ),
      )
    return result[0].affectedRows === 1
  },

  fail: async (intent, leaseToken, outcome, reason) => {
    const result = await dbClient
      .update(planeEvidenceDeliveries)
      .set({
        deliveryState: outcome,
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: reason,
      })
      .where(
        and(
          eq(
            planeEvidenceDeliveries.planeEvidenceDeliveryId,
            intent.planeEvidenceDeliveryId,
          ),
          eq(planeEvidenceDeliveries.deliveryState, 'reserved'),
          eq(planeEvidenceDeliveries.leaseToken, leaseToken),
        ),
      )
    return result[0].affectedRows === 1
  },
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const noteHtml = (delivery: DeliveryRecord) => {
  const marker = `Checkmate evidence ID: ${delivery.sourceIdentity}`
  const note = escapeHtml(delivery.sourceText ?? '').replaceAll('\n', '<br>')
  return {
    marker,
    html: `<p><strong>Checkmate result evidence</strong></p><p>${note}</p><p><small>${escapeHtml(marker)}</small></p>`,
  }
}

const verifySha256 = (bytes: Buffer, expected: string) =>
  createHash('sha256').update(bytes).digest('hex') === expected

export const deliverPlaneEvidence = async ({
  intent,
  leaseToken,
  leaseExpiresOn,
  workItemId,
  config,
  planeAdapter,
  store = planeEvidenceDeliveryStore,
  download = downloadAttachment,
  clock = () => new Date(),
}: {
  intent: PlaneEvidenceIntent
  leaseToken: string
  leaseExpiresOn?: Date
  workItemId: string
  config: PlaneAdapterConfig
  planeAdapter: PlaneAdapter
  store?: PlaneEvidenceDeliveryStore
  download?: (key: string, options: {timeoutMs: number}) => Promise<Buffer>
  clock?: () => Date
}): Promise<
  | {outcome: 'delivered'}
  | {outcome: 'retry_due'; reason: string; retryAfterMs?: number}
  | {outcome: 'manual_attention'; reason: string}
> => {
  const reservation = await store.reserve(
    intent,
    leaseToken,
    leaseExpiresOn ?? new Date(clock().getTime() + config.timeoutMs),
    clock(),
    config,
    workItemId,
  )
  if (reservation.outcome !== 'reserved') return reservation

  const {delivery} = reservation
  let identity: ProviderIdentity
  try {
    if (delivery.sourceKind === 'note') {
      if (
        delivery.sourceText === null ||
        !verifySha256(Buffer.from(delivery.sourceText, 'utf8'), delivery.sourceSha256)
      ) {
        throw new PlaneAdapterError(
          'Checkmate note evidence failed its immutable checksum',
          'manual_attention',
        )
      }
      const comment = noteHtml(delivery)
      const response = await planeAdapter.ensureComment({
        workItemId,
        marker: comment.marker,
        commentHtml: comment.html,
      })
      identity = {providerCommentId: response.commentId}
    } else {
      if (
        !delivery.sourceObjectKey ||
        !delivery.sourceContentType ||
        !delivery.providerResourceName ||
        delivery.sourceByteSize === null ||
        delivery.sourceByteSize > MAX_ATTACHMENT_BYTES ||
        !ALLOWED_ATTACHMENT_TYPES.has(delivery.sourceContentType)
      ) {
        throw new PlaneAdapterError(
          'Checkmate attachment evidence violated the approved copy policy',
          'manual_attention',
        )
      }
      const bytes = await download(delivery.sourceObjectKey, {
        timeoutMs: config.timeoutMs,
      })
      if (
        bytes.byteLength !== delivery.sourceByteSize ||
        !verifySha256(bytes, delivery.sourceSha256)
      ) {
        throw new PlaneAdapterError(
          'Checkmate attachment evidence failed its immutable checksum',
          'manual_attention',
        )
      }
      const response = await planeAdapter.ensureAttachment({
        workItemId,
        name: delivery.providerResourceName,
        contentType: delivery.sourceContentType,
        bytes,
      })
      identity = {
        providerAssetId: response.assetId,
        providerAttachmentId: response.attachmentId,
      }
    }
  } catch (error) {
    const adapterError =
      error instanceof PlaneAdapterError
        ? error
        : new PlaneAdapterError(
            `Plane evidence delivery failed: ${sanitizePlaneError(error)}`,
            'retryable',
          )
    const outcome =
      adapterError.kind === 'retryable' ? 'retry_due' : 'manual_attention'
    const failed = await store.fail(
      intent,
      leaseToken,
      outcome,
      adapterError.message,
    )
    if (!failed) {
      return {
        outcome: 'manual_attention',
        reason: 'Plane evidence failure could not persist its delivery fence',
      }
    }
    return outcome === 'retry_due'
      ? {
          outcome,
          reason: adapterError.message,
          retryAfterMs: adapterError.retryAfterMs,
        }
      : {outcome, reason: adapterError.message}
  }

  const completed = await store.complete(intent, leaseToken, identity, clock())
  return completed
    ? {outcome: 'delivered'}
    : {
        outcome: 'manual_attention',
        reason: 'Plane evidence was copied but its durable mapping lost its fence',
      }
}
