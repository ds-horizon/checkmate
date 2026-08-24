import type {
  PlaneAdapterConfig,
  PlaneCommentDeliveryResponse,
  PlaneIntakeCreateResponse,
  PlaneWorkItem,
} from '../planeAdapter'
import {
  PlaneAdapterError,
  sanitizePlaneError,
} from '../planeAdapter'
import {
  canonicalJson,
  buildTvp599RecoveryOperatorEnvironment,
  createDfrRecoveryDatabase,
  parseDfrRecoveryManifest,
  recoveryManifestDigest,
  rewriteDfrProviderRoute,
  runPlaneTvp599DfrRecovery,
  sha256,
  TVP599_BIZ41_PAYLOAD_DIGEST,
  TVP599_BIZ_ROUTE,
  TVP599_DFR_RECOVERY_ID,
  TVP599_DFR_ROUTE,
  validateDfrRecoveryEnvironment,
  type DfrRecoveryDatabase,
  type DfrRecoveryEvidenceManifest,
  type DfrRecoveryManifest,
  type DfrRecoveryProvider,
  type DfrRecoveryReplacement,
  type DfrRecoverySource,
} from '../planeDfrRecovery'

const dfrConfig: PlaneAdapterConfig = {
  destinationKey: 'dfr-development',
  apiBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'secret-api-key',
  workspaceId: TVP599_DFR_ROUTE.workspaceId,
  workspaceSlug: 'infinimind',
  projectId: TVP599_DFR_ROUTE.projectId,
  projectIdentifier: TVP599_DFR_ROUTE.projectIdentifier,
  timeoutMs: 10_000,
  maxRequestsPerMinute: 6,
  maxRequestWaitMs: 60_000,
}

const enabledEnvironment = {
  PLANE_TVP599_DFR_RECOVERY_ENABLED: 'true',
  PLANE_TVP599_DFR_RECOVERY_WRITE_GATE: 'true',
  PLANE_DESTINATION: 'dfr-development',
  PLANE_CHECKMATE_BOT_ACTOR_ID: 'bot-dfr',
  PLANE_CHECKMATE_BOT_ACTOR_IDENTITY: 'checkmate-dfr-bot',
  PLANE_DELIVERY_WORKER_ENABLED: 'false',
  PLANE_RETEST_READINESS_ENABLED: 'false',
  PLANE_RETEST_READINESS_WORKER_ENABLED: 'false',
} as const

const identity = {
  386: {
    projectId: 4,
    runId: 17,
    testId: 394,
    testRunMapId: 386,
    defectCycleId: 1,
    resultRevisionId: 1,
    revisionNumber: 1,
    isIncluded: true as const,
    currentResultRevisionId: 1,
    resultOutboxId: 1,
    sourceState: 'manual_attention' as const,
    bizWorkItemId: '48eef479-5be4-4356-a77d-a0c881e5cff7',
    bizIntakeId: 'fe8b9bb8-bcbe-4ff9-a09c-ec9f9a402aae',
    correlationKey: 'checkmate:6fff5133-a23f-47d1-ad0d-b47fce28f441',
    title: 'Failed: LS-API-004: Visual Search',
    bizSequence: 41,
    activeMarker: 1 as const,
    openingRevisionId: 1,
    currentEvidenceRevisionId: 1,
    outboxEventType: 'plane_defect_create_requested' as const,
    outboxEventKey: 'defect-cycle:1:plane-create',
  },
  336: {
    projectId: 5,
    runId: 14,
    testId: 423,
    testRunMapId: 336,
    defectCycleId: 2,
    resultRevisionId: 2,
    revisionNumber: 1,
    isIncluded: true as const,
    currentResultRevisionId: 2,
    resultOutboxId: 2,
    sourceState: 'intake_open' as const,
    bizWorkItemId: '56e3d756-b6b8-44dd-97a0-d21e5cb42c44',
    bizIntakeId: '1acae908-d0ca-431f-8eb2-0d1ba812a8df',
    correlationKey: 'checkmate:03ee8845-e605-4a1d-acbd-c02a35300c1c',
    title: 'Failed: CHAT-04: Caption scene query for 90–120 seconds',
    bizSequence: 42,
    activeMarker: 1 as const,
    openingRevisionId: 2,
    currentEvidenceRevisionId: 2,
    outboxEventType: 'plane_defect_create_requested' as const,
    outboxEventKey: 'defect-cycle:2:plane-create',
  },
} as const

type MapId = keyof typeof identity

const payloadFor = (mapId: MapId) => {
  const record = identity[mapId]
  return {
    resultRevisionId: record.resultRevisionId,
    revisionNumber: record.revisionNumber,
    testRunMapId: record.testRunMapId,
    projectId: record.projectId,
    runId: record.runId,
    testId: record.testId,
    defectCycleId: record.defectCycleId,
    preservedField: `immutable-${mapId}`,
    planeDefectIntent: {
      create: true,
      defectCycleId: record.defectCycleId,
      correlationKey: record.correlationKey,
      title: record.title,
      description: `Correlation: ${record.correlationKey}`,
      priority: 'none' as const,
      attachmentKeys: [],
      providerWorkspaceId: TVP599_BIZ_ROUTE.workspaceId,
      providerProjectId: TVP599_BIZ_ROUTE.projectId,
      providerProjectIdentifier: TVP599_BIZ_ROUTE.projectIdentifier,
    },
  }
}

const recordFor = (mapId: MapId) => ({
  ...identity[mapId],
  evidence: [],
  sourcePayloadDigest: sha256(canonicalJson(payloadFor(mapId))),
})

const manifestForRun = (): DfrRecoveryManifest => ({
  recoveryId: TVP599_DFR_RECOVERY_ID,
  route: TVP599_DFR_ROUTE,
  expectedActorId: 'bot-dfr',
  expectedActorIdentity: 'checkmate-dfr-bot',
  records: [recordFor(386), recordFor(336)],
  // The runner receives this object only after an operator has parsed and
  // verified the immutable manifest. The test exercises the runner with the
  // synthetic, locally hashed payloads above.
  sha256: 'synthetic-test-manifest',
})

