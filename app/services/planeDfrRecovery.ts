import {createHash, randomUUID} from 'node:crypto'
import {and, eq, isNull} from 'drizzle-orm'
import {
  defectCycles,
  integrationReconciliations,
  planeEvidenceDeliveries,
  resultOutbox,
  resultRevisions,
} from '@schema/resultRevisions'
import type {ResultRevisionCommittedPayload} from '@schema/resultRevisions'
import {testRunMap} from '@schema/runs'
import type {
  PlaneAdapterConfig,
  PlaneCommentDeliveryResponse,
  PlaneIntakeCreateRequest,
  PlaneIntakeCreateResponse,
  PlaneWorkItem,
} from './planeAdapter'
import {PlaneAdapterError, sanitizePlaneError} from './planeAdapter'
import {
  PLANE_DESTINATIONS,
  planeDestinationMatchesProviderIds,
} from './planeRouting'

/** Immutable operator identity for this one-off recovery. */
export const TVP599_DFR_RECOVERY_ID = 'tvp599-dfr-recovery-20260824'
export const TVP599_DFR_ROUTE = {
  destinationKey: 'dfr-development' as const,
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  projectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
  projectIdentifier: 'DFR',
}
export const TVP599_BIZ_ROUTE = {
  destinationKey: 'biz-development' as const,
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
}

export const TVP599_BIZ41_PAYLOAD_DIGEST =
  '2be2537060cd11f4127efe99f599fbb9d61beea96443af679114eff3c81bf61d'

export const TVP599_RECOVERY_WORKER_FLAGS = [
  'PLANE_DELIVERY_WORKER_ENABLED',
  'PLANE_RETEST_READINESS_ENABLED',
  'PLANE_RETEST_READINESS_WORKER_ENABLED',
] as const

export const TVP599_RECOVERY_WRITE_GATE =
  'PLANE_TVP599_DFR_RECOVERY_WRITE_GATE'

export type DfrRecoveryEvidenceManifest = {
  planeEvidenceDeliveryId: number
  resultRevisionId: number
  sourceIdentity: string
  provider: string
  providerWorkspaceId: string
  providerProjectId: string
  providerWorkItemId: string | null
  providerCommentId: string | null
  providerAssetId: string | null
  providerAttachmentId: string | null
  deliveryState: 'pending' | 'reserved' | 'retry_due' | 'delivered' | 'manual_attention'
  leaseToken: string | null
  leaseExpiresOn: string | null
  lastError: string | null
  deliveredOn: string | null
  action: 'preserve' | 'relink'
}

export type DfrRecoveryManifestRecord = {
  projectId: number
  runId: number
  testId: number
  testRunMapId: number
  defectCycleId: number
  resultRevisionId: number
  revisionNumber: number
  isIncluded: true
  currentResultRevisionId: number
  resultOutboxId: number
  sourceState: 'manual_attention' | 'intake_open'
  sourcePayloadDigest: string
  bizWorkItemId: string
  bizIntakeId: string
  correlationKey: string
  title: string
  bizSequence: number
  activeMarker: 1
  openingRevisionId: number
  currentEvidenceRevisionId: number
  outboxEventType: 'plane_defect_create_requested'
  outboxEventKey: string
  evidence: DfrRecoveryEvidenceManifest[]
}

export type DfrRecoveryManifest = {
  recoveryId: string
  route: typeof TVP599_DFR_ROUTE
  expectedActorId: string
  expectedActorIdentity: string
  records: [DfrRecoveryManifestRecord, DfrRecoveryManifestRecord]
  sha256: string
}

const RECORD_KEYS = [
  'projectId',
  'runId',
  'testId',
  'testRunMapId',
  'defectCycleId',
  'resultRevisionId',
  'revisionNumber',
  'isIncluded',
  'currentResultRevisionId',
  'resultOutboxId',
  'sourceState',
  'sourcePayloadDigest',
  'bizWorkItemId',
  'bizIntakeId',
  'correlationKey',
  'title',
  'bizSequence',
  'activeMarker',
  'openingRevisionId',
  'currentEvidenceRevisionId',
  'outboxEventType',
  'outboxEventKey',
  'evidence',
] as const

const MANIFEST_KEYS = [
  'recoveryId',
  'route',
  'expectedActorId',
  'expectedActorIdentity',
  'records',
  'sha256',
] as const
const ROUTE_KEYS = [
  'destinationKey',
  'workspaceId',
  'projectId',
  'projectIdentifier',
] as const

const BIZ41_RECORD: Omit<DfrRecoveryManifestRecord, 'sourcePayloadDigest'> & {
  sourcePayloadDigest: string
} = {
  projectId: 4,
  runId: 17,
  testId: 394,
  testRunMapId: 386,
  defectCycleId: 1,
  resultRevisionId: 1,
  revisionNumber: 1,
  isIncluded: true,
  currentResultRevisionId: 1,
  resultOutboxId: 1,
  sourceState: 'manual_attention',
  sourcePayloadDigest: TVP599_BIZ41_PAYLOAD_DIGEST,
  bizWorkItemId: '48eef479-5be4-4356-a77d-a0c881e5cff7',
  bizIntakeId: 'fe8b9bb8-bcbe-4ff9-a09c-ec9f9a402aae',
  correlationKey: 'checkmate:6fff5133-a23f-47d1-ad0d-b47fce28f441',
  title: 'Failed: LS-API-004: Visual Search',
  bizSequence: 41,
  activeMarker: 1 as const,
  openingRevisionId: 1,
  currentEvidenceRevisionId: 1,
  outboxEventType: 'plane_defect_create_requested',
  outboxEventKey: 'defect-cycle:1:plane-create',
  evidence: [] as DfrRecoveryEvidenceManifest[],
}

const BIZ42_RECORD_IDENTITY = {
  projectId: 5,
  runId: 14,
  testId: 423,
  testRunMapId: 336,
  defectCycleId: 2,
  resultRevisionId: 2,
  revisionNumber: 1,
  isIncluded: true,
  currentResultRevisionId: 2,
  resultOutboxId: 2,
  sourceState: 'intake_open' as const,
  bizWorkItemId: '56e3d756-b6b8-44dd-97a0-d21e5cb42c44',
  bizIntakeId: '1acae908-d0ca-431f-8eb2-0d1ba812a8df',
  correlationKey: 'checkmate:03ee8845-e605-4a1d-acbd-c02a35300c1c',
  title: 'Failed: CHAT-04: Caption scene query for 90–120 seconds',
  bizSequence: 42,
  activeMarker: 1,
  openingRevisionId: 2,
  currentEvidenceRevisionId: 2,
  outboxEventType: 'plane_defect_create_requested',
  outboxEventKey: 'defect-cycle:2:plane-create',
  evidence: [] as DfrRecoveryEvidenceManifest[],
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  )
}

/** Canonical JSON is sorted by object key and preserves array order. */
export const canonicalJson = (value: unknown): string => {
  const result = JSON.stringify(canonicalValue(value))
  if (result === undefined) throw new Error('canonical JSON cannot encode undefined')
  return result
}

export const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export const recoveryManifestDigest = (
  manifest: Omit<DfrRecoveryManifest, 'sha256'>,
) => sha256(canonicalJson(manifest))

const requireString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

const requirePositiveInteger = (value: unknown, name: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value as number
}

const parseEvidence = (
  value: unknown,
  recordIndex: number,
): DfrRecoveryEvidenceManifest[] => {
  if (!Array.isArray(value)) {
    throw new Error(`manifest.records[${recordIndex}].evidence must be an array`)
  }
  const keys = [
    'planeEvidenceDeliveryId',
    'resultRevisionId',
    'sourceIdentity',
    'provider',
    'providerWorkspaceId',
    'providerProjectId',
    'providerWorkItemId',
    'providerCommentId',
    'providerAssetId',
    'providerAttachmentId',
    'deliveryState',
    'leaseToken',
    'leaseExpiresOn',
    'lastError',
    'deliveredOn',
    'action',
  ] as const
  return value.map((entry, evidenceIndex) => {
    if (!isRecord(entry) || !hasExactKeys(entry, keys)) {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}] has unexpected or missing keys`,
      )
    }
    requirePositiveInteger(
      entry.planeEvidenceDeliveryId,
      `manifest.records[${recordIndex}].evidence[${evidenceIndex}].planeEvidenceDeliveryId`,
    )
    requirePositiveInteger(
      entry.resultRevisionId,
      `manifest.records[${recordIndex}].evidence[${evidenceIndex}].resultRevisionId`,
    )
    for (const key of [
      'sourceIdentity',
      'provider',
      'providerWorkspaceId',
      'providerProjectId',
    ] as const) {
      requireString(
        entry[key],
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].${key}`,
      )
    }
    for (const key of [
      'providerWorkItemId',
      'providerCommentId',
      'providerAssetId',
      'providerAttachmentId',
    ] as const) {
      if (entry[key] !== null && typeof entry[key] !== 'string') {
        throw new Error(
          `manifest.records[${recordIndex}].evidence[${evidenceIndex}].${key} must be null or a string`,
        )
      }
    }
    if (entry.leaseToken !== null && typeof entry.leaseToken !== 'string') {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].leaseToken must be null or a string`,
      )
    }
    if (entry.lastError !== null && typeof entry.lastError !== 'string') {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].lastError must be null or a string`,
      )
    }
    if (entry.leaseExpiresOn !== null) {
      const leaseExpiresOn = requireString(
        entry.leaseExpiresOn,
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].leaseExpiresOn`,
      )
      if (Number.isNaN(Date.parse(leaseExpiresOn))) {
        throw new Error(
          `manifest.records[${recordIndex}].evidence[${evidenceIndex}].leaseExpiresOn must be an ISO timestamp`,
        )
      }
    }
    if (
      entry.deliveryState !== 'pending' &&
      entry.deliveryState !== 'reserved' &&
      entry.deliveryState !== 'retry_due' &&
      entry.deliveryState !== 'delivered' &&
      entry.deliveryState !== 'manual_attention'
    ) {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].deliveryState is not allowlisted`,
      )
    }
    if (entry.deliveredOn !== null) {
      const deliveredOn = requireString(
        entry.deliveredOn,
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].deliveredOn`,
      )
      if (Number.isNaN(Date.parse(deliveredOn))) {
        throw new Error(
          `manifest.records[${recordIndex}].evidence[${evidenceIndex}].deliveredOn must be an ISO timestamp`,
        )
      }
    }
    if (entry.action !== 'preserve' && entry.action !== 'relink') {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}].action is not allowlisted`,
      )
    }
    if (
      entry.action === 'relink' &&
      (entry.deliveryState !== 'pending' ||
        entry.providerWorkItemId !== null ||
        entry.providerCommentId !== null ||
        entry.providerAssetId !== null ||
        entry.providerAttachmentId !== null ||
        entry.leaseToken !== null ||
        entry.leaseExpiresOn !== null ||
        entry.deliveredOn !== null ||
        entry.lastError !== null)
    ) {
      throw new Error(
        `manifest.records[${recordIndex}].evidence[${evidenceIndex}] relink entry must be the exact pending/null shape`,
      )
    }
    return entry as DfrRecoveryEvidenceManifest
  })
}

