import {createHash} from 'node:crypto'
import type {PlaneEvidenceIntent} from '@schema/resultRevisions'
import type {PlaneAdapter, PlaneAdapterConfig} from '../planeAdapter'
import {PlaneAdapterError} from '../planeAdapter'
import {
  deliverPlaneEvidence,
  canReservePlaneEvidenceDelivery,
  PlaneEvidenceDeliveryStore,
} from '../planeEvidenceDelivery'

const config: PlaneAdapterConfig = {
  baseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'secret-api-key',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  workspaceSlug: 'infinimind',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
  timeoutMs: 10_000,
}

const intent: PlaneEvidenceIntent = {
  planeEvidenceDeliveryId: 74,
  defectCycleId: 73,
  resultRevisionId: 41,
}

const sha256 = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex')

const createAdapter = (): jest.Mocked<PlaneAdapter> => ({
  createIntake: jest.fn<
    ReturnType<PlaneAdapter['createIntake']>,
    Parameters<PlaneAdapter['createIntake']>
  >(),
  getWorkItem: jest.fn<
    ReturnType<PlaneAdapter['getWorkItem']>,
    Parameters<PlaneAdapter['getWorkItem']>
  >(),
  ensureComment: jest.fn<
    ReturnType<PlaneAdapter['ensureComment']>,
    Parameters<PlaneAdapter['ensureComment']>
  >(async () => ({commentId: 'comment-id'})),
  ensureAttachment: jest.fn<
    ReturnType<PlaneAdapter['ensureAttachment']>,
    Parameters<PlaneAdapter['ensureAttachment']>
  >(async () => ({
    assetId: 'asset-id',
    attachmentId: 'attachment-id',
  })),
  ensureWorkItemState: jest.fn<
    ReturnType<PlaneAdapter['ensureWorkItemState']>,
    Parameters<PlaneAdapter['ensureWorkItemState']>
  >(),
})

type ReservedDelivery = Extract<
  Awaited<ReturnType<PlaneEvidenceDeliveryStore['reserve']>>,
  {outcome: 'reserved'}
>['delivery']

const createStore = (
  delivery: ReservedDelivery,
): jest.Mocked<PlaneEvidenceDeliveryStore> => ({
  reserve: jest.fn<
    ReturnType<PlaneEvidenceDeliveryStore['reserve']>,
    Parameters<PlaneEvidenceDeliveryStore['reserve']>
  >(async () => ({outcome: 'reserved', delivery})),
  complete: jest.fn<
    ReturnType<PlaneEvidenceDeliveryStore['complete']>,
    Parameters<PlaneEvidenceDeliveryStore['complete']>
  >(async () => true),
  fail: jest.fn<
    ReturnType<PlaneEvidenceDeliveryStore['fail']>,
    Parameters<PlaneEvidenceDeliveryStore['fail']>
  >(async () => true),
})