const workItem = (
  mapId: MapId,
  route: typeof TVP599_BIZ_ROUTE | typeof TVP599_DFR_ROUTE,
  overrides: Partial<PlaneWorkItem> = {},
): PlaneWorkItem => {
  const record = identity[mapId]
  const workItemId =
    route === TVP599_BIZ_ROUTE ? record.bizWorkItemId : `dfr-${mapId}`
  const intakeId =
    route === TVP599_BIZ_ROUTE ? record.bizIntakeId : `dfr-intake-${mapId}`
  return {
    workItemId,
    stateId: 'state-open',
    versionMarker: 'version-1',
    raw: {
      id: workItemId,
      workspace_id: route.workspaceId,
      project_id: route.projectId,
      project_identifier: route.projectIdentifier,
      intake_id: intakeId,
      correlation_key: record.correlationKey,
      name: record.title,
      sequence_id: route === TVP599_BIZ_ROUTE ? record.bizSequence : mapId,
    },
    ...overrides,
  }
}

const sourceFor = (
  mapId: MapId,
  overrides: Partial<DfrRecoverySource> = {},
): DfrRecoverySource => {
  const record = recordFor(mapId)
  return {
    manifest: record,
    payload: payloadFor(mapId),
    immutableSourcePayload: payloadFor(mapId),
    map: {
      testRunMapId: record.testRunMapId,
      projectId: record.projectId,
      runId: record.runId,
      testId: record.testId,
      isIncluded: record.isIncluded,
      currentResultRevisionId: record.currentResultRevisionId,
    },
    revisionNumber: record.revisionNumber,
    cycle: {
      state: record.sourceState,
      activeMarker: record.activeMarker,
      openingRevisionId: record.openingRevisionId,
      currentEvidenceRevisionId: record.currentEvidenceRevisionId,
      provider: 'plane',
      providerWorkspaceId: TVP599_BIZ_ROUTE.workspaceId,
      providerProjectId: TVP599_BIZ_ROUTE.projectId,
      providerWorkItemId: record.bizWorkItemId,
      providerIntakeId: record.bizIntakeId,
      providerStateId: 'biz-state-open',
      providerSequenceId: record.bizSequence,
      providerUrl: `https://plane-dev.geep-fence.ts.net/infinimind/browse/BIZ-${record.bizSequence}/`,
      createCorrelationKey: record.correlationKey,
    },
    outbox: {
      eventType: record.outboxEventType,
      eventKey: record.outboxEventKey,
      deliveryState: 'delivered',
      leaseToken: null,
      leaseExpiresOn: null,
      deliveredOn: new Date('2026-08-24T00:00:00.000Z'),
      lastError: null,
    },
    evidence: [],
    terminal: false,
    ...overrides,
  }
}

const completedSourceFor = (
  mapId: MapId,
  overrides: Partial<DfrRecoverySource> = {},
): DfrRecoverySource => {
  const source = sourceFor(mapId)
  return {
    ...source,
    terminal: true,
    payload: rewriteDfrProviderRoute(payloadFor(mapId)),
    cycle: {
      ...source.cycle,
      state: 'work_item_open',
      provider: 'plane',
      providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
      providerProjectId: TVP599_DFR_ROUTE.projectId,
      providerWorkItemId: `dfr-${mapId}`,
      providerIntakeId: `dfr-intake-${mapId}`,
      providerStateId: 'dfr-state-open',
      providerSequenceId: mapId,
      providerUrl: `https://plane-dev.geep-fence.ts.net/infinimind/browse/DFR-${mapId}/`,
    },
    outbox: {
      ...source.outbox,
      deliveryState: 'delivered',
      deliveredOn: new Date('2026-08-24T00:00:00.000Z'),
    },
    ...overrides,
  }
}

const pendingTerminalSourceFor = (mapId: MapId): DfrRecoverySource => {
  const source = completedSourceFor(mapId)
  const manifestEvidence = evidenceManifestFor(mapId, mapId + 700, {
    provider: 'plane',
    providerWorkspaceId: TVP599_BIZ_ROUTE.workspaceId,
    providerProjectId: TVP599_BIZ_ROUTE.projectId,
    deliveryState: 'pending',
    action: 'relink',
  })
  return {
    ...source,
    manifest: {...source.manifest, evidence: [manifestEvidence]},
    outbox: {...source.outbox, deliveryState: 'delivered', deliveredOn: new Date('2026-08-24T00:00:00.000Z')},
    evidence: [{
      ...manifestEvidence,
      providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
      providerProjectId: TVP599_DFR_ROUTE.projectId,
      providerWorkItemId: source.cycle.providerWorkItemId,
      deliveryState: 'pending',
      leaseToken: null,
      leaseExpiresOn: null,
      deliveredOn: null,
    }],
  }
}

const evidenceManifestFor = (
  mapId: MapId,
  planeEvidenceDeliveryId: number,
  overrides: Partial<DfrRecoveryEvidenceManifest> = {},
): DfrRecoveryEvidenceManifest => ({
  planeEvidenceDeliveryId,
  resultRevisionId: identity[mapId].resultRevisionId,
  sourceIdentity: `comment:${planeEvidenceDeliveryId}`,
  provider: 'plane',
  providerWorkspaceId: TVP599_BIZ_ROUTE.workspaceId,
  providerProjectId: TVP599_BIZ_ROUTE.projectId,
  providerWorkItemId: null,
  providerCommentId: null,
  providerAssetId: null,
  providerAttachmentId: null,
  deliveryState: 'pending',
  leaseToken: null,
  leaseExpiresOn: null,
  lastError: null,
  deliveredOn: null,
  action: 'relink',
  ...overrides,
})

const createDatabase = (sources: DfrRecoverySource[]) => {
  const database: jest.Mocked<DfrRecoveryDatabase> = {
    inspectExactTargets: jest.fn<
      ReturnType<DfrRecoveryDatabase['inspectExactTargets']>,
      Parameters<DfrRecoveryDatabase['inspectExactTargets']>
    >(async () => sources),
    reserveTargets: jest.fn<
      ReturnType<DfrRecoveryDatabase['reserveTargets']>,
      Parameters<DfrRecoveryDatabase['reserveTargets']>
    >(async () => undefined),
    finalizeTargets: jest.fn<
      ReturnType<DfrRecoveryDatabase['finalizeTargets']>,
      Parameters<DfrRecoveryDatabase['finalizeTargets']>
    >(async () => undefined),
    markManualAttention: jest.fn<
      ReturnType<DfrRecoveryDatabase['markManualAttention']>,
      Parameters<DfrRecoveryDatabase['markManualAttention']>
    >(async () => undefined),
  }
  return database
}