const parseRecord = (
  value: unknown,
  index: number,
): DfrRecoveryManifestRecord => {
  if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)) {
    throw new Error(`manifest.records[${index}] has unexpected or missing keys`)
  }
  for (const key of [
    'projectId',
    'runId',
    'testId',
    'testRunMapId',
    'defectCycleId',
    'resultRevisionId',
    'revisionNumber',
    'currentResultRevisionId',
    'resultOutboxId',
    'bizSequence',
  ] as const) {
    requirePositiveInteger(value[key], `manifest.records[${index}].${key}`)
  }
  if (value.isIncluded !== true) {
    throw new Error(`manifest.records[${index}].isIncluded must be true`)
  }
  requirePositiveInteger(
    value.currentResultRevisionId,
    `manifest.records[${index}].currentResultRevisionId`,
  )
  if (value.currentResultRevisionId !== value.resultRevisionId) {
    throw new Error(`manifest.records[${index}].currentResultRevisionId must match resultRevisionId`)
  }
  for (const key of [
    'sourcePayloadDigest',
    'bizWorkItemId',
    'bizIntakeId',
    'correlationKey',
    'title',
  ] as const) {
    requireString(value[key], `manifest.records[${index}].${key}`)
  }
  if (value.activeMarker !== 1) {
    throw new Error(`manifest.records[${index}].activeMarker must be 1`)
  }
  requirePositiveInteger(value.openingRevisionId, `manifest.records[${index}].openingRevisionId`)
  requirePositiveInteger(
    value.currentEvidenceRevisionId,
    `manifest.records[${index}].currentEvidenceRevisionId`,
  )
  if (value.outboxEventType !== 'plane_defect_create_requested') {
    throw new Error(`manifest.records[${index}].outboxEventType did not match the recovery contract`)
  }
  const outboxEventKey = requireString(
    value.outboxEventKey,
    `manifest.records[${index}].outboxEventKey`,
  )
  if (outboxEventKey !== `defect-cycle:${value.defectCycleId}:plane-create`) {
    throw new Error(`manifest.records[${index}].outboxEventKey did not match the exact cycle`)
  }
  const sourcePayloadDigest = requireString(
    value.sourcePayloadDigest,
    `manifest.records[${index}].sourcePayloadDigest`,
  )
  if (sourcePayloadDigest.length !== 64 || !/^[a-f0-9]{64}$/.test(sourcePayloadDigest)) {
    throw new Error(`manifest.records[${index}].sourcePayloadDigest must be lowercase SHA-256`)
  }
  if (value.sourceState !== 'manual_attention' && value.sourceState !== 'intake_open') {
    throw new Error(`manifest.records[${index}].sourceState is not allowlisted`)
  }
  return {
    ...value,
    evidence: parseEvidence(value.evidence, index),
  } as DfrRecoveryManifestRecord
}

export const parseDfrRecoveryManifest = (
  input: string | unknown,
): DfrRecoveryManifest => {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      throw new Error('manifest must be valid JSON')
    }
  }
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    throw new Error('manifest has unexpected or missing keys')
  }
  if (value.recoveryId !== TVP599_DFR_RECOVERY_ID) {
    throw new Error('manifest recoveryId did not match the exact TVP-599 recovery')
  }
  const expectedActorId = requireString(value.expectedActorId, 'manifest.expectedActorId')
  const expectedActorIdentity = requireString(
    value.expectedActorIdentity,
    'manifest.expectedActorIdentity',
  )
  if (!isRecord(value.route) || !hasExactKeys(value.route, ROUTE_KEYS)) {
    throw new Error('manifest route has unexpected or missing keys')
  }
  if (
    value.route.destinationKey !== TVP599_DFR_ROUTE.destinationKey ||
    value.route.workspaceId !== TVP599_DFR_ROUTE.workspaceId ||
    value.route.projectId !== TVP599_DFR_ROUTE.projectId ||
    value.route.projectIdentifier !== TVP599_DFR_ROUTE.projectIdentifier
  ) {
    throw new Error('manifest route did not match the exact DFR route')
  }
  if (!Array.isArray(value.records) || value.records.length !== 2) {
    throw new Error('manifest must contain exactly two records')
  }
  const records = value.records.map(parseRecord) as [
    DfrRecoveryManifestRecord,
    DfrRecoveryManifestRecord,
  ]
  const withoutEvidence = (record: DfrRecoveryManifestRecord) => {
    const {evidence: _evidence, ...identity} = record
    return identity
  }
  if (
    canonicalJson(withoutEvidence({...records[0], sourcePayloadDigest: TVP599_BIZ41_PAYLOAD_DIGEST})) !==
      canonicalJson(withoutEvidence(BIZ41_RECORD)) ||
    canonicalJson(withoutEvidence(records[1])) !==
      canonicalJson(
        withoutEvidence({
          ...BIZ42_RECORD_IDENTITY,
          sourcePayloadDigest: records[1].sourcePayloadDigest,
          evidence: [] as DfrRecoveryEvidenceManifest[],
        } as DfrRecoveryManifestRecord),
      )
  ) {
    throw new Error('manifest records were mixed, reordered, or did not match exact TVP-599 tuples')
  }
  if (records[0].sourcePayloadDigest !== TVP599_BIZ41_PAYLOAD_DIGEST) {
    throw new Error('BIZ-41 manifest payload digest did not match the immutable expected digest')
  }
  const suppliedDigest = requireString(value.sha256, 'manifest.sha256')
  if (!/^[a-f0-9]{64}$/.test(suppliedDigest)) {
    throw new Error('manifest.sha256 must be lowercase SHA-256')
  }
  const withoutDigest = {
    recoveryId: value.recoveryId,
    route: value.route,
    expectedActorId,
    expectedActorIdentity,
    records,
  } as Omit<DfrRecoveryManifest, 'sha256'>
  if (recoveryManifestDigest(withoutDigest) !== suppliedDigest) {
    throw new Error('manifest SHA-256 verification failed')
  }
  return {
    recoveryId: value.recoveryId,
    route: value.route as typeof TVP599_DFR_ROUTE,
    expectedActorId,
    expectedActorIdentity,
    records,
    sha256: suppliedDigest,
  }
}

export type DfrRecoverySource = {
  manifest: DfrRecoveryManifestRecord
  payload: Record<string, unknown>
  immutableSourcePayload: Record<string, unknown> | null
  map: {
    testRunMapId: number
    projectId: number
    runId: number | null
    testId: number | null
    isIncluded: boolean | null
    currentResultRevisionId: number | null
  }
  revisionNumber: number
  cycle: {
    state: string
    activeMarker: number | null
    openingRevisionId: number
    currentEvidenceRevisionId: number
    provider: string | null
    providerWorkspaceId: string | null
    providerProjectId: string | null
    providerWorkItemId: string | null
    providerIntakeId: string | null
    providerStateId: string | null
    providerSequenceId: number | null
    providerUrl: string | null
    createCorrelationKey: string | null
  }
  outbox: {
    eventType: string
    eventKey: string
    deliveryState: string
    leaseToken: string | null
    leaseExpiresOn: Date | null
    deliveredOn: Date | null
    lastError: string | null
  }
  evidence: Array<{
    planeEvidenceDeliveryId: number
    resultRevisionId: number
    sourceIdentity: string
    provider: string
    providerWorkspaceId: string
    providerProjectId: string
    providerWorkItemId: string | null
    providerCommentId: string | null
    providerAssetId: string | null
    providerAttachmentId: string | null
    deliveryState: string
    leaseToken: string | null
    leaseExpiresOn: Date | null
    deliveredOn: Date | null
    lastError: string | null
  }>
  terminal: boolean
}

export type DfrRecoveryReplacement = {
  record: DfrRecoveryManifestRecord
  workItemId: string
  intakeId: string
  sequenceId: number
  stateId: string
  workItem: PlaneWorkItem
}

export type DfrRecoveryDatabase = {
  inspectExactTargets(manifest: DfrRecoveryManifest): Promise<DfrRecoverySource[]>
  reserveTargets(input: {
    recoveryId: string
    records: DfrRecoverySource[]
    leaseToken: string
    now: Date
    leaseExpiresOn: Date
  }): Promise<void>
  finalizeTargets(input: {
    recoveryId: string
    records: DfrRecoverySource[]
    replacements: DfrRecoveryReplacement[]
    leaseToken: string
    now: Date
  }): Promise<void>
  markManualAttention(input: {
    recoveryId: string
    records: DfrRecoverySource[]
    reason: string
    leaseToken?: string
    leaseExpiresOn?: Date
  }): Promise<void>
}

export type DfrRecoveryProvider = {
  checkAccess(): Promise<{
    actorId: string
    actorIdentity: string
    workspaceId: string
    projectId: string
    projectIdentifier: string
  }>
  findByCorrelation(correlationKey: string): Promise<PlaneWorkItem[]>
  createIntake(request: PlaneIntakeCreateRequest): Promise<PlaneIntakeCreateResponse>
  getWorkItem(workItemId: string): Promise<PlaneWorkItem>
  getIntakeWorkItem(request: {workItemId: string; intakeId: string}): Promise<PlaneWorkItem>
}

export type DfrRecoveryBizProvider = Pick<
  DfrRecoveryProvider,
  'checkAccess' | 'getIntakeWorkItem' | 'getWorkItem'
> & {
  ensureComment(request: {
    workItemId: string
    marker: string
    commentHtml: string
  }): Promise<PlaneCommentDeliveryResponse>
}