describe('Plane evidence delivery', () => {
  it('rejects a concurrent foreign reservation until its lease expires', () => {
    const now = new Date('2026-08-20T00:00:00.000Z')
    expect(
      canReservePlaneEvidenceDelivery({
        deliveryState: 'reserved',
        leaseToken: 'lease-one',
        leaseExpiresOn: new Date('2026-08-20T00:00:01.000Z'),
        requestedLeaseToken: 'lease-two',
        now,
      }),
    ).toBe(false)
    expect(
      canReservePlaneEvidenceDelivery({
        deliveryState: 'reserved',
        leaseToken: 'lease-one',
        leaseExpiresOn: now,
        requestedLeaseToken: 'lease-two',
        now,
      }),
    ).toBe(true)
  })

  it('escapes a tester note and persists its provider comment identity', async () => {
    const note = 'Checkout <fails>\nUse "guest" & retry'
    const store = createStore({
      sourceKind: 'note',
      sourceIdentity: 'result-revision:41:note',
      sourceText: note,
      sourceObjectKey: null,
      sourceSha256: sha256(note),
      sourceContentType: 'text/plain; charset=utf-8',
      sourceByteSize: Buffer.byteLength(note),
      providerResourceName: 'Checkmate result revision 1',
    })
    const adapter = createAdapter()
    const deliveredOn = new Date('2026-08-20T00:00:30.000Z')

    await expect(
      deliverPlaneEvidence({
        intent,
        leaseToken: 'lease-one',
        workItemId: 'work-item-id',
        config,
        planeAdapter: adapter,
        store,
        clock: () => deliveredOn,
      }),
    ).resolves.toEqual({outcome: 'delivered'})
    expect(adapter.ensureComment).toHaveBeenCalledWith({
      workItemId: 'work-item-id',
      marker: 'Checkmate evidence ID: result-revision:41:note',
      commentHtml: expect.stringContaining(
        'Checkout &lt;fails&gt;<br>Use &quot;guest&quot; &amp; retry',
      ),
    })
    expect(store.complete).toHaveBeenCalledWith(
      intent,
      'lease-one',
      {providerCommentId: 'comment-id'},
      deliveredOn,
    )
  })

  it('downloads and revalidates an approved image before native upload', async () => {
    const bytes = Buffer.from('verified-png-bytes')
    const store = createStore({
      sourceKind: 'attachment',
      sourceIdentity: 'result-attachment:51:sha',
      sourceText: null,
      sourceObjectKey: 'test-run-attachments/proof.png',
      sourceSha256: sha256(bytes),
      sourceContentType: 'image/png',
      sourceByteSize: bytes.byteLength,
      providerResourceName: 'checkmate-51-proof.png',
    })
    const adapter = createAdapter()
    const download = jest.fn(async () => bytes)

    await expect(
      deliverPlaneEvidence({
        intent,
        leaseToken: 'lease-one',
        workItemId: 'work-item-id',
        config,
        planeAdapter: adapter,
        store,
        download,
      }),
    ).resolves.toEqual({outcome: 'delivered'})
    expect(download).toHaveBeenCalledWith('test-run-attachments/proof.png', {
      timeoutMs: config.timeoutMs,
    })
    expect(adapter.ensureAttachment).toHaveBeenCalledWith({
      workItemId: 'work-item-id',
      name: 'checkmate-51-proof.png',
      contentType: 'image/png',
      bytes,
    })
  })

  it('rejects disallowed attachment content before downloading it', async () => {
    const store = createStore({
      sourceKind: 'attachment',
      sourceIdentity: 'result-attachment:51:sha',
      sourceText: null,
      sourceObjectKey: 'test-run-attachments/proof.pdf',
      sourceSha256: sha256('pdf'),
      sourceContentType: 'application/pdf',
      sourceByteSize: 3,
      providerResourceName: 'checkmate-51-proof.pdf',
    })
    const adapter = createAdapter()
    const download = jest.fn(async () => Buffer.from('pdf'))

    await expect(
      deliverPlaneEvidence({
        intent,
        leaseToken: 'lease-one',
        workItemId: 'work-item-id',
        config,
        planeAdapter: adapter,
        store,
        download,
      }),
    ).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'Checkmate attachment evidence violated the approved copy policy',
    })
    expect(download).not.toHaveBeenCalled()
    expect(store.fail).toHaveBeenCalledWith(
      intent,
      'lease-one',
      'manual_attention',
      expect.any(String),
    )
  })

  it('marks transient source download failures retryable', async () => {
    const store = createStore({
      sourceKind: 'attachment',
      sourceIdentity: 'result-attachment:51:sha',
      sourceText: null,
      sourceObjectKey: 'test-run-attachments/proof.png',
      sourceSha256: sha256('png'),
      sourceContentType: 'image/png',
      sourceByteSize: 3,
      providerResourceName: 'checkmate-51-proof.png',
    })

    await expect(
      deliverPlaneEvidence({
        intent,
        leaseToken: 'lease-one',
        workItemId: 'work-item-id',
        config,
        planeAdapter: createAdapter(),
        store,
        download: jest.fn(async () => {
          throw new Error('S3 temporarily unavailable')
        }),
      }),
    ).resolves.toEqual({
      outcome: 'retry_due',
      reason: 'Plane evidence delivery failed: S3 temporarily unavailable',
      retryAfterMs: undefined,
    })
    expect(store.fail).toHaveBeenCalledWith(
      intent,
      'lease-one',
      'retry_due',
      expect.any(String),
    )
  })

  it('fails closed when Plane may already hold a native attachment slot', async () => {
    const bytes = Buffer.from('verified-png-bytes')
    const store = createStore({
      sourceKind: 'attachment',
      sourceIdentity: 'result-attachment:51:sha',
      sourceText: null,
      sourceObjectKey: 'test-run-attachments/proof.png',
      sourceSha256: sha256(bytes),
      sourceContentType: 'image/png',
      sourceByteSize: bytes.byteLength,
      providerResourceName: 'checkmate-51-proof.png',
    })
    const adapter = createAdapter()
    adapter.ensureAttachment.mockRejectedValue(
      new PlaneAdapterError(
        'object upload outcome is unknown',
        'manual_attention',
      ),
    )

    await expect(
      deliverPlaneEvidence({
        intent,
        leaseToken: 'lease-one',
        workItemId: 'work-item-id',
        config,
        planeAdapter: adapter,
        store,
        download: jest.fn(async () => bytes),
      }),
    ).resolves.toEqual({
      outcome: 'manual_attention',
      reason: 'object upload outcome is unknown',
    })
  })
})