const createProviders = ({
  duplicates = new Map<string, PlaneWorkItem[]>(),
  ambiguousMap,
  failureMap,
  commentFailureMap,
}: {
  duplicates?: Map<string, PlaneWorkItem[]>
  ambiguousMap?: MapId
  failureMap?: MapId
  commentFailureMap?: MapId
} = {}) => {
  let createCount = 0
  const created = new Map<string, PlaneWorkItem>()
  const dfrProvider: jest.Mocked<DfrRecoveryProvider> = {
    checkAccess: jest.fn(async () => ({
      actorId: 'bot-dfr',
      actorIdentity: 'checkmate-dfr-bot',
      workspaceId: TVP599_DFR_ROUTE.workspaceId,
      projectId: TVP599_DFR_ROUTE.projectId,
      projectIdentifier: TVP599_DFR_ROUTE.projectIdentifier,
    })),
    findByCorrelation: jest.fn(async (correlationKey) =>
      duplicates.get(correlationKey) ?? [],
    ),
    createIntake: jest.fn(
      async (request): Promise<PlaneIntakeCreateResponse> => {
        const mapId = request.title.includes('LS-API') ? 386 : 336
        createCount += 1
        if (mapId === ambiguousMap) {
          throw new PlaneAdapterError(
            'Plane intake create outcome is unknown: Bearer [redacted]',
            'ambiguous_create',
          )
        }
        if (mapId === failureMap) {
          throw new PlaneAdapterError('provider rejected create', 'manual_attention')
        }
        const item = workItem(mapId, TVP599_DFR_ROUTE)
        created.set(identity[mapId].correlationKey, item)
        return {
          intakeId: `dfr-intake-${mapId}`,
          workItemId: item.workItemId,
          sequenceId: mapId,
          projectIdentifier: 'DFR',
          raw: {id: `dfr-intake-${mapId}`},
        }
      },
    ),
    getWorkItem: jest.fn(async (workItemId) => {
      for (const item of [...created.values(), ...duplicates.values()].flat()) {
        if (item.workItemId === workItemId) return item
      }
      const mapId = workItemId.endsWith('386') ? 386 : 336
      return workItem(mapId, TVP599_DFR_ROUTE)
    }),
    getIntakeWorkItem: jest.fn(async ({workItemId}) => {
      const mapId = workItemId.endsWith('386') ? 386 : 336
      const item = created.get(identity[mapId].correlationKey)
      return item ?? workItem(mapId, TVP599_DFR_ROUTE)
    }),
  }
  const bizProvider = {
    checkAccess: jest.fn(async () => ({
      actorId: 'bot-dfr',
      actorIdentity: 'checkmate-dfr-bot',
      workspaceId: TVP599_BIZ_ROUTE.workspaceId,
      projectId: TVP599_BIZ_ROUTE.projectId,
      projectIdentifier: TVP599_BIZ_ROUTE.projectIdentifier,
    })),
    getWorkItem: jest.fn(async (workItemId: string) => {
      const mapId = workItemId === identity[386].bizWorkItemId ? 386 : 336
      return workItem(mapId, TVP599_BIZ_ROUTE)
    }),
    getIntakeWorkItem: jest.fn(async ({workItemId}: {workItemId: string}) => {
      const mapId = workItemId === identity[386].bizWorkItemId ? 386 : 336
      return workItem(mapId, TVP599_BIZ_ROUTE)
    }),
    ensureComment: jest.fn(
      async ({workItemId}: {workItemId: string; marker: string; commentHtml: string}): Promise<PlaneCommentDeliveryResponse> => {
        const mapId = workItemId === identity[386].bizWorkItemId ? 386 : 336
        if (mapId === commentFailureMap) throw new Error('comment unavailable')
        return {commentId: `comment-${mapId}`}
      },
    ),
  }
  return {dfrProvider, bizProvider, createCount: () => createCount, created}
}

const run = async (options: {
  database?: jest.Mocked<DfrRecoveryDatabase>
  providers?: ReturnType<typeof createProviders>
  sources?: DfrRecoverySource[]
  environment?: Readonly<Record<string, string | undefined>>
}) => {
  const sources = options.sources ?? [sourceFor(386), sourceFor(336)]
  const database = options.database ?? createDatabase(sources)
  const providers = options.providers ?? createProviders()
  const result = await runPlaneTvp599DfrRecovery({
    manifest: manifestForRun(),
    database,
    dfrProvider: providers.dfrProvider,
    bizProvider: providers.bizProvider,
    dfrConfig,
    environment: options.environment ?? enabledEnvironment,
    now: new Date('2026-08-24T00:00:00.000Z'),
  })
  return {result, database, providers}
}

describe('TVP-599 DFR recovery manifest', () => {
  it('locks the exact recovery ID, DFR route, and two source tuples', () => {
    expect(TVP599_DFR_RECOVERY_ID).toBe('tvp599-dfr-recovery-20260824')
    expect(TVP599_DFR_ROUTE).toEqual({
      destinationKey: 'dfr-development',
      workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
      projectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
      projectIdentifier: 'DFR',
    })
    expect(recordFor(386)).toEqual(
      expect.objectContaining({projectId: 4, runId: 17, testId: 394, testRunMapId: 386, defectCycleId: 1, resultRevisionId: 1, resultOutboxId: 1}),
    )
    expect(recordFor(336)).toEqual(
      expect.objectContaining({projectId: 5, runId: 14, testId: 423, testRunMapId: 336, defectCycleId: 2, resultRevisionId: 2, resultOutboxId: 2}),
    )
  })

  it('requires a runtime BIZ-42 digest and verifies canonical manifest SHA', () => {
    const runtimeBiz42Digest = 'a'.repeat(64)
    const withoutDigest: Omit<DfrRecoveryManifest, 'sha256'> = {
      recoveryId: TVP599_DFR_RECOVERY_ID,
      route: TVP599_DFR_ROUTE,
      expectedActorId: 'bot-dfr',
      expectedActorIdentity: 'checkmate-dfr-bot',
      records: [
        {...identity[386], evidence: [], sourcePayloadDigest: TVP599_BIZ41_PAYLOAD_DIGEST},
        {...identity[336], evidence: [], sourcePayloadDigest: runtimeBiz42Digest},
      ],
    }
    const parsed = parseDfrRecoveryManifest({
      ...withoutDigest,
      sha256: recoveryManifestDigest(withoutDigest),
    })
    expect(parsed.records[1].sourcePayloadDigest).toBe(runtimeBiz42Digest)
    expect(parsed.records[0].sourcePayloadDigest).toBe(TVP599_BIZ41_PAYLOAD_DIGEST)
    expect(() =>
      parseDfrRecoveryManifest({
        ...withoutDigest,
        records: withoutDigest.records.map((record) => ({...record})).slice(0, 1),
        sha256: 'b'.repeat(64),
      }),
    ).toThrow('exactly two records')
    expect(() =>
      parseDfrRecoveryManifest({
        ...withoutDigest,
        records: [withoutDigest.records[1], withoutDigest.records[0]],
        sha256: 'c'.repeat(64),
      }),
    ).toThrow('mixed, reordered')
    expect(() =>
      parseDfrRecoveryManifest({
        ...withoutDigest,
        records: withoutDigest.records.map((record, index) =>
          index === 1 ? {...record, sourcePayloadDigest: ''} : record,
        ),
        sha256: 'd'.repeat(64),
      }),
    ).toThrow('sourcePayloadDigest')
  })
})