const readRawString = (raw: Record<string, unknown>, names: string[]) => {
  for (const name of names) {
    const value = raw[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const readRawId = (raw: Record<string, unknown>, names: string[]) => {
  const direct = readRawString(raw, names)
  if (direct) return direct
  for (const name of names) {
    const value = raw[name]
    if (isRecord(value) && typeof value.id === 'string' && value.id.trim()) {
      return value.id.trim()
    }
  }
  return null
}

const observedCorrelation = (workItem: PlaneWorkItem) => {
  const direct = readRawString(workItem.raw, [
    'correlation_key',
    'correlationKey',
    'create_correlation_key',
    'createCorrelationKey',
  ])
  if (direct) return direct
  const description = workItem.raw.description
  return typeof description === 'string'
    ? description.match(/(?:^|\n)Correlation:\s*([^\n\r]+)/)?.[1] ?? null
    : null
}

const observedTitle = (workItem: PlaneWorkItem) =>
  readRawString(workItem.raw, ['name', 'title'])

const observedProjectIdentifier = (workItem: PlaneWorkItem) =>
  readRawString(workItem.raw, ['project_identifier', 'projectIdentifier', 'identifier']) ??
  (isRecord(workItem.raw.issue_detail)
    ? readRawString(workItem.raw.issue_detail, ['project_identifier', 'projectIdentifier', 'identifier'])
    : null) ??
  (isRecord(workItem.raw.issue)
    ? readRawString(workItem.raw.issue, ['project_identifier', 'projectIdentifier', 'identifier'])
    : null)

const observedSequence = (workItem: PlaneWorkItem) => {
  const value = workItem.raw.sequence_id ?? workItem.raw.sequenceId
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : null
}

const validateAccess = (
  access: Awaited<ReturnType<DfrRecoveryProvider['checkAccess']>>,
  route: typeof TVP599_DFR_ROUTE | typeof TVP599_BIZ_ROUTE,
  expectedActorId: string,
  expectedActorIdentity: string,
) => {
  if (
    access.actorId !== expectedActorId ||
    access.actorIdentity !== expectedActorIdentity ||
    access.workspaceId !== route.workspaceId ||
    access.projectId !== route.projectId ||
    access.projectIdentifier !== route.projectIdentifier
  ) {
    throw new Error(`Plane authenticated actor/access did not match ${route.destinationKey}`)
  }
}

const validateSourceReadback = (
  workItem: PlaneWorkItem,
  record: DfrRecoveryManifestRecord,
) => {
  if (workItem.workItemId !== record.bizWorkItemId) {
    throw new Error(`BIZ source work item mismatch for map ${record.testRunMapId}`)
  }
  const workspaceId = readRawId(workItem.raw, ['workspace_id', 'workspaceId', 'workspace'])
  const projectId = readRawId(workItem.raw, ['project_id', 'projectId', 'project'])
  const intakeId = readRawId(workItem.raw, ['intake_id', 'intakeId', 'intake'])
  const sequenceId = observedSequence(workItem)
  if (
    workspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
    projectId !== TVP599_BIZ_ROUTE.projectId ||
    intakeId !== record.bizIntakeId ||
    observedProjectIdentifier(workItem) !== TVP599_BIZ_ROUTE.projectIdentifier ||
    observedCorrelation(workItem) !== record.correlationKey ||
    observedTitle(workItem) !== record.title ||
    sequenceId !== record.bizSequence
  ) {
    throw new Error(`BIZ source readback did not match the exact record ${record.testRunMapId}`)
  }
  if (!workItem.stateId.trim()) {
    throw new Error(`BIZ source readback did not include state for map ${record.testRunMapId}`)
  }
}

const validateSourceReadbackAgainstOrm = (
  workItem: PlaneWorkItem,
  source: DfrRecoverySource,
) => {
  const record = source.manifest
  const workspaceId = readRawId(workItem.raw, ['workspace_id', 'workspaceId', 'workspace'])
  const projectId = readRawId(workItem.raw, ['project_id', 'projectId', 'project'])
  const intakeId = readRawId(workItem.raw, ['intake_id', 'intakeId', 'intake'])
  if (
    source.cycle.provider !== 'plane' ||
    source.cycle.providerWorkspaceId !== workspaceId ||
    source.cycle.providerProjectId !== projectId ||
    source.cycle.providerWorkItemId !== workItem.workItemId ||
    source.cycle.providerIntakeId !== intakeId ||
    source.cycle.providerSequenceId !== observedSequence(workItem) ||
    source.cycle.createCorrelationKey !== observedCorrelation(workItem) ||
    source.outbox.eventType !== record.outboxEventType ||
    source.outbox.eventKey !== record.outboxEventKey
  ) {
    throw new Error(`BIZ source readback did not match the ORM snapshot for map ${record.testRunMapId}`)
  }
}

const validateDfrReadback = (
  workItem: PlaneWorkItem,
  record: DfrRecoveryManifestRecord,
  config: PlaneAdapterConfig,
) => {
  const workspaceId = readRawId(workItem.raw, ['workspace_id', 'workspaceId', 'workspace'])
  const projectId = readRawId(workItem.raw, ['project_id', 'projectId', 'project'])
  if (
    workItem.workItemId.trim() === '' ||
    workspaceId !== config.workspaceId ||
    projectId !== config.projectId ||
    observedProjectIdentifier(workItem) !== config.projectIdentifier ||
    observedCorrelation(workItem) !== record.correlationKey ||
    observedTitle(workItem) !== record.title ||
    !workItem.stateId.trim()
  ) {
    throw new Error(`DFR readback did not match the exact record ${record.testRunMapId}`)
  }
  const intakeId = readRawId(workItem.raw, ['intake_id', 'intakeId', 'intake'])
  if (intakeId === null) {
    throw new Error(`DFR readback omitted the intake identity for map ${record.testRunMapId}`)
  }
  return {
    workItemId: workItem.workItemId,
    intakeId,
    sequenceId: observedSequence(workItem),
    stateId: workItem.stateId,
    workItem,
  }
}

const recoveryComment = (
  recoveryId: string,
  record: DfrRecoveryManifestRecord,
  replacement: DfrRecoveryReplacement,
) => {
  const marker = `<!-- ${recoveryId}:${record.testRunMapId} -->`
  return {
    marker,
    commentHtml: `${marker}<p>TVP-599 DFR recovery ${recoveryId} linked this BIZ original to DFR replacement ${replacement.workItemId} (sequence ${replacement.sequenceId}).</p>`,
  }
}

export type DfrRecoveryResult =
  | {outcome: 'no_op'; recoveryId: string; records: number[]; reason: string}
  | {
      outcome: 'reconciled'
      recoveryId: string
      records: number[]
      replacements: Array<Pick<DfrRecoveryReplacement, 'workItemId' | 'intakeId' | 'sequenceId'>>
      comments: string[]
    }
  | {
      outcome: 'partial' | 'manual_attention'
      recoveryId: string
      records: number[]
      reason: string
      replacements?: Array<Pick<DfrRecoveryReplacement, 'workItemId' | 'intakeId' | 'sequenceId'>>
      commentFailures?: number[]
    }

export const areDfrRecoveryWorkersDisabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  TVP599_RECOVERY_WORKER_FLAGS.every((flag) => environment[flag] === 'false')

/** Build the one-off operator environment from explicit process provenance. */
export const buildTvp599RecoveryOperatorEnvironment = ({
  processEnvironment,
  effectiveEnvironment,
  dotenvEnvironment,
}: {
  processEnvironment: Readonly<Record<string, string | undefined>>
  effectiveEnvironment: Readonly<Record<string, string | undefined>>
  dotenvEnvironment: Readonly<Record<string, string | undefined>>
}): Record<string, string | undefined> => {
  const operatorEnvironment: Record<string, string | undefined> = {
    ...effectiveEnvironment,
    PLANE_TVP599_DFR_RECOVERY_ENABLED:
      processEnvironment.PLANE_TVP599_DFR_RECOVERY_ENABLED,
    [TVP599_RECOVERY_WRITE_GATE]:
      processEnvironment[TVP599_RECOVERY_WRITE_GATE],
  }
  for (const flag of TVP599_RECOVERY_WORKER_FLAGS) {
    if (
      processEnvironment[flag] === 'true' ||
      dotenvEnvironment[flag] === 'true'
    ) {
      operatorEnvironment[flag] = 'true'
    }
  }
  return operatorEnvironment
}

export const validateDfrRecoveryEnvironment = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => {
  if (environment.PLANE_TVP599_DFR_RECOVERY_ENABLED !== 'true') {
    throw new Error('PLANE_TVP599_DFR_RECOVERY_ENABLED is disabled')
  }
  if (environment[TVP599_RECOVERY_WRITE_GATE] !== 'true') {
    throw new Error(`${TVP599_RECOVERY_WRITE_GATE} is disabled`)
  }
  if (!areDfrRecoveryWorkersDisabled(environment)) {
    throw new Error('DFR recovery requires every normal Plane worker flag to be exactly false')
  }
  if (environment.PLANE_DESTINATION !== 'dfr-development') {
    throw new Error('DFR recovery requires PLANE_DESTINATION=dfr-development')
  }
  if (!requireString(environment.PLANE_CHECKMATE_BOT_ACTOR_ID, 'PLANE_CHECKMATE_BOT_ACTOR_ID')) {
    throw new Error('PLANE_CHECKMATE_BOT_ACTOR_ID is required')
  }
  if (!requireString(environment.PLANE_CHECKMATE_BOT_ACTOR_IDENTITY, 'PLANE_CHECKMATE_BOT_ACTOR_IDENTITY')) {
    throw new Error('PLANE_CHECKMATE_BOT_ACTOR_IDENTITY is required')
  }
}

const assertOutboxPayloadIdentity = (source: DfrRecoverySource) => {
  const payload = source.payload
  const exactIntegerFields: Array<[string, unknown, number]> = [
    ['resultRevisionId', payload.resultRevisionId, source.manifest.resultRevisionId],
    ['revisionNumber', payload.revisionNumber, source.manifest.revisionNumber],
    ['testRunMapId', payload.testRunMapId, source.manifest.testRunMapId],
    ['projectId', payload.projectId, source.manifest.projectId],
    ['runId', payload.runId, source.manifest.runId],
    ['testId', payload.testId, source.manifest.testId],
    ['defectCycleId', payload.defectCycleId, source.manifest.defectCycleId],
  ]
  for (const [field, actual, expected] of exactIntegerFields) {
    if (actual !== expected || !Number.isSafeInteger(actual)) {
      throw new Error(`ORM outbox payload ${field} did not match the exact record ${source.manifest.testRunMapId}`)
    }
  }
}

const assertSourceDelivered = (source: DfrRecoverySource) => {
  const record = source.manifest
  if (
    source.outbox.deliveryState !== 'delivered' ||
    source.outbox.deliveredOn === null ||
    source.outbox.leaseToken !== null ||
    source.outbox.leaseExpiresOn !== null ||
    source.outbox.lastError !== null
  ) {
    throw new Error(`ORM source outbox was not an exact delivered, lease-free snapshot for map ${record.testRunMapId}`)
  }
  const isDfrProvider =
    source.cycle.providerWorkspaceId === TVP599_DFR_ROUTE.workspaceId &&
    source.cycle.providerProjectId === TVP599_DFR_ROUTE.projectId
  if (isDfrProvider) return
  if (
    source.cycle.provider !== 'plane' ||
    source.cycle.providerWorkspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
    source.cycle.providerProjectId !== TVP599_BIZ_ROUTE.projectId ||
    source.cycle.providerWorkItemId !== record.bizWorkItemId ||
    source.cycle.providerIntakeId !== record.bizIntakeId ||
    source.cycle.providerSequenceId !== record.bizSequence ||
    source.cycle.providerUrl !== `${PLANE_DESTINATIONS['biz-development'].publicBaseUrl}/infinimind/browse/BIZ-${record.bizSequence}/` ||
    source.cycle.createCorrelationKey !== record.correlationKey ||
    source.cycle.providerStateId === null
  ) {
    throw new Error(`ORM delivered BIZ provider identity did not match the exact record ${record.testRunMapId}`)
  }
}

const assertSourceDigest = (source: DfrRecoverySource) => {
  assertOutboxPayloadIdentity(source)
  const actual = sha256(canonicalJson(source.payload))
  if (actual !== source.manifest.sourcePayloadDigest) {
    throw new Error(`ORM payload digest mismatch for map ${source.manifest.testRunMapId}`)
  }
  const intent = source.payload.planeDefectIntent
  if (
    !isRecord(intent) ||
    intent.create !== true ||
    intent.defectCycleId !== source.manifest.defectCycleId ||
    intent.correlationKey !== source.manifest.correlationKey ||
    intent.title !== source.manifest.title ||
    intent.providerWorkspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
    intent.providerProjectId !== TVP599_BIZ_ROUTE.projectId ||
    (intent.providerProjectIdentifier !== undefined &&
      intent.providerProjectIdentifier !== TVP599_BIZ_ROUTE.projectIdentifier)
  ) {
    throw new Error(`ORM source intent did not match the exact BIZ record ${source.manifest.testRunMapId}`)
  }
}

const assertImmutableSourceDigest = (source: DfrRecoverySource) => {
  if (source.immutableSourcePayload === null) {
    throw new Error(`immutable BIZ source snapshot was missing for map ${source.manifest.testRunMapId}`)
  }
  const immutableSource = source.immutableSourcePayload
  const actual = sha256(canonicalJson(immutableSource))
  if (actual !== source.manifest.sourcePayloadDigest) {
    throw new Error(`immutable BIZ source payload digest mismatch for map ${source.manifest.testRunMapId}`)
  }
  const intent = immutableSource.planeDefectIntent
  if (
    !isRecord(intent) ||
    intent.create !== true ||
    intent.defectCycleId !== source.manifest.defectCycleId ||
    intent.correlationKey !== source.manifest.correlationKey ||
    intent.title !== source.manifest.title ||
    intent.providerWorkspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
    intent.providerProjectId !== TVP599_BIZ_ROUTE.projectId ||
    intent.providerProjectIdentifier !== TVP599_BIZ_ROUTE.projectIdentifier
  ) {
    throw new Error(`immutable BIZ source intent did not match the exact record ${source.manifest.testRunMapId}`)
  }
  const exactIntegerFields: Array<[string, unknown, number]> = [
    ['resultRevisionId', immutableSource.resultRevisionId, source.manifest.resultRevisionId],
    ['revisionNumber', immutableSource.revisionNumber, source.manifest.revisionNumber],
    ['testRunMapId', immutableSource.testRunMapId, source.manifest.testRunMapId],
    ['projectId', immutableSource.projectId, source.manifest.projectId],
    ['runId', immutableSource.runId, source.manifest.runId],
    ['testId', immutableSource.testId, source.manifest.testId],
    ['defectCycleId', immutableSource.defectCycleId, source.manifest.defectCycleId],
  ]
  for (const [field, actualField, expected] of exactIntegerFields) {
    if (actualField !== expected || !Number.isSafeInteger(actualField)) {
      throw new Error(`immutable BIZ source payload ${field} did not match the exact record ${source.manifest.testRunMapId}`)
    }
  }
}

const assertSourceIdentity = (source: DfrRecoverySource) => {
  const record = source.manifest
  if (
    source.map.testRunMapId !== record.testRunMapId ||
    source.map.projectId !== record.projectId ||
    source.map.runId !== record.runId ||
    source.map.testId !== record.testId ||
    source.map.isIncluded !== record.isIncluded ||
    source.map.currentResultRevisionId !== record.currentResultRevisionId ||
    source.revisionNumber !== record.revisionNumber ||
    source.cycle.activeMarker !== record.activeMarker ||
    source.cycle.openingRevisionId !== record.openingRevisionId ||
    source.cycle.currentEvidenceRevisionId !== record.currentEvidenceRevisionId ||
    source.outbox.eventType !== record.outboxEventType ||
    source.outbox.eventKey !== record.outboxEventKey
  ) {
      throw new Error(`ORM active/revision/outbox identity mismatch for map ${record.testRunMapId}`)
  }
  assertOutboxPayloadIdentity(source)
}

const hasProviderArtifact = (evidence: DfrRecoverySource['evidence'][number]) =>
  evidence.providerWorkItemId !== null ||
  evidence.providerCommentId !== null ||
  evidence.providerAssetId !== null ||
  evidence.providerAttachmentId !== null

const hasEvidenceArtifactExceptWorkItem = (
  evidence: DfrRecoverySource['evidence'][number],
) =>
  evidence.providerCommentId !== null ||
  evidence.providerAssetId !== null ||
  evidence.providerAttachmentId !== null

const validateEvidenceSnapshot = (
  source: DfrRecoverySource,
  terminal: boolean,
) => {
  const expected = new Map(
    source.manifest.evidence.map((entry) => [entry.planeEvidenceDeliveryId, entry]),
  )
  if (expected.size !== source.manifest.evidence.length) {
    throw new Error(`manifest evidence IDs were duplicated for map ${source.manifest.testRunMapId}`)
  }
  if (source.evidence.length !== expected.size) {
    throw new Error(`ORM evidence cardinality did not match the manifest for map ${source.manifest.testRunMapId}`)
  }
  for (const evidence of source.evidence) {
    const entry = expected.get(evidence.planeEvidenceDeliveryId)
    if (!entry) {
      throw new Error(`ORM evidence row was outside the manifest for map ${source.manifest.testRunMapId}`)
    }
    const manifestIdentityMismatch =
      evidence.resultRevisionId !== entry.resultRevisionId ||
      evidence.sourceIdentity !== entry.sourceIdentity ||
      evidence.deliveryState !== entry.deliveryState ||
      (entry.action === 'preserve' &&
        (evidence.provider !== entry.provider ||
          evidence.providerWorkspaceId !== entry.providerWorkspaceId ||
          evidence.providerProjectId !== entry.providerProjectId)) ||
      (!terminal &&
        (evidence.provider !== entry.provider ||
          evidence.providerWorkspaceId !== entry.providerWorkspaceId ||
          evidence.providerProjectId !== entry.providerProjectId))
    if (manifestIdentityMismatch) {
      throw new Error(`ORM evidence identity/state mismatch for map ${source.manifest.testRunMapId}`)
    }
    const deliveredOn = evidence.deliveredOn?.toISOString() ?? null
    const leaseExpiresOn = evidence.leaseExpiresOn?.toISOString() ?? null
    if (
      evidence.leaseToken !== entry.leaseToken ||
      leaseExpiresOn !== entry.leaseExpiresOn ||
      evidence.lastError !== entry.lastError
    ) {
      throw new Error(`ORM evidence lease/error snapshot mismatch for map ${source.manifest.testRunMapId}`)
    }
    if (evidence.providerWorkItemId !== entry.providerWorkItemId && entry.action === 'preserve') {
      throw new Error(`preserved evidence provider work-item mismatch for map ${source.manifest.testRunMapId}`)
    }
    if (
      (entry.action === 'preserve' &&
        (evidence.providerCommentId !== entry.providerCommentId ||
          evidence.providerAssetId !== entry.providerAssetId ||
          evidence.providerAttachmentId !== entry.providerAttachmentId)) ||
      (entry.action === 'relink' &&
        (evidence.providerCommentId !== entry.providerCommentId ||
          evidence.providerAssetId !== entry.providerAssetId ||
          evidence.providerAttachmentId !== entry.providerAttachmentId)) ||
      deliveredOn !== entry.deliveredOn
    ) {
      throw new Error(`ORM evidence provider artifact snapshot mismatch for map ${source.manifest.testRunMapId}`)
    }
    if (entry.action === 'preserve') {
      if (
        evidence.provider !== 'plane' ||
        evidence.providerWorkspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
        evidence.providerProjectId !== TVP599_BIZ_ROUTE.projectId ||
        evidence.deliveryState !== entry.deliveryState ||
        !hasProviderArtifact(evidence) ||
        evidence.leaseToken !== null ||
        evidence.leaseExpiresOn !== null ||
        evidence.deliveredOn === null
      ) {
        throw new Error(`preserved evidence was not an exact completed BIZ delivery for map ${source.manifest.testRunMapId}`)
      }
    } else if (terminal) {
      if (
        evidence.provider !== 'plane' ||
        evidence.providerWorkspaceId !== TVP599_DFR_ROUTE.workspaceId ||
        evidence.providerProjectId !== TVP599_DFR_ROUTE.projectId ||
        evidence.providerWorkItemId !== source.cycle.providerWorkItemId ||
        hasEvidenceArtifactExceptWorkItem(evidence) ||
        (entry.deliveryState !== 'pending' && entry.deliveryState !== 'delivered') ||
        evidence.leaseToken !== null ||
        evidence.leaseExpiresOn !== null ||
        (entry.deliveryState === 'pending'
          ? evidence.deliveredOn !== null
          : evidence.deliveredOn === null)
      ) {
        throw new Error(`relinked evidence terminal identity was not exact for map ${source.manifest.testRunMapId}`)
      }
    } else if (
      evidence.provider !== 'plane' ||
      evidence.providerWorkspaceId !== TVP599_BIZ_ROUTE.workspaceId ||
      evidence.providerProjectId !== TVP599_BIZ_ROUTE.projectId ||
      evidence.deliveryState !== 'pending' ||
      hasProviderArtifact(evidence) ||
      evidence.leaseToken !== null ||
      evidence.leaseExpiresOn !== null ||
      evidence.deliveredOn !== null
    ) {
      throw new Error(`relink evidence was not an artifact-free pending BIZ row for map ${source.manifest.testRunMapId}`)
    }
  }
}

const exactTerminalSource = (source: DfrRecoverySource) => {
  if (
    source.outbox.deliveryState !== 'delivered' ||
    source.outbox.leaseToken !== null ||
    source.outbox.leaseExpiresOn !== null ||
    source.outbox.deliveredOn === null ||
    source.outbox.eventType !== source.manifest.outboxEventType ||
    source.outbox.eventKey !== source.manifest.outboxEventKey ||
    source.cycle.state !== 'work_item_open' ||
    source.cycle.activeMarker !== source.manifest.activeMarker ||
    source.cycle.openingRevisionId !== source.manifest.openingRevisionId ||
    source.cycle.currentEvidenceRevisionId !== source.manifest.currentEvidenceRevisionId ||
    source.cycle.provider !== 'plane' ||
    source.cycle.providerWorkspaceId !== TVP599_DFR_ROUTE.workspaceId ||
    source.cycle.providerProjectId !== TVP599_DFR_ROUTE.projectId ||
    source.cycle.providerWorkItemId === null ||
    source.cycle.providerIntakeId === null ||
    source.cycle.providerStateId === null ||
    source.cycle.providerSequenceId === null ||
    source.cycle.providerSequenceId < 1 ||
    source.cycle.createCorrelationKey !== source.manifest.correlationKey ||
    source.cycle.providerUrl !== `${PLANE_DESTINATIONS['dfr-development'].publicBaseUrl}/infinimind/browse/DFR-${source.cycle.providerSequenceId}/`
  ) {
    return false
  }
  const intent = source.payload.planeDefectIntent
  try {
    assertImmutableSourceDigest(source)
    if (
      canonicalJson(source.payload) !==
      canonicalJson(rewriteDfrProviderRoute(source.immutableSourcePayload!))
    ) {
      return false
    }
  } catch {
    return false
  }
  if (
    !isRecord(intent) ||
    intent.defectCycleId !== source.manifest.defectCycleId ||
    intent.correlationKey !== source.manifest.correlationKey ||
    intent.title !== source.manifest.title ||
    intent.providerWorkspaceId !== TVP599_DFR_ROUTE.workspaceId ||
    intent.providerProjectId !== TVP599_DFR_ROUTE.projectId ||
    intent.providerProjectIdentifier !== TVP599_DFR_ROUTE.projectIdentifier
  ) {
    return false
  }
  try {
    validateEvidenceSnapshot(source, true)
    return true
  } catch {
    return false
  }
}

const replacementSummary = (replacements: DfrRecoveryReplacement[]) =>
  replacements.map(({workItemId, intakeId, sequenceId}) => ({
    workItemId,
    intakeId,
    sequenceId,
  }))

/** Rewrite only the durable DFR provider route fields in a preserved payload. */
export const rewriteDfrProviderRoute = (payload: Record<string, unknown>) => {
  const intent = payload.planeDefectIntent
  if (!isRecord(intent)) {
    throw new Error('source payload omitted planeDefectIntent')
  }
  return {
    ...payload,
    planeDefectIntent: {
      ...intent,
      providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
      providerProjectId: TVP599_DFR_ROUTE.projectId,
      providerProjectIdentifier: TVP599_DFR_ROUTE.projectIdentifier,
    },
  }
}

/**
 * Runs one exact, two-record, fail-closed recovery. Provider calls happen
 * only after the reservation transaction has returned and are never retried
 * after an ambiguous create.
 */
export const runPlaneTvp599DfrRecovery = async ({
  manifest,
  database,
  dfrProvider,
  bizProvider,
  dfrConfig,
  environment = process.env,
  now = new Date(),
  leaseMs = 10 * 60 * 1000,
}: {
  manifest: DfrRecoveryManifest
  database: DfrRecoveryDatabase
  dfrProvider: DfrRecoveryProvider
  bizProvider: DfrRecoveryBizProvider
  dfrConfig: PlaneAdapterConfig
  environment?: Readonly<Record<string, string | undefined>>
  now?: Date
  leaseMs?: number
}): Promise<DfrRecoveryResult> => {
  validateDfrRecoveryEnvironment(environment)
  if (dfrConfig.destinationKey !== 'dfr-development' || !planeDestinationMatchesProviderIds('dfr-development', dfrConfig.workspaceId, dfrConfig.projectId)) {
    throw new Error('DFR adapter did not use the exact allowlisted DFR route')
  }
  if (
    environment.PLANE_CHECKMATE_BOT_ACTOR_ID !== manifest.expectedActorId ||
    environment.PLANE_CHECKMATE_BOT_ACTOR_IDENTITY !== manifest.expectedActorIdentity
  ) {
    throw new Error('manifest actor fence did not match the exact operator environment')
  }
  const records = manifest.records.map((record) => record.testRunMapId)
  const sources = (await database.inspectExactTargets(manifest)).sort(
    (left, right) => left.manifest.testRunMapId - right.manifest.testRunMapId,
  )
  if (sources.length !== 2 || sources.some((source) => !records.includes(source.manifest.testRunMapId))) {
    throw new Error('ORM exact-target cardinality or identity check failed')
  }
  for (const source of sources) {
    assertSourceIdentity(source)
    assertSourceDelivered(source)
  }
  const terminalByMap = new Map(
    sources.map((source) => [source.manifest.testRunMapId, exactTerminalSource(source)]),
  )
  const allTerminal = sources.every((source) => terminalByMap.get(source.manifest.testRunMapId))
  const mixedTerminal = sources.some((source) => terminalByMap.get(source.manifest.testRunMapId)) && !allTerminal
  const terminalLike = sources.some(
    (source) =>
      (source.cycle.providerWorkspaceId === TVP599_DFR_ROUTE.workspaceId &&
        source.cycle.providerProjectId === TVP599_DFR_ROUTE.projectId),
  )
  if (!allTerminal && (mixedTerminal || terminalLike)) {
    const reason = mixedTerminal
      ? 'exact targets were in a mixed terminal and source state'
      : 'exact target had terminal-looking DFR/provider state without complete terminal consistency'
    await database.markManualAttention({
      recoveryId: manifest.recoveryId,
      records: sources,
      reason,
    })
    return {
      outcome: 'manual_attention',
      recoveryId: manifest.recoveryId,
      records,
      reason,
    }
  }
  for (const source of sources) {
    const terminal = terminalByMap.get(source.manifest.testRunMapId) === true
    if (!terminal) assertSourceDigest(source)
    validateEvidenceSnapshot(source, terminal)
    if (!terminal && source.manifest.sourceState !== source.cycle.state) {
      throw new Error(`source cycle state mismatch for map ${source.manifest.testRunMapId}`)
    }
    if (source.cycle.createCorrelationKey !== source.manifest.correlationKey) {
      throw new Error(`source cycle correlation mismatch for map ${source.manifest.testRunMapId}`)
    }
  }
  if (allTerminal) {
    return {
      outcome: 'no_op',
      recoveryId: manifest.recoveryId,
      records,
      reason: 'Both exact records are already in the terminal completed state',
    }
  }

  validateAccess(
    await bizProvider.checkAccess(),
    TVP599_BIZ_ROUTE,
    manifest.expectedActorId,
    manifest.expectedActorIdentity,
  )
  validateAccess(
    await dfrProvider.checkAccess(),
    TVP599_DFR_ROUTE,
    manifest.expectedActorId,
    manifest.expectedActorIdentity,
  )
  for (const source of sources) {
    const readback = await bizProvider.getIntakeWorkItem({
      workItemId: source.manifest.bizWorkItemId,
      intakeId: source.manifest.bizIntakeId,
    })
    validateSourceReadback(readback, source.manifest)
    validateSourceReadbackAgainstOrm(readback, source)
  }

  const duplicateCandidates = new Map<number, DfrRecoveryReplacement>()
  for (const source of sources) {
    const duplicates = await dfrProvider.findByCorrelation(source.manifest.correlationKey)
    if (duplicates.length > 1) {
      throw new Error(`DFR duplicate cardinality was ${duplicates.length} for map ${source.manifest.testRunMapId}`)
    }
    if (duplicates.length === 1) {
      const readback = await dfrProvider.getWorkItem(duplicates[0].workItemId)
      const valid = validateDfrReadback(readback, source.manifest, dfrConfig)
      if (valid.sequenceId === null) {
        throw new Error(`DFR duplicate omitted sequence for map ${source.manifest.testRunMapId}`)
      }
      duplicateCandidates.set(source.manifest.testRunMapId, {
        record: source.manifest,
        workItemId: valid.workItemId,
        intakeId: valid.intakeId,
        sequenceId: valid.sequenceId,
        stateId: valid.stateId,
        workItem: valid.workItem,
      })
    }
  }

  const leaseToken = randomUUID()
  const leaseExpiresOn = new Date(now.getTime() + leaseMs)
  await database.reserveTargets({
    recoveryId: manifest.recoveryId,
    records: sources,
    leaseToken,
    now,
    leaseExpiresOn,
  })

  const replacements: DfrRecoveryReplacement[] = []
  try {
    for (const source of sources.sort((left, right) => left.manifest.testRunMapId - right.manifest.testRunMapId)) {
      const existing = duplicateCandidates.get(source.manifest.testRunMapId)
      if (existing) {
        replacements.push(existing)
        continue
      }
      const intent = source.payload.planeDefectIntent
      if (!isRecord(intent) || intent.create !== true) {
        throw new Error(`source payload omitted a create intent for map ${source.manifest.testRunMapId}`)
      }
      let created: PlaneIntakeCreateResponse
      try {
        created = await dfrProvider.createIntake({
          title: source.manifest.title,
          description: typeof intent.description === 'string' ? intent.description : `Correlation: ${source.manifest.correlationKey}`,
          priority: intent.priority === 'urgent' || intent.priority === 'high' || intent.priority === 'medium' || intent.priority === 'low' || intent.priority === 'none' ? intent.priority : 'none',
        })
      } catch (error) {
        if (!(error instanceof PlaneAdapterError) || error.kind !== 'ambiguous_create') {
          throw error
        }
        // A timed-out POST is never retried. Reconcile only by the stable
        // correlation key and then perform the same exact readback gate.
        const matches = await dfrProvider.findByCorrelation(source.manifest.correlationKey)
        if (matches.length !== 1) {
          throw new Error(`ambiguous DFR create lookup cardinality was ${matches.length} for map ${source.manifest.testRunMapId}`)
        }
        const readback = await dfrProvider.getWorkItem(matches[0].workItemId)
        const valid = validateDfrReadback(readback, source.manifest, dfrConfig)
        if (valid.sequenceId === null) {
          throw new Error(`ambiguous DFR create lookup omitted sequence for map ${source.manifest.testRunMapId}`)
        }
        replacements.push({
          record: source.manifest,
          workItemId: valid.workItemId,
          intakeId: valid.intakeId,
          sequenceId: valid.sequenceId,
          stateId: valid.stateId,
          workItem: valid.workItem,
        })
        continue
      }
      if (!created.intakeId || !created.workItemId) {
        throw new Error(`DFR create omitted an exact intake/work-item identity for map ${source.manifest.testRunMapId}`)
      }
      const readback = await dfrProvider.getIntakeWorkItem({
        workItemId: created.workItemId,
        intakeId: created.intakeId,
      })
      const valid = validateDfrReadback(readback, source.manifest, dfrConfig)
      const sequenceId = valid.sequenceId
      if (sequenceId === null) {
        throw new Error(`DFR create/readback omitted sequence for map ${source.manifest.testRunMapId}`)
      }
      replacements.push({
        record: source.manifest,
        workItemId: valid.workItemId,
        intakeId: created.intakeId,
        sequenceId,
        stateId: valid.stateId,
        workItem: valid.workItem,
      })
    }
    if (replacements.length !== 2) throw new Error('DFR provider outcome was partial')
    await database.finalizeTargets({
      recoveryId: manifest.recoveryId,
      records: sources,
      replacements,
      leaseToken,
      now,
    })
  } catch (error) {
    const reason = sanitizePlaneError(error)
    try {
      await database.markManualAttention({
        recoveryId: manifest.recoveryId,
        records: sources,
        reason,
        leaseToken,
        leaseExpiresOn,
      })
    } catch (auditError) {
      throw new Error(`${reason}; manual attention audit failed: ${sanitizePlaneError(auditError)}`)
    }
    return {
      outcome: replacements.length > 0 ? 'partial' : 'manual_attention',
      recoveryId: manifest.recoveryId,
      records,
      reason,
      ...(replacements.length > 0 ? {replacements: replacementSummary(replacements)} : {}),
    }
  }

  const commentFailures: number[] = []
  for (const replacement of replacements) {
    const comment = recoveryComment(manifest.recoveryId, replacement.record, replacement)
    try {
      await bizProvider.ensureComment({
        workItemId: replacement.record.bizWorkItemId,
        marker: comment.marker,
        commentHtml: comment.commentHtml,
      })
    } catch {
      commentFailures.push(replacement.record.testRunMapId)
    }
  }
  if (commentFailures.length > 0) {
    return {
      outcome: 'partial',
      recoveryId: manifest.recoveryId,
      records,
      replacements: replacementSummary(replacements),
      reason: 'DFR finalization succeeded but one or more BIZ link comments failed',
      commentFailures,
    }
  }
  return {
    outcome: 'reconciled',
    recoveryId: manifest.recoveryId,
    records,
    replacements: replacementSummary(replacements),
    comments: replacements.map((replacement) => `${replacement.record.bizWorkItemId}:${replacement.workItemId}`),
  }
}

type SelectQueryLike = {
  from(table: unknown): SelectQueryLike
  innerJoin(table: unknown, condition: unknown): SelectQueryLike
  leftJoin(table: unknown, condition: unknown): SelectQueryLike
  where(condition: unknown): SelectQueryLike
  orderBy(...orders: unknown[]): SelectQueryLike
  limit(value: number): SelectQueryLike
  for(mode: 'update'): SelectQueryLike
  then<TResult1 = unknown[], TResult2 = never>(onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2>
}
type UpdateQueryLike = {
  set(values: unknown): {where(condition: unknown): PromiseLike<Array<{affectedRows: number}>>}
}
type TransactionLike = {
  select(selection: unknown): SelectQueryLike
  update(table: unknown): UpdateQueryLike
  insert(table: unknown): {
    values(values: unknown): {
      onDuplicateKeyUpdate(values: unknown): {execute(): Promise<unknown>}
      execute(): Promise<unknown>
    }
  }
}
type DfrDrizzleDatabase = {
  select(selection: unknown): SelectQueryLike
  transaction<T>(callback: (trx: TransactionLike) => Promise<T>): Promise<T>
}

const selectRows = async <T>(query: SelectQueryLike) => query as unknown as Promise<T[]>

const lockAndValidateMap = async (
  trx: TransactionLike,
  source: DfrRecoverySource,
  phase: 'reservation' | 'finalization',
) => {
  const maps = await selectRows<DfrRecoverySource['map']>(
    trx
      .select({
        testRunMapId: testRunMap.testRunMapId,
        projectId: testRunMap.projectId,
        runId: testRunMap.runId,
        testId: testRunMap.testId,
        isIncluded: testRunMap.isIncluded,
        currentResultRevisionId: testRunMap.currentResultRevisionId,
      })
      .from(testRunMap)
      .where(
        and(
          eq(testRunMap.testRunMapId, source.manifest.testRunMapId),
          eq(testRunMap.projectId, source.manifest.projectId),
          eq(testRunMap.runId, source.manifest.runId),
          eq(testRunMap.testId, source.manifest.testId),
          eq(testRunMap.isIncluded, source.manifest.isIncluded),
          eq(testRunMap.currentResultRevisionId, source.manifest.currentResultRevisionId),
        ),
      )
      .limit(2)
      .for('update'),
  )
  if (
    maps.length !== 1 ||
    canonicalJson(maps[0]) !== canonicalJson(source.map) ||
    maps[0].isIncluded !== source.manifest.isIncluded ||
    maps[0].currentResultRevisionId !== source.manifest.currentResultRevisionId
  ) {
    throw new Error(`${phase} map identity fence failed for map ${source.manifest.testRunMapId}`)
  }
}

const lockAndValidateCurrentSource = async (
  trx: TransactionLike,
  source: DfrRecoverySource,
  leaseToken: string,
  now: Date,
): Promise<DfrRecoverySource['evidence']> => {
  await lockAndValidateMap(trx, source, 'finalization')
  const cycles = await selectRows<DfrRecoverySource['cycle']>(
    trx
      .select({
        state: defectCycles.state,
        activeMarker: defectCycles.activeMarker,
        openingRevisionId: defectCycles.openingRevisionId,
        currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
        provider: defectCycles.provider,
        providerWorkspaceId: defectCycles.providerWorkspaceId,
        providerProjectId: defectCycles.providerProjectId,
        providerWorkItemId: defectCycles.providerWorkItemId,
        providerIntakeId: defectCycles.providerIntakeId,
        providerStateId: defectCycles.providerStateId,
        providerSequenceId: defectCycles.providerSequenceId,
        providerUrl: defectCycles.providerUrl,
        createCorrelationKey: defectCycles.createCorrelationKey,
      })
      .from(defectCycles)
      .where(
        and(
          eq(defectCycles.defectCycleId, source.manifest.defectCycleId),
          eq(defectCycles.testRunMapId, source.manifest.testRunMapId),
          eq(defectCycles.projectId, source.manifest.projectId),
          eq(defectCycles.runId, source.manifest.runId),
          eq(defectCycles.testId, source.manifest.testId),
        ),
      )
      .limit(2)
      .for('update'),
  )
  if (
    cycles.length !== 1 ||
    canonicalJson(cycles[0]) !== canonicalJson(source.cycle) ||
    cycles[0].activeMarker !== source.manifest.activeMarker ||
    cycles[0].openingRevisionId !== source.manifest.openingRevisionId ||
    cycles[0].currentEvidenceRevisionId !== source.manifest.currentEvidenceRevisionId
  ) {
    throw new Error(`finalization cycle identity fence failed for map ${source.manifest.testRunMapId}`)
  }
  const revisions = await selectRows<{
    resultRevisionId: number
    revisionNumber: number
    defectCycleId: number | null
  }>(
    trx
      .select({
        resultRevisionId: resultRevisions.resultRevisionId,
        revisionNumber: resultRevisions.revisionNumber,
        defectCycleId: resultRevisions.defectCycleId,
      })
      .from(resultRevisions)
      .where(
        and(
          eq(resultRevisions.resultRevisionId, source.manifest.resultRevisionId),
          eq(resultRevisions.testRunMapId, source.manifest.testRunMapId),
          eq(resultRevisions.projectId, source.manifest.projectId),
          eq(resultRevisions.runId, source.manifest.runId),
          eq(resultRevisions.testId, source.manifest.testId),
        ),
      )
      .limit(2)
      .for('update'),
  )
  if (
    revisions.length !== 1 ||
    revisions[0].revisionNumber !== source.manifest.revisionNumber ||
    revisions[0].defectCycleId !== source.manifest.defectCycleId
  ) {
    throw new Error(`finalization revision identity fence failed for map ${source.manifest.testRunMapId}`)
  }
  const outboxes = await selectRows<{
    eventType: string
    eventKey: string
    payload: Record<string, unknown>
    deliveryState: string
    leaseToken: string | null
    leaseExpiresOn: Date | null
    lastError: string | null
  }>(
    trx
      .select({
        eventType: resultOutbox.eventType,
        eventKey: resultOutbox.eventKey,
        payload: resultOutbox.payload,
        deliveryState: resultOutbox.deliveryState,
        leaseToken: resultOutbox.leaseToken,
        leaseExpiresOn: resultOutbox.leaseExpiresOn,
        lastError: resultOutbox.lastError,
      })
      .from(resultOutbox)
      .where(
        and(
          eq(resultOutbox.resultOutboxId, source.manifest.resultOutboxId),
          eq(resultOutbox.resultRevisionId, source.manifest.resultRevisionId),
          eq(resultOutbox.aggregateType, 'defect_cycle'),
          eq(resultOutbox.aggregateId, source.manifest.defectCycleId),
        ),
      )
      .limit(2)
      .for('update'),
  )
  if (
    outboxes.length !== 1 ||
    outboxes[0].eventType !== source.manifest.outboxEventType ||
    outboxes[0].eventKey !== source.manifest.outboxEventKey ||
    canonicalJson(outboxes[0].payload) !== canonicalJson(source.payload) ||
    outboxes[0].deliveryState !== 'leased' ||
    outboxes[0].leaseToken !== leaseToken ||
    outboxes[0].leaseExpiresOn === null ||
    outboxes[0].leaseExpiresOn <= now ||
    typeof outboxes[0].lastError !== 'string' ||
    !outboxes[0].lastError.startsWith('TVP599 DFR recovery reserved:')
  ) {
    throw new Error(`finalization outbox identity fence failed for map ${source.manifest.testRunMapId}`)
  }
  const evidence = await selectRows<DfrRecoverySource['evidence'][number]>(
    trx
      .select({
        planeEvidenceDeliveryId: planeEvidenceDeliveries.planeEvidenceDeliveryId,
        resultRevisionId: planeEvidenceDeliveries.resultRevisionId,
        sourceIdentity: planeEvidenceDeliveries.sourceIdentity,
        provider: planeEvidenceDeliveries.provider,
        providerWorkspaceId: planeEvidenceDeliveries.providerWorkspaceId,
        providerProjectId: planeEvidenceDeliveries.providerProjectId,
        providerWorkItemId: planeEvidenceDeliveries.providerWorkItemId,
        providerCommentId: planeEvidenceDeliveries.providerCommentId,
        providerAssetId: planeEvidenceDeliveries.providerAssetId,
        providerAttachmentId: planeEvidenceDeliveries.providerAttachmentId,
        deliveryState: planeEvidenceDeliveries.deliveryState,
        leaseToken: planeEvidenceDeliveries.leaseToken,
        leaseExpiresOn: planeEvidenceDeliveries.leaseExpiresOn,
        lastError: planeEvidenceDeliveries.lastError,
        deliveredOn: planeEvidenceDeliveries.deliveredOn,
      })
      .from(planeEvidenceDeliveries)
      .where(eq(planeEvidenceDeliveries.defectCycleId, source.manifest.defectCycleId))
      .orderBy(planeEvidenceDeliveries.planeEvidenceDeliveryId)
      .for('update'),
  )
  validateEvidenceSnapshot({...source, evidence}, false)
  return evidence
}

const sourceSnapshot = (
  manifest: DfrRecoveryManifestRecord,
  map: DfrRecoverySource['map'],
  revisionNumber: number,
  cycle: DfrRecoverySource['cycle'],
  outbox: DfrRecoverySource['outbox'],
  payload: Record<string, unknown>,
  evidence: DfrRecoverySource['evidence'],
  immutableSourcePayload: Record<string, unknown> | null,
): DfrRecoverySource => ({
  manifest,
  payload,
  immutableSourcePayload,
  map,
  revisionNumber,
  cycle,
  outbox,
  evidence,
  terminal: exactTerminalSource({
    manifest,
    payload,
    immutableSourcePayload,
    map,
    revisionNumber,
    cycle,
    outbox,
    evidence,
    terminal: false,
  }),
})

/** ORM/Drizzle implementation used by the CLI; no raw SQL is used here. */
export const createDfrRecoveryDatabase = (
  database: DfrDrizzleDatabase,
): DfrRecoveryDatabase => ({
  async inspectExactTargets(manifest) {
    const sources: DfrRecoverySource[] = []
    for (const record of manifest.records) {
      const maps = await selectRows<DfrRecoverySource['map']>(
        database
          .select({
            testRunMapId: testRunMap.testRunMapId,
            projectId: testRunMap.projectId,
            runId: testRunMap.runId,
            testId: testRunMap.testId,
            isIncluded: testRunMap.isIncluded,
            currentResultRevisionId: testRunMap.currentResultRevisionId,
          })
          .from(testRunMap)
          .where(
            and(
              eq(testRunMap.testRunMapId, record.testRunMapId),
              eq(testRunMap.projectId, record.projectId),
              eq(testRunMap.runId, record.runId),
              eq(testRunMap.testId, record.testId),
            ),
          )
          .limit(2),
      )
      const cycles = await selectRows<DfrRecoverySource['cycle']>(
        database
          .select({
            state: defectCycles.state,
            activeMarker: defectCycles.activeMarker,
            openingRevisionId: defectCycles.openingRevisionId,
            currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
            provider: defectCycles.provider,
            providerWorkspaceId: defectCycles.providerWorkspaceId,
            providerProjectId: defectCycles.providerProjectId,
            providerWorkItemId: defectCycles.providerWorkItemId,
            providerIntakeId: defectCycles.providerIntakeId,
            providerStateId: defectCycles.providerStateId,
            providerSequenceId: defectCycles.providerSequenceId,
            providerUrl: defectCycles.providerUrl,
            createCorrelationKey: defectCycles.createCorrelationKey,
          })
          .from(defectCycles)
          .where(
            and(
              eq(defectCycles.defectCycleId, record.defectCycleId),
              eq(defectCycles.testRunMapId, record.testRunMapId),
              eq(defectCycles.projectId, record.projectId),
              eq(defectCycles.runId, record.runId),
              eq(defectCycles.testId, record.testId),
            ),
          )
          .limit(2),
      )
      const revisions = await selectRows<{
        resultRevisionId: number
        revisionNumber: number
        defectCycleId: number | null
      }>(
        database
          .select({
            resultRevisionId: resultRevisions.resultRevisionId,
            revisionNumber: resultRevisions.revisionNumber,
            defectCycleId: resultRevisions.defectCycleId,
          })
          .from(resultRevisions)
          .where(
            and(
              eq(resultRevisions.resultRevisionId, record.resultRevisionId),
              eq(resultRevisions.testRunMapId, record.testRunMapId),
              eq(resultRevisions.projectId, record.projectId),
              eq(resultRevisions.runId, record.runId),
              eq(resultRevisions.testId, record.testId),
            ),
          )
          .limit(2),
      )
      const outboxes = await selectRows<{
        eventType: string
        eventKey: string
        payload: Record<string, unknown>
        deliveryState: string
        leaseToken: string | null
        leaseExpiresOn: Date | null
        deliveredOn: Date | null
        lastError: string | null
      }>(
        database
          .select({
            eventType: resultOutbox.eventType,
            eventKey: resultOutbox.eventKey,
            payload: resultOutbox.payload,
            deliveryState: resultOutbox.deliveryState,
            leaseToken: resultOutbox.leaseToken,
            leaseExpiresOn: resultOutbox.leaseExpiresOn,
            deliveredOn: resultOutbox.deliveredOn,
            lastError: resultOutbox.lastError,
          })
          .from(resultOutbox)
          .where(
            and(
              eq(resultOutbox.resultOutboxId, record.resultOutboxId),
              eq(resultOutbox.resultRevisionId, record.resultRevisionId),
              eq(resultOutbox.aggregateType, 'defect_cycle'),
              eq(resultOutbox.aggregateId, record.defectCycleId),
            ),
          )
          .limit(2),
      )
      const evidence = await selectRows<DfrRecoverySource['evidence'][number]>(
        database
          .select({
            planeEvidenceDeliveryId: planeEvidenceDeliveries.planeEvidenceDeliveryId,
            resultRevisionId: planeEvidenceDeliveries.resultRevisionId,
            sourceIdentity: planeEvidenceDeliveries.sourceIdentity,
            provider: planeEvidenceDeliveries.provider,
            providerWorkspaceId: planeEvidenceDeliveries.providerWorkspaceId,
            providerProjectId: planeEvidenceDeliveries.providerProjectId,
            providerWorkItemId: planeEvidenceDeliveries.providerWorkItemId,
            providerCommentId: planeEvidenceDeliveries.providerCommentId,
        providerAssetId: planeEvidenceDeliveries.providerAssetId,
        providerAttachmentId: planeEvidenceDeliveries.providerAttachmentId,
        deliveryState: planeEvidenceDeliveries.deliveryState,
        leaseToken: planeEvidenceDeliveries.leaseToken,
        leaseExpiresOn: planeEvidenceDeliveries.leaseExpiresOn,
        lastError: planeEvidenceDeliveries.lastError,
        deliveredOn: planeEvidenceDeliveries.deliveredOn,
          })
          .from(planeEvidenceDeliveries)
          .where(eq(planeEvidenceDeliveries.defectCycleId, record.defectCycleId)),
      )
      if (maps.length !== 1 || cycles.length !== 1 || revisions.length !== 1 || outboxes.length !== 1) {
        throw new Error(`ORM exact cardinality failed for map ${record.testRunMapId}`)
      }
      if (
        maps[0].testRunMapId !== record.testRunMapId ||
        maps[0].projectId !== record.projectId ||
        maps[0].runId !== record.runId ||
        maps[0].testId !== record.testId ||
        maps[0].isIncluded !== record.isIncluded ||
        maps[0].currentResultRevisionId !== record.currentResultRevisionId
      ) {
        throw new Error(`ORM map identity mismatch for map ${record.testRunMapId}`)
      }
      if (revisions[0].revisionNumber !== record.revisionNumber) {
        throw new Error(`ORM revision number mismatch for map ${record.testRunMapId}`)
      }
      if (
        revisions[0].defectCycleId !== record.defectCycleId ||
        cycles[0].activeMarker !== record.activeMarker ||
        cycles[0].openingRevisionId !== record.openingRevisionId ||
        cycles[0].currentEvidenceRevisionId !== record.currentEvidenceRevisionId ||
        outboxes[0].eventType !== record.outboxEventType ||
        outboxes[0].eventKey !== record.outboxEventKey
      ) {
        throw new Error(`ORM active/revision/outbox identity mismatch for map ${record.testRunMapId}`)
      }
      const reconciliations = await selectRows<{expectedSnapshot: unknown}>(
        database
          .select({expectedSnapshot: integrationReconciliations.expectedSnapshot})
          .from(integrationReconciliations)
          .where(
            and(
              eq(integrationReconciliations.findingKey, `${manifest.recoveryId}:${record.testRunMapId}`),
              eq(integrationReconciliations.findingType, 'tvp599_dfr_recovery'),
            ),
          )
          .limit(2),
      )
      const expectedSnapshot = reconciliations[0]?.expectedSnapshot
      const immutableSourcePayload =
        isRecord(expectedSnapshot) && isRecord(expectedSnapshot.sourcePayload)
          ? (expectedSnapshot.sourcePayload as Record<string, unknown>)
          : null
      sources.push(
        sourceSnapshot(
          record,
          maps[0],
          revisions[0].revisionNumber,
          cycles[0],
          outboxes[0],
          outboxes[0].payload,
          evidence,
          immutableSourcePayload,
        ),
      )
    }
    return sources
  },
  async reserveTargets({recoveryId, records, leaseToken, now, leaseExpiresOn}) {
    await database.transaction(async (trx) => {
      for (const source of [...records].sort((left, right) => left.manifest.testRunMapId - right.manifest.testRunMapId)) {
        await lockAndValidateMap(trx, source, 'reservation')
        const cycles = await selectRows<DfrRecoverySource['cycle']>(
          trx
            .select({
              state: defectCycles.state,
              activeMarker: defectCycles.activeMarker,
              openingRevisionId: defectCycles.openingRevisionId,
              currentEvidenceRevisionId: defectCycles.currentEvidenceRevisionId,
              provider: defectCycles.provider,
              providerWorkspaceId: defectCycles.providerWorkspaceId,
              providerProjectId: defectCycles.providerProjectId,
              providerWorkItemId: defectCycles.providerWorkItemId,
              providerIntakeId: defectCycles.providerIntakeId,
              providerStateId: defectCycles.providerStateId,
              providerSequenceId: defectCycles.providerSequenceId,
              providerUrl: defectCycles.providerUrl,
              createCorrelationKey: defectCycles.createCorrelationKey,
            })
            .from(defectCycles)
            .where(
              and(
                eq(defectCycles.defectCycleId, source.manifest.defectCycleId),
                eq(defectCycles.testRunMapId, source.manifest.testRunMapId),
                eq(defectCycles.projectId, source.manifest.projectId),
                eq(defectCycles.runId, source.manifest.runId),
                eq(defectCycles.testId, source.manifest.testId),
              ),
            )
            .limit(2)
            .for('update'),
        )
        if (
          cycles.length !== 1 ||
          canonicalJson(cycles[0]) !== canonicalJson(source.cycle) ||
          cycles[0].activeMarker !== source.manifest.activeMarker ||
          cycles[0].openingRevisionId !== source.manifest.openingRevisionId ||
          cycles[0].currentEvidenceRevisionId !== source.manifest.currentEvidenceRevisionId
        ) {
          throw new Error(`reservation cycle identity fence failed for map ${source.manifest.testRunMapId}`)
        }
        const revisions = await selectRows<{resultRevisionId: number; revisionNumber: number; defectCycleId: number | null}>(
          trx
            .select({
              resultRevisionId: resultRevisions.resultRevisionId,
              revisionNumber: resultRevisions.revisionNumber,
              defectCycleId: resultRevisions.defectCycleId,
            })
            .from(resultRevisions)
            .where(
              and(
                eq(resultRevisions.resultRevisionId, source.manifest.resultRevisionId),
                eq(resultRevisions.testRunMapId, source.manifest.testRunMapId),
                eq(resultRevisions.projectId, source.manifest.projectId),
                eq(resultRevisions.runId, source.manifest.runId),
                eq(resultRevisions.testId, source.manifest.testId),
              ),
            )
            .limit(2)
            .for('update'),
        )
        if (
          revisions.length !== 1 ||
          revisions[0].revisionNumber !== source.manifest.revisionNumber ||
          revisions[0].defectCycleId !== source.manifest.defectCycleId
        ) {
          throw new Error(`reservation revision identity fence failed for map ${source.manifest.testRunMapId}`)
        }
        const outboxes = await selectRows<{
          eventType: string
          eventKey: string
          payload: Record<string, unknown>
          deliveryState: string
          leaseToken: string | null
          leaseExpiresOn: Date | null
          deliveredOn: Date | null
          lastError: string | null
        }>(
          trx
            .select({
              eventType: resultOutbox.eventType,
              eventKey: resultOutbox.eventKey,
              payload: resultOutbox.payload,
              deliveryState: resultOutbox.deliveryState,
              leaseToken: resultOutbox.leaseToken,
              leaseExpiresOn: resultOutbox.leaseExpiresOn,
              deliveredOn: resultOutbox.deliveredOn,
              lastError: resultOutbox.lastError,
            })
            .from(resultOutbox)
            .where(
              and(
                eq(resultOutbox.resultOutboxId, source.manifest.resultOutboxId),
                eq(resultOutbox.resultRevisionId, source.manifest.resultRevisionId),
                eq(resultOutbox.aggregateType, 'defect_cycle'),
                eq(resultOutbox.aggregateId, source.manifest.defectCycleId),
              ),
            )
            .limit(2)
            .for('update'),
        )
        if (
          outboxes.length !== 1 ||
          outboxes[0].eventType !== source.manifest.outboxEventType ||
          outboxes[0].eventKey !== source.manifest.outboxEventKey ||
          canonicalJson(outboxes[0].payload) !== canonicalJson(source.payload) ||
          outboxes[0].deliveryState !== 'delivered' ||
          outboxes[0].leaseToken !== null ||
          outboxes[0].leaseExpiresOn !== null ||
          outboxes[0].deliveredOn === null ||
          outboxes[0].lastError !== source.outbox.lastError
        ) {
          throw new Error(`reservation fence changed for map ${source.manifest.testRunMapId}`)
        }
        const evidence = await selectRows<DfrRecoverySource['evidence'][number]>(
          trx
            .select({
              planeEvidenceDeliveryId: planeEvidenceDeliveries.planeEvidenceDeliveryId,
              resultRevisionId: planeEvidenceDeliveries.resultRevisionId,
              sourceIdentity: planeEvidenceDeliveries.sourceIdentity,
              provider: planeEvidenceDeliveries.provider,
              providerWorkspaceId: planeEvidenceDeliveries.providerWorkspaceId,
              providerProjectId: planeEvidenceDeliveries.providerProjectId,
              providerWorkItemId: planeEvidenceDeliveries.providerWorkItemId,
              providerCommentId: planeEvidenceDeliveries.providerCommentId,
              providerAssetId: planeEvidenceDeliveries.providerAssetId,
              providerAttachmentId: planeEvidenceDeliveries.providerAttachmentId,
              deliveryState: planeEvidenceDeliveries.deliveryState,
              leaseToken: planeEvidenceDeliveries.leaseToken,
              leaseExpiresOn: planeEvidenceDeliveries.leaseExpiresOn,
              lastError: planeEvidenceDeliveries.lastError,
              deliveredOn: planeEvidenceDeliveries.deliveredOn,
            })
            .from(planeEvidenceDeliveries)
            .where(eq(planeEvidenceDeliveries.defectCycleId, source.manifest.defectCycleId))
            .orderBy(planeEvidenceDeliveries.planeEvidenceDeliveryId)
            .for('update'),
        )
        validateEvidenceSnapshot({...source, evidence}, false)
        const updates = await trx
          .update(resultOutbox)
          .set({deliveryState: 'leased', leaseToken, leaseExpiresOn, lastError: `TVP599 DFR recovery reserved: ${recoveryId}`})
          .where(
            and(
              eq(resultOutbox.resultOutboxId, source.manifest.resultOutboxId),
              eq(resultOutbox.resultRevisionId, source.manifest.resultRevisionId),
              eq(resultOutbox.aggregateType, 'defect_cycle'),
              eq(resultOutbox.aggregateId, source.manifest.defectCycleId),
              eq(resultOutbox.eventType, source.manifest.outboxEventType),
              eq(resultOutbox.eventKey, source.manifest.outboxEventKey),
              isNull(resultOutbox.leaseToken),
              eq(resultOutbox.deliveryState, 'delivered'),
              source.outbox.lastError === null
                ? isNull(resultOutbox.lastError)
                : eq(resultOutbox.lastError, source.outbox.lastError),
              source.outbox.deliveredOn === null
                ? isNull(resultOutbox.deliveredOn)
                : eq(resultOutbox.deliveredOn, source.outbox.deliveredOn),
            ),
          )
        if (updates[0]?.affectedRows !== 1) throw new Error(`reservation affected-row fence failed for map ${source.manifest.testRunMapId}`)
        await trx
          .insert(integrationReconciliations)
          .values({
            findingKey: `${recoveryId}:${source.manifest.testRunMapId}`,
            findingType: 'tvp599_dfr_recovery',
            aggregateType: 'defect_cycle',
            aggregateId: source.manifest.defectCycleId,
            severity: 'critical',
            state: 'open',
            expectedSnapshot: {
              recoveryId,
              manifest: source.manifest,
              sourcePayload: source.immutableSourcePayload ?? source.payload,
            },
            actualSnapshot: {state: 'reserved', at: now.toISOString()},
          })
          .onDuplicateKeyUpdate({set: {state: 'open', actualSnapshot: {state: 'reserved', at: now.toISOString()}}})
          .execute()
      }
    })
  },
  async finalizeTargets({recoveryId, records, replacements, leaseToken, now}) {
    await database.transaction(async (trx) => {
      for (const replacement of replacements.sort((left, right) => left.record.testRunMapId - right.record.testRunMapId)) {
        const source = records.find((candidate) => candidate.manifest.testRunMapId === replacement.record.testRunMapId)
        if (!source) throw new Error(`finalization source missing for map ${replacement.record.testRunMapId}`)
        const currentEvidence = await lockAndValidateCurrentSource(trx, source, leaseToken, now)
        const outboxUpdate = await trx
          .update(resultOutbox)
          .set({
            payload: rewriteDfrProviderRoute(source.payload),
            deliveryState: 'delivered',
            leaseToken: null,
            leaseExpiresOn: null,
            deliveredOn: now,
            lastError: null,
          })
          .where(
            and(
              eq(resultOutbox.resultOutboxId, source.manifest.resultOutboxId),
              eq(resultOutbox.resultRevisionId, source.manifest.resultRevisionId),
              eq(resultOutbox.aggregateType, 'defect_cycle'),
              eq(resultOutbox.aggregateId, source.manifest.defectCycleId),
              eq(resultOutbox.eventType, source.manifest.outboxEventType),
              eq(resultOutbox.eventKey, source.manifest.outboxEventKey),
              eq(resultOutbox.deliveryState, 'leased'),
              eq(resultOutbox.leaseToken, leaseToken),
            ),
          )
        if (outboxUpdate[0]?.affectedRows !== 1) throw new Error(`finalization outbox affected-row fence failed for map ${replacement.record.testRunMapId}`)
        const cycleUpdate = await trx
          .update(defectCycles)
          .set({
            state: 'work_item_open',
            provider: 'plane',
            providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
            providerProjectId: TVP599_DFR_ROUTE.projectId,
            providerWorkItemId: replacement.workItemId,
            providerIntakeId: replacement.intakeId,
            providerSequenceId: replacement.sequenceId,
            providerStateId: replacement.stateId,
            providerUrl: `${PLANE_DESTINATIONS['dfr-development'].publicBaseUrl}/infinimind/browse/DFR-${replacement.sequenceId}/`,
            lastProviderObservedOn: now,
          })
          .where(
            and(
              eq(defectCycles.defectCycleId, source.manifest.defectCycleId),
              eq(defectCycles.testRunMapId, source.manifest.testRunMapId),
              eq(defectCycles.projectId, source.manifest.projectId),
              eq(defectCycles.runId, source.manifest.runId),
              eq(defectCycles.testId, source.manifest.testId),
              eq(defectCycles.activeMarker, source.manifest.activeMarker),
              eq(defectCycles.openingRevisionId, source.manifest.openingRevisionId),
              eq(defectCycles.currentEvidenceRevisionId, source.manifest.currentEvidenceRevisionId),
              eq(defectCycles.createCorrelationKey, source.manifest.correlationKey),
              eq(defectCycles.state, source.manifest.sourceState as 'manual_attention' | 'intake_open'),
            ),
          )
        if (cycleUpdate[0]?.affectedRows !== 1) throw new Error(`finalization cycle affected-row fence failed for map ${replacement.record.testRunMapId}`)
        const relinkedEvidenceIds: number[] = []
        for (const entry of source.manifest.evidence.filter((candidate) => candidate.action === 'relink')) {
          const row = currentEvidence.find((candidate) => candidate.planeEvidenceDeliveryId === entry.planeEvidenceDeliveryId)
          if (!row || hasProviderArtifact(row)) {
            throw new Error(`finalization evidence identity fence failed for map ${replacement.record.testRunMapId}`)
          }
          const evidenceUpdate = await trx
            .update(planeEvidenceDeliveries)
            .set({
              provider: 'plane',
              providerWorkspaceId: TVP599_DFR_ROUTE.workspaceId,
              providerProjectId: TVP599_DFR_ROUTE.projectId,
              providerWorkItemId: replacement.workItemId,
            })
            .where(
              and(
                eq(planeEvidenceDeliveries.planeEvidenceDeliveryId, entry.planeEvidenceDeliveryId),
                eq(planeEvidenceDeliveries.defectCycleId, source.manifest.defectCycleId),
                eq(planeEvidenceDeliveries.resultRevisionId, entry.resultRevisionId),
                eq(planeEvidenceDeliveries.sourceIdentity, entry.sourceIdentity),
                eq(planeEvidenceDeliveries.provider, 'plane'),
                eq(planeEvidenceDeliveries.providerWorkspaceId, TVP599_BIZ_ROUTE.workspaceId),
                eq(planeEvidenceDeliveries.providerProjectId, TVP599_BIZ_ROUTE.projectId),
                isNull(planeEvidenceDeliveries.providerWorkItemId),
                isNull(planeEvidenceDeliveries.providerCommentId),
                isNull(planeEvidenceDeliveries.providerAssetId),
                isNull(planeEvidenceDeliveries.providerAttachmentId),
                eq(planeEvidenceDeliveries.deliveryState, 'pending'),
                isNull(planeEvidenceDeliveries.leaseToken),
                isNull(planeEvidenceDeliveries.leaseExpiresOn),
                isNull(planeEvidenceDeliveries.deliveredOn),
              ),
            )
          if (evidenceUpdate[0]?.affectedRows !== 1) {
            throw new Error(`finalization evidence affected-row fence failed for map ${replacement.record.testRunMapId}`)
          }
          relinkedEvidenceIds.push(entry.planeEvidenceDeliveryId)
        }
        const preservedEvidenceIds = source.manifest.evidence
          .filter((entry) => entry.action === 'preserve')
          .map((entry) => entry.planeEvidenceDeliveryId)
        await trx
          .insert(integrationReconciliations)
          .values({findingKey: `${recoveryId}:${source.manifest.testRunMapId}`, findingType: 'tvp599_dfr_recovery', aggregateType: 'defect_cycle', aggregateId: source.manifest.defectCycleId, severity: 'critical', state: 'resolved', expectedSnapshot: {recoveryId, manifest: source.manifest, sourcePayload: source.immutableSourcePayload ?? source.payload}, actualSnapshot: {dfrWorkItemId: replacement.workItemId, dfrIntakeId: replacement.intakeId, dfrSequenceId: replacement.sequenceId, preservedEvidenceIds, relinkedEvidenceIds, preservedEvidenceCount: preservedEvidenceIds.length, relinkedEvidenceCount: relinkedEvidenceIds.length}, resolvedOn: now, resolutionNote: 'TVP-599 DFR recovery finalized'})
          .onDuplicateKeyUpdate({set: {state: 'resolved', expectedSnapshot: {recoveryId, manifest: source.manifest, sourcePayload: source.immutableSourcePayload ?? source.payload}, actualSnapshot: {dfrWorkItemId: replacement.workItemId, dfrIntakeId: replacement.intakeId, dfrSequenceId: replacement.sequenceId, preservedEvidenceIds, relinkedEvidenceIds, preservedEvidenceCount: preservedEvidenceIds.length, relinkedEvidenceCount: relinkedEvidenceIds.length}, resolvedOn: now, resolutionNote: 'TVP-599 DFR recovery finalized'}})
          .execute()
      }
    })
  },
  async markManualAttention({recoveryId, records, reason, leaseToken, leaseExpiresOn}) {
    const sanitizedReason = sanitizePlaneError(reason)
    if (leaseToken && !leaseExpiresOn) {
      throw new Error('manual attention reservation lease expiry was missing')
    }
    await database.transaction(async (trx) => {
      for (const source of records) {
        const expectedState = leaseToken ? 'leased' : source.outbox.deliveryState
        const expectedLeaseExpiresOn = leaseToken ? leaseExpiresOn : source.outbox.leaseExpiresOn
        const expectedLastError = leaseToken
          ? `TVP599 DFR recovery reserved: ${recoveryId}`
          : source.outbox.lastError
        const outboxUpdate = await trx
          .update(resultOutbox)
          .set({deliveryState: 'manual_attention', leaseToken: null, leaseExpiresOn: null, lastError: `TVP599 DFR recovery manual_attention: ${sanitizedReason}`})
          .where(and(
            eq(resultOutbox.resultOutboxId, source.manifest.resultOutboxId),
            eq(resultOutbox.resultRevisionId, source.manifest.resultRevisionId),
            eq(resultOutbox.aggregateType, 'defect_cycle'),
            eq(resultOutbox.aggregateId, source.manifest.defectCycleId),
            eq(resultOutbox.eventType, source.manifest.outboxEventType),
            eq(resultOutbox.eventKey, source.manifest.outboxEventKey),
            eq(resultOutbox.payload, source.payload as ResultRevisionCommittedPayload),
            eq(resultOutbox.deliveryState, expectedState as 'delivered' | 'leased'),
            leaseToken ? eq(resultOutbox.leaseToken, leaseToken) : isNull(resultOutbox.leaseToken),
            expectedLeaseExpiresOn === null || expectedLeaseExpiresOn === undefined
              ? isNull(resultOutbox.leaseExpiresOn)
              : eq(resultOutbox.leaseExpiresOn, expectedLeaseExpiresOn),
            expectedLastError === null
              ? isNull(resultOutbox.lastError)
              : eq(resultOutbox.lastError, expectedLastError),
            source.outbox.deliveredOn === null
              ? isNull(resultOutbox.deliveredOn)
              : eq(resultOutbox.deliveredOn, source.outbox.deliveredOn),
          ))
        if (outboxUpdate[0]?.affectedRows !== 1) throw new Error(`manual attention affected-row fence failed for map ${source.manifest.testRunMapId}`)
        await trx
          .insert(integrationReconciliations)
          .values({findingKey: `${recoveryId}:${source.manifest.testRunMapId}`, findingType: 'tvp599_dfr_recovery', aggregateType: 'defect_cycle', aggregateId: source.manifest.defectCycleId, severity: 'critical', state: 'manual_attention', expectedSnapshot: {recoveryId, manifest: source.manifest}, actualSnapshot: {reason: sanitizedReason}, resolutionNote: sanitizedReason})
          .onDuplicateKeyUpdate({set: {state: 'manual_attention', actualSnapshot: {reason: sanitizedReason}, resolutionNote: sanitizedReason}})
          .execute()
      }
    })
  },
})
