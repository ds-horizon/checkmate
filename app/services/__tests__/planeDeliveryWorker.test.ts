const claimResultOutboxEvents = jest.fn()
const finalizeResultOutboxEvent = jest.fn()

jest.mock('../resultOutbox', () => ({
  claimResultOutboxEvents,
  finalizeResultOutboxEvent,
}))

import {PlaneAdapterError} from '../planeAdapter'
import {runPlaneDeliveryBatch} from '../planeDeliveryWorker'

const environment = {
  PLANE_DELIVERY_WORKER_ENABLED: 'true',
  PLANE_API_WRITES_ENABLED: 'true',
}

const baseEvent = {
  resultOutboxId: 31,
  eventKey: 'result-revision:41:committed',
  eventType: 'result_revision_committed',
  aggregateType: 'test_run_map',
  aggregateId: 17,
  resultRevisionId: 41,
  payload: {
    resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
    resultRevisionId: 41,
    revisionNumber: 1,
    testRunMapId: 17,
    orgId: 3,
    projectId: 5,
    runId: 7,
    testId: 11,
    status: 'Failed',
    actorUserId: 23,
    actorType: 'human' as const,
    sourceSystem: 'checkmate' as const,
  },
  attemptCount: 1,
  leaseToken: 'lease-one',
  leaseExpiresOn: new Date('2026-08-20T00:01:00.000Z'),
}

const withIntent = {
  ...baseEvent,
  payload: {
    ...baseEvent.payload,
    planeDefectIntent: {
      create: true as const,
      title: 'Failed Checkmate step',
      description: 'Evidence',
      priority: 'high' as const,
    },
  },
}

describe('Plane delivery worker', () => {
  beforeEach(() => {
    claimResultOutboxEvents.mockReset()
    finalizeResultOutboxEvent.mockReset()
    finalizeResultOutboxEvent.mockResolvedValue(true)
  })

  it('does not claim work unless both kill switches are enabled', async () => {
    const adapter = {maxDeliveryMs: 10_000, deliverResultRevision: jest.fn()}

    await expect(
      runPlaneDeliveryBatch({adapter, environment: {}}),
    ).resolves.toEqual(
      expect.objectContaining({enabled: false, claimed: 0}),
    )
    await expect(
      runPlaneDeliveryBatch({
        adapter,
        environment: {PLANE_DELIVERY_WORKER_ENABLED: 'true'},
      }),
    ).resolves.toEqual(
      expect.objectContaining({enabled: false, claimed: 0}),
    )
    expect(claimResultOutboxEvents).not.toHaveBeenCalled()
  })

  it('safely consumes old events without explicit creation intent', async () => {
    claimResultOutboxEvents.mockResolvedValue([baseEvent])
    const adapter = {maxDeliveryMs: 10_000, deliverResultRevision: jest.fn()}
    const now = new Date('2026-08-20T00:00:00.000Z')

    await expect(
      runPlaneDeliveryBatch({adapter, environment, limit: 1, clock: () => now}),
    ).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        claimed: 1,
        delivered: 1,
        skippedWithoutIntent: 1,
      }),
    )
    expect(adapter.deliverResultRevision).not.toHaveBeenCalled()
    expect(finalizeResultOutboxEvent).toHaveBeenCalledWith({
      resultOutboxId: 31,
      leaseToken: 'lease-one',
      outcome: 'delivered',
      now,
    })
  })

  it('delivers opted-in events and token-fences finalization', async () => {
    claimResultOutboxEvents.mockResolvedValue([withIntent])
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest.fn(async () => ({outcome: 'delivered' as const})),
    }

    await expect(
      runPlaneDeliveryBatch({adapter, environment, limit: 1}),
    ).resolves.toEqual(expect.objectContaining({delivered: 1, staleLeases: 0}))
    expect(adapter.deliverResultRevision).toHaveBeenCalledWith(withIntent)
    expect(finalizeResultOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resultOutboxId: 31,
        leaseToken: 'lease-one',
        outcome: 'delivered',
      }),
    )
  })

  it('leases each event immediately before its provider call', async () => {
    const secondEvent = {
      ...withIntent,
      resultOutboxId: 32,
      leaseToken: 'lease-two',
    }
    claimResultOutboxEvents
      .mockResolvedValueOnce([withIntent])
      .mockResolvedValueOnce([secondEvent])
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest.fn(async () => ({outcome: 'delivered' as const})),
    }

    await runPlaneDeliveryBatch({adapter, environment, limit: 2})

    expect(claimResultOutboxEvents).toHaveBeenCalledTimes(2)
    expect(claimResultOutboxEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({limit: 1}),
    )
    expect(claimResultOutboxEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({limit: 1}),
    )
    expect(adapter.deliverResultRevision.mock.invocationCallOrder[0]).toBeLessThan(
      (claimResultOutboxEvents as jest.Mock).mock.invocationCallOrder[1],
    )
  })

  it('rejects leases that cannot cover the provider timeout', async () => {
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest.fn(),
    }

    await expect(
      runPlaneDeliveryBatch({
        adapter,
        environment,
        limit: 1,
        leaseMs: 14_999,
      }),
    ).rejects.toThrow('lease must exceed')
    expect(claimResultOutboxEvents).not.toHaveBeenCalled()
  })

  it('schedules controlled retryable failures with a bounded delay', async () => {
    claimResultOutboxEvents.mockResolvedValue([withIntent])
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest.fn(async () => {
        throw new PlaneAdapterError('rate limited', 'retryable', 2500)
      }),
    }
    const now = new Date('2026-08-20T00:00:00.000Z')
    const completedOn = new Date('2026-08-20T00:00:45.000Z')
    const clock = jest
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(completedOn)
      .mockReturnValue(completedOn)

    await expect(
      runPlaneDeliveryBatch({adapter, environment, limit: 1, clock}),
    ).resolves.toEqual(expect.objectContaining({retryDue: 1}))
    expect(finalizeResultOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'retry_due',
        error: 'rate limited',
        availableOn: new Date('2026-08-20T00:00:47.500Z'),
      }),
    )
  })

  it('never blindly retries ambiguous create or unexpected failures', async () => {
    claimResultOutboxEvents.mockResolvedValue([withIntent, withIntent])
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest
        .fn()
        .mockRejectedValueOnce(
          new PlaneAdapterError('unknown create outcome', 'ambiguous_create'),
        )
        .mockRejectedValueOnce(
          new Error(`unexpected ${'s'.repeat(48)} failure`),
        ),
    }

    await expect(
      runPlaneDeliveryBatch({adapter, environment, limit: 2}),
    ).resolves.toEqual(expect.objectContaining({manualAttention: 2}))
    expect(finalizeResultOutboxEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: 'manual_attention',
        error: 'unknown create outcome',
      }),
    )
    expect(finalizeResultOutboxEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outcome: 'manual_attention',
        error: 'unexpected [redacted] failure',
      }),
    )
  })

  it('reports a stale lease without claiming another worker result', async () => {
    claimResultOutboxEvents.mockResolvedValue([withIntent])
    finalizeResultOutboxEvent.mockResolvedValue(false)
    const adapter = {
      maxDeliveryMs: 10_000,
      deliverResultRevision: jest.fn(async () => ({outcome: 'delivered' as const})),
    }

    await expect(
      runPlaneDeliveryBatch({adapter, environment, limit: 1}),
    ).resolves.toEqual(
      expect.objectContaining({delivered: 0, staleLeases: 1}),
    )
  })
})