describe('TVP-599 DFR recovery orchestration', () => {
  it('returns exact-terminal no-op before any provider call', async () => {
    const sources = [
      sourceFor(386, {
        terminal: true,
        payload: rewriteDfrProviderRoute(payloadFor(386)),
        immutableSourcePayload: payloadFor(386),
        cycle: {
          ...sourceFor(386).cycle,
          state: 'work_item_open',
          activeMarker: 1,
          openingRevisionId: 1,
          currentEvidenceRevisionId: 1,
          provider: 'plane',
          providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
          providerProjectId: TVP599_DFR_ROUTE.projectId,
          providerWorkItemId: 'dfr-386',
          providerIntakeId: 'dfr-intake-386',
          providerStateId: 'dfr-state-open',
          providerSequenceId: 386,
          providerUrl: 'https://plane-dev.geep-fence.ts.net/infinimind/browse/DFR-386/',
        },
        outbox: {...sourceFor(386).outbox, deliveryState: 'delivered', deliveredOn: new Date('2026-08-24T00:00:00.000Z')},
      }),
      sourceFor(336, {
        terminal: true,
        payload: rewriteDfrProviderRoute(payloadFor(336)),
        immutableSourcePayload: payloadFor(336),
        cycle: {
          ...sourceFor(336).cycle,
          state: 'work_item_open',
          activeMarker: 1,
          openingRevisionId: 2,
          currentEvidenceRevisionId: 2,
          provider: 'plane',
          providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
          providerProjectId: TVP599_DFR_ROUTE.projectId,
          providerWorkItemId: 'dfr-336',
          providerIntakeId: 'dfr-intake-336',
          providerStateId: 'dfr-state-open',
          providerSequenceId: 336,
          providerUrl: 'https://plane-dev.geep-fence.ts.net/infinimind/browse/DFR-336/',
        },
        outbox: {...sourceFor(336).outbox, deliveryState: 'delivered', deliveredOn: new Date('2026-08-24T00:00:00.000Z')},
      }),
    ]
    const {result, database, providers} = await run({sources})
    expect(result.outcome).toBe('no_op')
    expect(database.reserveTargets).not.toHaveBeenCalled()
    expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
    expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
  })

  it('treats a fully consistent DFR-linked pending evidence state as an idempotent terminal no-op', async () => {
    const sources = [pendingTerminalSourceFor(386), pendingTerminalSourceFor(336)]
    const providers = createProviders()
    const database = createDatabase(sources)
    const first = await run({sources, providers, database})
    const second = await run({sources, providers, database})
    expect(first.result.outcome).toBe('no_op')
    expect(second.result.outcome).toBe('no_op')
    expect(providers.dfrProvider.createIntake).not.toHaveBeenCalled()
    expect(providers.bizProvider.ensureComment).not.toHaveBeenCalled()
    expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
  })

  it.each(['pending', 'retry_due', 'failed', 'manual_attention', 'leased', 'unexpected'] as const)(
    'rejects a source outbox in forbidden %s state before provider writes',
    async (deliveryState) => {
      const source = sourceFor(386, {
        outbox: {
          ...sourceFor(386).outbox,
          deliveryState,
          leaseToken: deliveryState === 'leased' ? 'stale-lease' : null,
          deliveredOn: null,
        },
      })
      const providers = createProviders()
      await expect(run({sources: [source, sourceFor(336)], providers})).rejects.toThrow(
        'ORM source outbox was not an exact delivered',
      )
      expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
      expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
      expect(providers.dfrProvider.createIntake).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['missing immutable snapshot', {immutableSourcePayload: null}],
    ['corrupt immutable snapshot', {immutableSourcePayload: {...payloadFor(336), preservedField: 'corrupt'}}],
    ['wrong BIZ-42 digest', {manifest: {...sourceFor(336).manifest, sourcePayloadDigest: '0'.repeat(64)}}],
  ])('does not no-op when the immutable source digest is unavailable: %s', async (_label, override) => {
    const source = completedSourceFor(336, override)
    const providers = createProviders()
    const database = createDatabase([completedSourceFor(386), source])
    const {result} = await run({database, providers})
    expect(result.outcome).toBe('manual_attention')
    expect(database.markManualAttention).toHaveBeenCalled()
    expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
    expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
    expect(providers.dfrProvider.createIntake).not.toHaveBeenCalled()
  })

  it.each([
    ['result revision', 'resultRevisionId', 999],
    ['revision number', 'revisionNumber', 999],
    ['map id', 'testRunMapId', 999],
    ['project id', 'projectId', 999],
    ['run id', 'runId', 999],
    ['test id', 'testId', 999],
    ['cycle id', 'defectCycleId', 999],
  ])('rejects a top-level outbox %s mismatch before reservation', async (_label, field, value) => {
    const source = sourceFor(386)
    const database = createDatabase([{...source, payload: {...source.payload, [field]: value}}, sourceFor(336)])
    await expect(run({database})).rejects.toThrow(`ORM outbox payload ${field}`)
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it.each([
    ['isIncluded', {...sourceFor(386).map, isIncluded: false}],
    ['current result revision', {...sourceFor(386).map, currentResultRevisionId: 999}],
    ['project', {...sourceFor(386).map, projectId: 999}],
    ['run', {...sourceFor(386).map, runId: 999}],
    ['test', {...sourceFor(386).map, testId: 999}],
  ])('rejects a stale map %s identity before provider writes', async (_label, map) => {
    const database = createDatabase([{...sourceFor(386), map}, sourceFor(336)])
    await expect(run({database})).rejects.toThrow('ORM active/revision/outbox identity mismatch')
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it('requires authoritative GET sequence and never falls back to POST sequence', async () => {
    const providers = createProviders()
    providers.dfrProvider.getIntakeWorkItem.mockImplementation(async ({workItemId}) => {
      const mapId = workItemId.endsWith('386') ? 386 : 336
      const item = workItem(mapId, TVP599_DFR_ROUTE)
      const {sequence_id: _sequenceId, ...raw} = item.raw
      return {...item, raw}
    })
    const {result} = await run({providers})
    expect(result.outcome).toBe('manual_attention')
    expect(result).toEqual(expect.objectContaining({reason: expect.stringContaining('create/readback omitted sequence')}))
    expect(providers.dfrProvider.createIntake).toHaveBeenCalledTimes(1)
    expect(providers.dfrProvider.getIntakeWorkItem).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an uncleared outbox lease', (source: DfrRecoverySource) => ({
      ...source,
      outbox: {...source.outbox, leaseToken: 'stale-lease'},
    })],
    ['a non-canonical durable payload', (source: DfrRecoverySource) => ({
      ...source,
      payload: {...source.payload, preservedField: 'changed-after-delivery'},
    })],
    ['an undeclared evidence row', (source: DfrRecoverySource) => ({
      ...source,
      evidence: [{
        planeEvidenceDeliveryId: 901,
        resultRevisionId: source.manifest.resultRevisionId,
        sourceIdentity: 'comment:901',
        provider: 'plane',
        providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
        providerProjectId: TVP599_DFR_ROUTE.projectId,
        providerWorkItemId: source.cycle.providerWorkItemId,
        providerCommentId: null,
        providerAssetId: null,
        providerAttachmentId: null,
        deliveryState: 'delivered',
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: null,
        deliveredOn: new Date('2026-08-24T00:00:00.000Z'),
      }],
    })],
  ])('does not no-op when terminal consistency is incomplete: %s', async (_label, mutate) => {
    const incomplete = mutate(completedSourceFor(386))
    const providers = createProviders()
    const database = createDatabase([incomplete, completedSourceFor(336)])
    if (_label === 'an uncleared outbox lease') {
      await expect(run({database, providers})).rejects.toThrow('ORM source outbox was not an exact delivered')
      expect(database.markManualAttention).not.toHaveBeenCalled()
    } else {
      const {result} = await run({database, providers})
      expect(result.outcome).toBe('manual_attention')
      expect(database.markManualAttention).toHaveBeenCalled()
    }
    expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
    expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
  })

  it.each([
    ['zero', new Map<string, PlaneWorkItem[]>()],
    ['one', new Map([[identity[386].correlationKey, [workItem(386, TVP599_DFR_ROUTE)]]])],
  ])('handles %s exact DFR duplicate cardinality', async (_label, duplicates) => {
    const providers = createProviders({duplicates})
    const {result} = await run({providers})
    expect(result.outcome).toBe('reconciled')
    expect(providers.dfrProvider.createIntake).toHaveBeenCalledTimes(
      duplicates.size === 0 ? 2 : 1,
    )
  })

  it('stops on multiple exact DFR duplicates before reservation', async () => {
    const providers = createProviders({
      duplicates: new Map([
        [
          identity[386].correlationKey,
          [workItem(386, TVP599_DFR_ROUTE), workItem(386, TVP599_DFR_ROUTE, {workItemId: 'dfr-386-duplicate'})],
        ],
      ]),
    })
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    await expect(run({database, providers})).rejects.toThrow('cardinality was 2')
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it('stops on a one-match DFR identity mismatch before reservation', async () => {
    const mismatched = workItem(386, TVP599_DFR_ROUTE, {
      raw: {
        ...workItem(386, TVP599_DFR_ROUTE).raw,
        project_id: TVP599_BIZ_ROUTE.projectId,
      },
    })
    const providers = createProviders({
      duplicates: new Map([[identity[386].correlationKey, [mismatched]]]),
    })
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    await expect(run({database, providers})).rejects.toThrow('did not match the exact record 386')
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it('rejects authenticated actor or route mismatch before writes', async () => {
    const providers = createProviders()
    providers.bizProvider.checkAccess.mockResolvedValueOnce({
      actorId: 'bot-dfr',
      actorIdentity: 'checkmate-dfr-bot',
      workspaceId: TVP599_BIZ_ROUTE.workspaceId,
      projectId: TVP599_DFR_ROUTE.projectId,
      projectIdentifier: 'DFR',
    })
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    await expect(run({database, providers})).rejects.toThrow('did not match biz-development')
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it('enforces exact environment and manifest actor gates before provider access', async () => {
    expect(() => validateDfrRecoveryEnvironment({
      ...enabledEnvironment,
      PLANE_DELIVERY_WORKER_ENABLED: 'true',
    })).toThrow('exactly false')
    expect(() => validateDfrRecoveryEnvironment({
      ...enabledEnvironment,
      PLANE_DESTINATION: 'biz-development',
    })).toThrow('PLANE_DESTINATION=dfr-development')
    const providers = createProviders()
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    await expect(run({
      database,
      providers,
      environment: {...enabledEnvironment, PLANE_CHECKMATE_BOT_ACTOR_ID: 'wrong-actor'},
    })).rejects.toThrow('manifest actor fence')
    expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
    expect(providers.dfrProvider.checkAccess).not.toHaveBeenCalled()
  })

  it('rejects dotenv-only recovery and write-gate authorization', () => {
    const dotenvOnly = buildTvp599RecoveryOperatorEnvironment({
      processEnvironment: {
        ...enabledEnvironment,
        PLANE_TVP599_DFR_RECOVERY_ENABLED: undefined,
        PLANE_TVP599_DFR_RECOVERY_WRITE_GATE: undefined,
      },
      effectiveEnvironment: enabledEnvironment,
      dotenvEnvironment: {
        PLANE_TVP599_DFR_RECOVERY_ENABLED: 'true',
        PLANE_TVP599_DFR_RECOVERY_WRITE_GATE: 'true',
      },
    })
    expect(dotenvOnly.PLANE_TVP599_DFR_RECOVERY_ENABLED).toBeUndefined()
    expect(dotenvOnly.PLANE_TVP599_DFR_RECOVERY_WRITE_GATE).toBeUndefined()
    expect(() => validateDfrRecoveryEnvironment(dotenvOnly)).toThrow(
      'PLANE_TVP599_DFR_RECOVERY_ENABLED',
    )

    const writeGateFromDotenv = buildTvp599RecoveryOperatorEnvironment({
      processEnvironment: {
        ...enabledEnvironment,
        PLANE_TVP599_DFR_RECOVERY_WRITE_GATE: undefined,
      },
      effectiveEnvironment: enabledEnvironment,
      dotenvEnvironment: {PLANE_TVP599_DFR_RECOVERY_WRITE_GATE: 'true'},
    })
    expect(writeGateFromDotenv.PLANE_TVP599_DFR_RECOVERY_ENABLED).toBe('true')
    expect(writeGateFromDotenv.PLANE_TVP599_DFR_RECOVERY_WRITE_GATE).toBeUndefined()
    expect(() => validateDfrRecoveryEnvironment(writeGateFromDotenv)).toThrow(
      'PLANE_TVP599_DFR_RECOVERY_WRITE_GATE',
    )
  })

  it('fails closed on active, revision, or outbox event identity drift', async () => {
    for (const mutate of [
      (source: DfrRecoverySource) => ({...source, cycle: {...source.cycle, activeMarker: 0}}),
      (source: DfrRecoverySource) => ({...source, cycle: {...source.cycle, currentEvidenceRevisionId: 999}}),
      (source: DfrRecoverySource) => ({...source, outbox: {...source.outbox, eventKey: 'wrong-event'}}),
    ]) {
      const database = createDatabase([mutate(sourceFor(386)), sourceFor(336)])
      await expect(run({database})).rejects.toThrow('active/revision/outbox identity mismatch')
      expect(database.reserveTargets).not.toHaveBeenCalled()
    }
  })

  it('requires BIZ source readback to match the ORM snapshot and exact identifier', async () => {
    const providers = createProviders()
    providers.bizProvider.getIntakeWorkItem.mockImplementation(async ({workItemId}) => {
      const mapId = workItemId === identity[386].bizWorkItemId ? 386 : 336
      const item = workItem(mapId, TVP599_BIZ_ROUTE)
      return mapId === 386 ? {...item, raw: {...item.raw, project_identifier: 'WRONG'}} : item
    })
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    await expect(run({database, providers})).rejects.toThrow('BIZ source readback did not match the exact record 386')
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it('reconciles an ambiguous create by exact lookup without retrying POST', async () => {
    const providers = createProviders({
      ambiguousMap: 386,
    })
    let lookupCount = 0
    providers.dfrProvider.findByCorrelation.mockImplementation(async (correlationKey) => {
      lookupCount += 1
      return lookupCount >= 3 && correlationKey === identity[386].correlationKey
        ? [workItem(386, TVP599_DFR_ROUTE)]
        : []
    })
    const {result} = await run({providers})
    expect(result.outcome).toBe('reconciled')
    expect(providers.dfrProvider.createIntake).toHaveBeenCalledTimes(2)
    expect(providers.dfrProvider.findByCorrelation).toHaveBeenCalledWith(identity[386].correlationKey)
  })

  it('records a partial provider outcome and fences manual attention', async () => {
    const providers = createProviders({failureMap: 386})
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    const {result} = await run({database, providers})
    expect(result.outcome).toBe('partial')
    expect(result).toEqual(expect.objectContaining({replacements: expect.any(Array)}))
    expect(database.markManualAttention).toHaveBeenCalledTimes(1)
    expect(database.finalizeTargets).not.toHaveBeenCalled()
  })

  it('fails closed when the reservation fence loses a concurrent update', async () => {
    const providers = createProviders()
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    database.reserveTargets.mockRejectedValueOnce(new Error('reservation affected-row fence failed'))
    await expect(run({database, providers})).rejects.toThrow('reservation affected-row fence failed')
    expect(providers.dfrProvider.createIntake).not.toHaveBeenCalled()
    expect(database.finalizeTargets).not.toHaveBeenCalled()
  })

  it('keeps provider replacements when affected-row finalization fails', async () => {
    const providers = createProviders()
    const database = createDatabase([sourceFor(386), sourceFor(336)])
    database.finalizeTargets.mockRejectedValueOnce(new Error('affected-row fence failed'))
    const {result} = await run({database, providers})
    expect(result.outcome).toBe('partial')
    expect(database.markManualAttention).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'affected-row fence failed'}),
    )
  })

  it('rewrites only DFR route fields and preserves immutable payload fields', () => {
    const payload = payloadFor(386)
    const rewritten = rewriteDfrProviderRoute(payload) as Record<string, unknown>
    expect(rewritten).toEqual({
      ...payload,
      planeDefectIntent: {
        ...payload.planeDefectIntent,
        providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
        providerProjectId: TVP599_DFR_ROUTE.projectId,
        providerProjectIdentifier: TVP599_DFR_ROUTE.projectIdentifier,
      },
    })
    expect(rewritten.preservedField).toBe(payload.preservedField)
    expect(rewritten.resultRevisionId).toBe(payload.resultRevisionId)
  })

  it('preserves completed BIZ evidence and only declares artifact-free rows for relink', async () => {
    const preserved = evidenceManifestFor(386, 701, {
      providerWorkItemId: identity[386].bizWorkItemId,
      deliveryState: 'delivered',
      deliveredOn: '2026-08-24T00:00:00.000Z',
      action: 'preserve',
    })
    const relinked = evidenceManifestFor(386, 702)
    const source = sourceFor(386, {
      manifest: {...sourceFor(386).manifest, evidence: [preserved, relinked]},
      evidence: [
        {
          ...preserved,
          leaseToken: null,
          leaseExpiresOn: null,
          lastError: null,
          deliveredOn: new Date('2026-08-24T00:00:00.000Z'),
        },
        {
          ...relinked,
          leaseToken: null,
          leaseExpiresOn: null,
          lastError: null,
          deliveredOn: null,
        },
      ],
    })
    const database = createDatabase([source, sourceFor(336)])
    const {result} = await run({database})
    expect(result.outcome).toBe('reconciled')
    expect(database.finalizeTargets).toHaveBeenCalledWith(expect.objectContaining({
      records: expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({testRunMapId: 386, evidence: [preserved, relinked]}),
        }),
      ]),
    }))
  })

  it('rejects evidence rows that carry provider artifacts outside the preserved set', async () => {
    const relinked = evidenceManifestFor(386, 703)
    const source = sourceFor(386, {
      manifest: {...sourceFor(386).manifest, evidence: [relinked]},
      evidence: [{
        ...relinked,
        providerCommentId: 'already-delivered-comment',
        leaseToken: null,
        leaseExpiresOn: null,
        deliveredOn: null,
      }],
    })
    const providers = createProviders()
    const database = createDatabase([source, sourceFor(336)])
    await expect(run({database, providers})).rejects.toThrow('ORM evidence provider artifact snapshot mismatch')
    expect(providers.bizProvider.checkAccess).not.toHaveBeenCalled()
    expect(database.reserveTargets).not.toHaveBeenCalled()
  })

  it.each(['reserved', 'retry_due', 'manual_attention'] as const)(
    'rejects forbidden %s relink evidence states',
    async (deliveryState) => {
      const relinked = evidenceManifestFor(386, 704, {deliveryState})
      const source = sourceFor(386, {
        manifest: {...sourceFor(386).manifest, evidence: [relinked]},
        evidence: [{...relinked, leaseToken: null, leaseExpiresOn: null, deliveredOn: null}],
      })
      await expect(run({sources: [source, sourceFor(336)]})).rejects.toThrow(
        'relink evidence was not an artifact-free pending BIZ row',
      )
    },
  )

  it.each([
    ['comment id', {providerCommentId: 'expected-comment'}, {providerCommentId: 'different-comment'}],
    ['asset id', {providerAssetId: 'expected-asset'}, {providerAssetId: 'different-asset'}],
    ['attachment id', {providerAttachmentId: 'expected-attachment'}, {providerAttachmentId: 'different-attachment'}],
    ['delivered timestamp', {deliveredOn: '2026-08-24T00:00:00.000Z'}, {deliveredOn: '2026-08-24T00:01:00.000Z'}],
  ])('rejects preserved evidence %s drift', async (_label, expected, actual) => {
    const preserved = evidenceManifestFor(386, 705, {
      providerWorkItemId: identity[386].bizWorkItemId,
      providerCommentId: 'expected-comment',
      providerAssetId: 'expected-asset',
      providerAttachmentId: 'expected-attachment',
      deliveryState: 'delivered',
      deliveredOn: '2026-08-24T00:00:00.000Z',
      action: 'preserve',
      ...expected,
    })
    const source = sourceFor(386, {
      manifest: {...sourceFor(386).manifest, evidence: [preserved]},
      evidence: [{
        ...preserved,
        ...actual,
        leaseToken: null,
        leaseExpiresOn: null,
        deliveredOn: new Date(
          ('deliveredOn' in actual ? actual.deliveredOn : undefined) ??
            preserved.deliveredOn ??
            '2026-08-24T00:00:00.000Z',
        ),
      }],
    })
    await expect(run({sources: [source, sourceFor(336)]})).rejects.toThrow(
      'ORM evidence provider artifact snapshot mismatch',
    )
  })

  it('returns explicit comment failure after finalization and uses stable markers', async () => {
    const providers = createProviders({commentFailureMap: 336})
    const {result} = await run({providers})
    expect(result.outcome).toBe('partial')
    expect(result).toEqual(expect.objectContaining({commentFailures: [336]}))
    const markers = providers.bizProvider.ensureComment.mock.calls.map(
      ([request]) => request.marker,
    )
    expect(markers).toEqual([
      `<!-- ${TVP599_DFR_RECOVERY_ID}:336 -->`,
      `<!-- ${TVP599_DFR_RECOVERY_ID}:386 -->`,
    ])
  })

  it('passes records to the reservation seam in deterministic order', async () => {
    const sources = [sourceFor(336), sourceFor(386)]
    const {database, result} = await run({sources})
    expect(result.outcome).toBe('reconciled')
    expect(database.reserveTargets.mock.calls[0][0].records.map((source) => source.manifest.testRunMapId)).toEqual([336, 386])
  })
})

describe('TVP-599 recovery safety utilities', () => {
  it('sanitizes credentials and never exposes the API token', () => {
    const sanitized = sanitizePlaneError(
      new Error('Bearer super-secret-token token=also-secret X-API-Key: key-value Authorization: Bearer authorization-secret'),
    )
    expect(sanitized).not.toContain('super-secret-token')
    expect(sanitized).not.toContain('also-secret')
    expect(sanitized).not.toContain('key-value')
    expect(sanitized).not.toContain('authorization-secret')
    expect(sanitized).toContain('[redacted]')
    expect(sanitized.length).toBeLessThanOrEqual(2000)
  })
})

const queuedQuery = (rows: unknown[]) => {
  const query: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'for']) {
    query[method] = () => query
  }
  query.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return query
}

describe('TVP-599 recovery ORM seams', () => {
  it('uses the real Drizzle recovery store seam for exact source inspection', async () => {
    const sources = [sourceFor(386), sourceFor(336)]
    const queuedRows: unknown[] = []
    for (const source of sources) {
      queuedRows.push(
        [source.map],
        [source.cycle],
        [{
          resultRevisionId: source.manifest.resultRevisionId,
          revisionNumber: source.manifest.revisionNumber,
          defectCycleId: source.manifest.defectCycleId,
        }],
        [{
          eventType: source.outbox.eventType,
          eventKey: source.outbox.eventKey,
          payload: source.payload,
          deliveryState: source.outbox.deliveryState,
          leaseToken: source.outbox.leaseToken,
          leaseExpiresOn: source.outbox.leaseExpiresOn,
          deliveredOn: source.outbox.deliveredOn,
        }],
        [],
        [],
      )
    }
    const select = jest.fn(() => queuedQuery((queuedRows.shift() ?? []) as unknown[]))
    const drizzleDatabase = {
      select,
      transaction: jest.fn(),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    const inspected = await store.inspectExactTargets(manifestForRun())
    expect(inspected.map((source) => source.manifest.testRunMapId)).toEqual([386, 336])
    expect(select).toHaveBeenCalledTimes(12)
  })

  it('rechecks the inspected payload in the real finalization seam before any update', async () => {
    const source = sourceFor(386)
    const stalePayload = {...source.payload, preservedField: 'changed-concurrently'}
    const queuedRows: unknown[] = [
      [source.map],
      [source.cycle],
      [{
        resultRevisionId: source.manifest.resultRevisionId,
        revisionNumber: source.manifest.revisionNumber,
        defectCycleId: source.manifest.defectCycleId,
      }],
      [{
        eventType: source.outbox.eventType,
        eventKey: source.outbox.eventKey,
        payload: stalePayload,
        deliveryState: 'leased',
        leaseToken: 'lease-token',
        leaseExpiresOn: new Date('2026-08-24T00:10:00.000Z'),
      }],
      [],
    ]
    const select = jest.fn(() => queuedQuery((queuedRows.shift() ?? []) as unknown[]))
    const update = jest.fn()
    const trx = {
      select,
      update,
      insert: jest.fn(),
    }
    const drizzleDatabase = {
      select: jest.fn(),
      transaction: jest.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx)),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    const replacement: DfrRecoveryReplacement = {
      record: source.manifest,
      workItemId: 'dfr-386',
      intakeId: 'dfr-intake-386',
      sequenceId: 386,
      stateId: 'dfr-state-open',
      workItem: workItem(386, TVP599_DFR_ROUTE),
    }
    await expect(store.finalizeTargets({
      recoveryId: TVP599_DFR_RECOVERY_ID,
      records: [source],
      replacements: [replacement],
      leaseToken: 'lease-token',
      now: new Date('2026-08-24T00:00:00.000Z'),
    })).rejects.toThrow('finalization outbox identity fence')
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ['reservation', 'reservation map identity fence failed'],
    ['finalization', 'finalization map identity fence failed'],
  ])('locks and fences the map identity during %s', async (phase, expectedError) => {
    const source = sourceFor(386)
    const staleMap = {...source.map, currentResultRevisionId: 999}
    const select = jest.fn(() => queuedQuery([[staleMap]]))
    const update = jest.fn()
    const trx = {
      select,
      update,
      insert: jest.fn(),
    }
    const drizzleDatabase = {
      select: jest.fn(),
      transaction: jest.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx)),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    if (phase === 'reservation') {
      await expect(store.reserveTargets({
        recoveryId: TVP599_DFR_RECOVERY_ID,
        records: [source],
        leaseToken: 'lease-token',
        now: new Date('2026-08-24T00:00:00.000Z'),
        leaseExpiresOn: new Date('2026-08-24T00:10:00.000Z'),
      })).rejects.toThrow(expectedError)
    } else {
      const replacement: DfrRecoveryReplacement = {
        record: source.manifest,
        workItemId: 'dfr-386',
        intakeId: 'dfr-intake-386',
        sequenceId: 386,
        stateId: 'dfr-state-open',
        workItem: workItem(386, TVP599_DFR_ROUTE),
      }
      await expect(store.finalizeTargets({
        recoveryId: TVP599_DFR_RECOVERY_ID,
        records: [source],
        replacements: [replacement],
        leaseToken: 'lease-token',
        now: new Date('2026-08-24T00:00:00.000Z'),
      })).rejects.toThrow(expectedError)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('does not overwrite a concurrently changed outbox during manual attention', async () => {
    const source = sourceFor(386)
    const update = jest.fn(() => ({
      set: jest.fn(() => ({where: jest.fn(async () => [{affectedRows: 0}])})),
    }))
    const insert = jest.fn()
    const trx = {
      select: jest.fn(),
      update,
      insert,
    }
    const drizzleDatabase = {
      select: jest.fn(),
      transaction: jest.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx)),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    await expect(store.markManualAttention({
      recoveryId: TVP599_DFR_RECOVERY_ID,
      records: [source],
      reason: 'Authorization: Bearer stale-secret token=also-secret',
    })).rejects.toThrow('manual attention affected-row fence')
    expect(update).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
  })

  it.each([
    ['lease expiry', {leaseExpiresOn: new Date('2026-08-24T00:11:00.000Z')}],
    ['reservation error marker', {lastError: `TVP599 DFR recovery reserved: concurrent-change`}],
  ])('rejects a concurrent %s change during reservation-owned manual attention', async (_label, changed) => {
    const expectedLeaseExpiresOn = new Date('2026-08-24T00:10:00.000Z')
    const source = sourceFor(386, {
      outbox: {
        ...sourceFor(386).outbox,
        deliveryState: 'delivered',
        leaseToken: null,
        leaseExpiresOn: null,
        lastError: null,
      },
    })
    const update = jest.fn(() => ({
      set: jest.fn(() => ({where: jest.fn(async () => [{affectedRows: 0}])})),
    }))
    const insert = jest.fn()
    const trx = {select: jest.fn(), update, insert}
    const drizzleDatabase = {
      select: jest.fn(),
      transaction: jest.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx)),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    const expectedLastError = `TVP599 DFR recovery reserved: ${TVP599_DFR_RECOVERY_ID}`
    const concurrentState = {
      leaseToken: 'lease-token',
      leaseExpiresOn: expectedLeaseExpiresOn,
      lastError: expectedLastError,
      ...changed,
    }
    if (_label === 'lease expiry') {
      expect(concurrentState.leaseExpiresOn).not.toEqual(expectedLeaseExpiresOn)
      expect(concurrentState.lastError).toBe(expectedLastError)
    } else {
      expect(concurrentState.leaseExpiresOn).toEqual(expectedLeaseExpiresOn)
      expect(concurrentState.lastError).not.toBe(expectedLastError)
    }
    await expect(store.markManualAttention({
      recoveryId: TVP599_DFR_RECOVERY_ID,
      records: [source],
      reason: 'Authorization: Bearer stale-secret token=also-secret',
      leaseToken: 'lease-token',
      leaseExpiresOn: expectedLeaseExpiresOn,
    })).rejects.toThrow('manual attention affected-row fence')
    expect(update).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
  })

  it('sanitizes provider credentials before manual-attention persistence', async () => {
    const source = sourceFor(386)
    const updateValues: unknown[] = []
    const reconciliationValues: unknown[] = []
    const update = jest.fn(() => ({
      set: jest.fn((values: unknown) => {
        updateValues.push(values)
        return {where: jest.fn(async () => [{affectedRows: 1}])}
      }),
    }))
    const insert = jest.fn(() => ({
      values: jest.fn((values: unknown) => {
        reconciliationValues.push(values)
        return {
          onDuplicateKeyUpdate: jest.fn(() => ({execute: jest.fn(async () => undefined)})),
        }
      }),
    }))
    const trx = {select: jest.fn(), update, insert}
    const drizzleDatabase = {
      select: jest.fn(),
      transaction: jest.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx)),
    } as unknown as Parameters<typeof createDfrRecoveryDatabase>[0]
    const store = createDfrRecoveryDatabase(drizzleDatabase)
    await store.markManualAttention({
      recoveryId: TVP599_DFR_RECOVERY_ID,
      records: [source],
      reason: 'Authorization: Bearer persistence-secret token=also-secret',
    })
    const serialized = JSON.stringify({updateValues, reconciliationValues})
    expect(serialized).not.toContain('persistence-secret')
    expect(serialized).not.toContain('also-secret')
    expect(serialized).toContain('[redacted]')
  })
})
