import {sql} from 'drizzle-orm'
import {
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'
import {organisations} from './organisations'
import {projects} from './projects'
import {runs, testRunMap} from './runs'
import {tests} from './tests'
import {users} from './users'

export type ResultCommandOutcome = {
  resultCommandId: string
  resultRevisionId: number
  revisionNumber: number
  testRunMapId: number
  orgId: number
  projectId: number
  runId: number
  testId: number
  status: string
  comment: string | null
  attachmentKeys: string[]
}

export type ResultRevisionCommittedPayload = {
  resultCommandId: string
  resultRevisionId: number
  revisionNumber: number
  testRunMapId: number
  orgId: number
  projectId: number
  runId: number
  testId: number
  status: string
  actorUserId: number
  actorType: 'human'
  sourceSystem: 'checkmate'
}

export type IntegrationEventPayload = Record<string, unknown>
export type ResultNotificationPayload = Record<string, unknown>
export type ReconciliationSnapshot = Record<string, unknown>

export const resultRevisions = mysqlTable(
  'resultRevisions',
  {
    resultRevisionId: int('resultRevisionId').primaryKey().autoincrement(),
    testRunMapId: int('testRunMapId').notNull(),
    revisionNumber: int('revisionNumber').notNull(),
    resultCommandId: varchar('resultCommandId', {length: 36}).notNull(),
    orgId: int('orgId').notNull(),
    projectId: int('projectId').notNull(),
    runId: int('runId').notNull(),
    testId: int('testId').notNull(),
    status: varchar('status', {length: 25}).notNull(),
    comment: text('comment'),
    actorUserId: int('actorUserId').notNull(),
    actorType: mysqlEnum('actorType', ['human', 'system']).notNull(),
    sourceSystem: varchar('sourceSystem', {length: 32}).notNull(),
    sourceEventId: varchar('sourceEventId', {length: 128}).notNull(),
    defectCycleId: int('defectCycleId'),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (revision) => ({
    resultRevisionMapFk: foreignKey({
      columns: [revision.testRunMapId],
      foreignColumns: [testRunMap.testRunMapId],
      name: 'resultRevisionMapFk',
    }),
    resultRevisionOrgFk: foreignKey({
      columns: [revision.orgId],
      foreignColumns: [organisations.orgId],
      name: 'resultRevisionOrgFk',
    }),
    resultRevisionProjectFk: foreignKey({
      columns: [revision.projectId],
      foreignColumns: [projects.projectId],
      name: 'resultRevisionProjectFk',
    }),
    resultRevisionRunFk: foreignKey({
      columns: [revision.runId],
      foreignColumns: [runs.runId],
      name: 'resultRevisionRunFk',
    }),
    resultRevisionTestFk: foreignKey({
      columns: [revision.testId],
      foreignColumns: [tests.testId],
      name: 'resultRevisionTestFk',
    }),
    resultRevisionActorFk: foreignKey({
      columns: [revision.actorUserId],
      foreignColumns: [users.userId],
      name: 'resultRevisionActorFk',
    }),
    resultRevisionNumberUnique: unique('resultRevisionNumberUnique').on(
      revision.testRunMapId,
      revision.revisionNumber,
    ),
    resultRevisionCommandUnique: unique('resultRevisionCommandUnique').on(
      revision.testRunMapId,
      revision.resultCommandId,
    ),
    resultRevisionRunIndex: index('resultRevisionRunIndex').on(
      revision.runId,
      revision.testRunMapId,
    ),
  }),
)

export const resultAttachmentObjects = mysqlTable(
  'resultAttachmentObjects',
  {
    resultAttachmentObjectId: int('resultAttachmentObjectId')
      .primaryKey()
      .autoincrement(),
    objectKey: varchar('objectKey', {length: 500}).notNull(),
    testRunMapId: int('testRunMapId').notNull(),
    orgId: int('orgId').notNull(),
    projectId: int('projectId').notNull(),
    runId: int('runId').notNull(),
    testId: int('testId').notNull(),
    uploaderUserId: int('uploaderUserId').notNull(),
    contentType: varchar('contentType', {length: 100}).notNull(),
    byteSize: int('byteSize').notNull(),
    sha256: varchar('sha256', {length: 64}).notNull(),
    lifecycleState: mysqlEnum('lifecycleState', [
      'pending_upload',
      'uploaded',
      'committed',
      'delete_pending',
      'deleted',
      'failed',
    ])
      .default('pending_upload')
      .notNull(),
    retentionPolicy: varchar('retentionPolicy', {length: 32})
      .default('source_owned')
      .notNull(),
    lastError: text('lastError'),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    uploadedOn: timestamp('uploadedOn'),
    deletedOn: timestamp('deletedOn'),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
  },
  (attachment) => ({
    resultAttachmentObjectKeyUnique: unique(
      'resultAttachmentObjectKeyUnique',
    ).on(attachment.objectKey),
    resultAttachmentObjectMapFk: foreignKey({
      columns: [attachment.testRunMapId],
      foreignColumns: [testRunMap.testRunMapId],
      name: 'resultAttachmentObjectMapFk',
    }),
    resultAttachmentObjectOrgFk: foreignKey({
      columns: [attachment.orgId],
      foreignColumns: [organisations.orgId],
      name: 'resultAttachmentObjectOrgFk',
    }),
    resultAttachmentObjectProjectFk: foreignKey({
      columns: [attachment.projectId],
      foreignColumns: [projects.projectId],
      name: 'resultAttachmentObjectProjectFk',
    }),
    resultAttachmentObjectRunFk: foreignKey({
      columns: [attachment.runId],
      foreignColumns: [runs.runId],
      name: 'resultAttachmentObjectRunFk',
    }),
    resultAttachmentObjectTestFk: foreignKey({
      columns: [attachment.testId],
      foreignColumns: [tests.testId],
      name: 'resultAttachmentObjectTestFk',
    }),
    resultAttachmentObjectUploaderFk: foreignKey({
      columns: [attachment.uploaderUserId],
      foreignColumns: [users.userId],
      name: 'resultAttachmentObjectUploaderFk',
    }),
    resultAttachmentObjectScopeIndex: index(
      'resultAttachmentObjectScopeIndex',
    ).on(
      attachment.testRunMapId,
      attachment.lifecycleState,
      attachment.createdOn,
    ),
  }),
)

export const resultRevisionAttachments = mysqlTable(
  'resultRevisionAttachments',
  {
    resultRevisionAttachmentId: int('resultRevisionAttachmentId')
      .primaryKey()
      .autoincrement(),
    resultRevisionId: int('resultRevisionId').notNull(),
    resultAttachmentObjectId: int('resultAttachmentObjectId'),
    objectKey: varchar('objectKey', {length: 500}).notNull(),
    lifecycleState: mysqlEnum('lifecycleState', ['active', 'deleted'])
      .default('active')
      .notNull(),
    retentionPolicy: varchar('retentionPolicy', {length: 32})
      .default('source_owned')
      .notNull(),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    deletedOn: timestamp('deletedOn'),
  },
  (attachment) => ({
    resultRevisionAttachmentRevisionFk: foreignKey({
      columns: [attachment.resultRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'resultRevisionAttachmentRevisionFk',
    }),
    resultRevisionAttachmentObjectFk: foreignKey({
      columns: [attachment.resultAttachmentObjectId],
      foreignColumns: [resultAttachmentObjects.resultAttachmentObjectId],
      name: 'resultRevisionAttachmentObjectFk',
    }),
    resultRevisionAttachmentUnique: unique('resultRevisionAttachmentUnique').on(
      attachment.resultRevisionId,
      attachment.objectKey,
    ),
    resultRevisionAttachmentObjectIndex: index(
      'resultRevisionAttachmentObjectIndex',
    ).on(attachment.objectKey, attachment.lifecycleState),
    resultRevisionAttachmentObjectIdIndex: index(
      'resultRevisionAttachmentObjectIdIndex',
    ).on(attachment.resultAttachmentObjectId),
  }),
)

export const resultCommands = mysqlTable(
  'resultCommands',
  {
    resultCommandReceiptId: int('resultCommandReceiptId')
      .primaryKey()
      .autoincrement(),
    resultCommandId: varchar('resultCommandId', {length: 36}).notNull(),
    testRunMapId: int('testRunMapId').notNull(),
    requestFingerprint: varchar('requestFingerprint', {length: 64}).notNull(),
    resultRevisionId: int('resultRevisionId').notNull(),
    orgId: int('orgId').notNull(),
    projectId: int('projectId').notNull(),
    runId: int('runId').notNull(),
    testId: int('testId').notNull(),
    actorUserId: int('actorUserId').notNull(),
    outcome: json('outcome').$type<ResultCommandOutcome>().notNull(),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (command) => ({
    resultCommandMapFk: foreignKey({
      columns: [command.testRunMapId],
      foreignColumns: [testRunMap.testRunMapId],
      name: 'resultCommandMapFk',
    }),
    resultCommandRevisionFk: foreignKey({
      columns: [command.resultRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'resultCommandRevisionFk',
    }),
    resultCommandOrgFk: foreignKey({
      columns: [command.orgId],
      foreignColumns: [organisations.orgId],
      name: 'resultCommandOrgFk',
    }),
    resultCommandProjectFk: foreignKey({
      columns: [command.projectId],
      foreignColumns: [projects.projectId],
      name: 'resultCommandProjectFk',
    }),
    resultCommandRunFk: foreignKey({
      columns: [command.runId],
      foreignColumns: [runs.runId],
      name: 'resultCommandRunFk',
    }),
    resultCommandTestFk: foreignKey({
      columns: [command.testId],
      foreignColumns: [tests.testId],
      name: 'resultCommandTestFk',
    }),
    resultCommandActorFk: foreignKey({
      columns: [command.actorUserId],
      foreignColumns: [users.userId],
      name: 'resultCommandActorFk',
    }),
    resultCommandAggregateUnique: unique('resultCommandAggregateUnique').on(
      command.testRunMapId,
      command.resultCommandId,
    ),
    resultCommandRevisionUnique: unique('resultCommandRevisionUnique').on(
      command.resultRevisionId,
    ),
    resultCommandTenantIndex: index('resultCommandTenantIndex').on(
      command.orgId,
      command.projectId,
      command.createdOn,
    ),
  }),
)

export const resultOutbox = mysqlTable(
  'resultOutbox',
  {
    resultOutboxId: int('resultOutboxId').primaryKey().autoincrement(),
    eventKey: varchar('eventKey', {length: 128}).notNull().unique(),
    eventType: varchar('eventType', {length: 64}).notNull(),
    aggregateType: varchar('aggregateType', {length: 32}).notNull(),
    aggregateId: int('aggregateId').notNull(),
    resultRevisionId: int('resultRevisionId').notNull(),
    payload: json('payload').$type<ResultRevisionCommittedPayload>().notNull(),
    deliveryState: mysqlEnum('deliveryState', [
      'pending',
      'leased',
      'delivered',
      'retry_due',
      'failed',
      'manual_attention',
    ])
      .default('pending')
      .notNull(),
    availableOn: timestamp('availableOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    leaseToken: varchar('leaseToken', {length: 64}),
    leaseExpiresOn: timestamp('leaseExpiresOn'),
    attemptCount: int('attemptCount').default(0).notNull(),
    lastError: text('lastError'),
    deliveredOn: timestamp('deliveredOn'),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
  },
  (outbox) => ({
    resultOutboxRevisionFk: foreignKey({
      columns: [outbox.resultRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'resultOutboxRevisionFk',
    }),
    resultOutboxDeliveryIndex: index('resultOutboxDeliveryIndex').on(
      outbox.deliveryState,
      outbox.availableOn,
      outbox.leaseExpiresOn,
    ),
    resultOutboxAggregateIndex: index('resultOutboxAggregateIndex').on(
      outbox.aggregateType,
      outbox.aggregateId,
      outbox.createdOn,
    ),
  }),
)

export const defectCycles = mysqlTable(
  'defectCycles',
  {
    defectCycleId: int('defectCycleId').primaryKey().autoincrement(),
    testRunMapId: int('testRunMapId').notNull(),
    cycleNumber: int('cycleNumber').notNull(),
    activeMarker: int('activeMarker'),
    orgId: int('orgId').notNull(),
    projectId: int('projectId').notNull(),
    runId: int('runId').notNull(),
    testId: int('testId').notNull(),
    state: mysqlEnum('state', [
      'intake_pending',
      'intake_open',
      'work_item_open',
      'ready_for_retest',
      'validated',
      'resolved_before_sync',
      'intake_rejected',
      'canceled',
      'superseded',
      'orphaned',
      'manual_attention',
    ]).notNull(),
    openingRevisionId: int('openingRevisionId').notNull(),
    currentEvidenceRevisionId: int('currentEvidenceRevisionId').notNull(),
    readinessGeneration: int('readinessGeneration').default(0).notNull(),
    provider: varchar('provider', {length: 32}),
    providerWorkspaceId: varchar('providerWorkspaceId', {length: 64}),
    providerProjectId: varchar('providerProjectId', {length: 64}),
    providerWorkItemId: varchar('providerWorkItemId', {length: 64}),
    providerSequenceId: int('providerSequenceId'),
    providerUrl: varchar('providerUrl', {length: 500}),
    providerStateId: varchar('providerStateId', {length: 64}),
    lastProviderObservedOn: timestamp('lastProviderObservedOn'),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
    closedOn: timestamp('closedOn'),
  },
  (cycle) => ({
    defectCycleMapFk: foreignKey({
      columns: [cycle.testRunMapId],
      foreignColumns: [testRunMap.testRunMapId],
      name: 'defectCycleMapFk',
    }),
    defectCycleOrgFk: foreignKey({
      columns: [cycle.orgId],
      foreignColumns: [organisations.orgId],
      name: 'defectCycleOrgFk',
    }),
    defectCycleProjectFk: foreignKey({
      columns: [cycle.projectId],
      foreignColumns: [projects.projectId],
      name: 'defectCycleProjectFk',
    }),
    defectCycleRunFk: foreignKey({
      columns: [cycle.runId],
      foreignColumns: [runs.runId],
      name: 'defectCycleRunFk',
    }),
    defectCycleTestFk: foreignKey({
      columns: [cycle.testId],
      foreignColumns: [tests.testId],
      name: 'defectCycleTestFk',
    }),
    defectCycleOpeningRevisionFk: foreignKey({
      columns: [cycle.openingRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'defectCycleOpeningRevisionFk',
    }),
    defectCycleEvidenceRevisionFk: foreignKey({
      columns: [cycle.currentEvidenceRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'defectCycleEvidenceRevisionFk',
    }),
    defectCycleNumberUnique: unique('defectCycleNumberUnique').on(
      cycle.testRunMapId,
      cycle.cycleNumber,
    ),
    defectCycleActiveUnique: unique('defectCycleActiveUnique').on(
      cycle.testRunMapId,
      cycle.activeMarker,
    ),
    defectCycleProviderUnique: unique('defectCycleProviderUnique').on(
      cycle.provider,
      cycle.providerWorkspaceId,
      cycle.providerProjectId,
      cycle.providerWorkItemId,
    ),
    defectCycleStateIndex: index('defectCycleStateIndex').on(
      cycle.state,
      cycle.updatedOn,
    ),
  }),
)

export const integrationInbox = mysqlTable(
  'integrationInbox',
  {
    integrationInboxId: int('integrationInboxId').primaryKey().autoincrement(),
    provider: varchar('provider', {length: 32}).notNull(),
    providerDeliveryId: varchar('providerDeliveryId', {length: 128}).notNull(),
    eventType: varchar('eventType', {length: 64}).notNull(),
    eventFingerprint: varchar('eventFingerprint', {length: 64}).notNull(),
    payload: json('payload').$type<IntegrationEventPayload>().notNull(),
    signatureState: mysqlEnum('signatureState', [
      'verified',
      'rejected',
      'not_applicable',
    ]).notNull(),
    deliveryState: mysqlEnum('deliveryState', [
      'pending',
      'leased',
      'retry_due',
      'applied',
      'no_op',
      'rejected',
      'manual_attention',
    ])
      .default('pending')
      .notNull(),
    availableOn: timestamp('availableOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    leaseToken: varchar('leaseToken', {length: 64}),
    leaseExpiresOn: timestamp('leaseExpiresOn'),
    attemptCount: int('attemptCount').default(0).notNull(),
    lastError: text('lastError'),
    receivedOn: timestamp('receivedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    appliedOn: timestamp('appliedOn'),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
  },
  (inbox) => ({
    integrationInboxDeliveryUnique: unique('integrationInboxDeliveryUnique').on(
      inbox.provider,
      inbox.providerDeliveryId,
    ),
    integrationInboxDeliveryIndex: index('integrationInboxDeliveryIndex').on(
      inbox.deliveryState,
      inbox.availableOn,
      inbox.leaseExpiresOn,
    ),
  }),
)

export const integrationPollCursors = mysqlTable(
  'integrationPollCursors',
  {
    integrationPollCursorId: int('integrationPollCursorId')
      .primaryKey()
      .autoincrement(),
    provider: varchar('provider', {length: 32}).notNull(),
    destinationKey: varchar('destinationKey', {length: 128}).notNull(),
    cursorValue: varchar('cursorValue', {length: 500}),
    leaseToken: varchar('leaseToken', {length: 64}),
    leaseExpiresOn: timestamp('leaseExpiresOn'),
    lastPolledOn: timestamp('lastPolledOn'),
    lastError: text('lastError'),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
  },
  (cursor) => ({
    integrationPollCursorUnique: unique('integrationPollCursorUnique').on(
      cursor.provider,
      cursor.destinationKey,
    ),
    integrationPollCursorLeaseIndex: index(
      'integrationPollCursorLeaseIndex',
    ).on(cursor.leaseExpiresOn),
  }),
)

export const resultNotifications = mysqlTable(
  'resultNotifications',
  {
    resultNotificationId: int('resultNotificationId')
      .primaryKey()
      .autoincrement(),
    notificationKey: varchar('notificationKey', {length: 128})
      .notNull()
      .unique(),
    defectCycleId: int('defectCycleId'),
    resultRevisionId: int('resultRevisionId').notNull(),
    channel: varchar('channel', {length: 32}).notNull(),
    recipientKey: varchar('recipientKey', {length: 255}).notNull(),
    payload: json('payload').$type<ResultNotificationPayload>().notNull(),
    deliveryState: mysqlEnum('deliveryState', [
      'pending',
      'leased',
      'delivered',
      'retry_due',
      'manual_attention',
    ])
      .default('pending')
      .notNull(),
    leaseToken: varchar('leaseToken', {length: 64}),
    leaseExpiresOn: timestamp('leaseExpiresOn'),
    availableOn: timestamp('availableOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    attemptCount: int('attemptCount').default(0).notNull(),
    lastError: text('lastError'),
    providerMessageId: varchar('providerMessageId', {length: 255}),
    deliveredOn: timestamp('deliveredOn'),
    createdOn: timestamp('createdOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedOn: timestamp('updatedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .onUpdateNow(),
  },
  (notification) => ({
    resultNotificationCycleFk: foreignKey({
      columns: [notification.defectCycleId],
      foreignColumns: [defectCycles.defectCycleId],
      name: 'resultNotificationCycleFk',
    }),
    resultNotificationRevisionFk: foreignKey({
      columns: [notification.resultRevisionId],
      foreignColumns: [resultRevisions.resultRevisionId],
      name: 'resultNotificationRevisionFk',
    }),
    resultNotificationDeliveryIndex: index(
      'resultNotificationDeliveryIndex',
    ).on(
      notification.deliveryState,
      notification.availableOn,
      notification.leaseExpiresOn,
    ),
  }),
)

export const integrationReconciliations = mysqlTable(
  'integrationReconciliations',
  {
    integrationReconciliationId: int('integrationReconciliationId')
      .primaryKey()
      .autoincrement(),
    findingKey: varchar('findingKey', {length: 128}).notNull().unique(),
    findingType: varchar('findingType', {length: 64}).notNull(),
    aggregateType: varchar('aggregateType', {length: 32}).notNull(),
    aggregateId: int('aggregateId').notNull(),
    severity: mysqlEnum('severity', ['info', 'warning', 'critical']).notNull(),
    state: mysqlEnum('state', ['open', 'manual_attention', 'resolved'])
      .default('open')
      .notNull(),
    expectedSnapshot: json('expectedSnapshot')
      .$type<ReconciliationSnapshot>()
      .notNull(),
    actualSnapshot: json('actualSnapshot')
      .$type<ReconciliationSnapshot>()
      .notNull(),
    assignedUserId: int('assignedUserId'),
    firstDetectedOn: timestamp('firstDetectedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastDetectedOn: timestamp('lastDetectedOn')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    resolvedOn: timestamp('resolvedOn'),
    resolutionNote: text('resolutionNote'),
  },
  (finding) => ({
    integrationReconciliationAssigneeFk: foreignKey({
      columns: [finding.assignedUserId],
      foreignColumns: [users.userId],
      name: 'integrationReconciliationAssigneeFk',
    }),
    integrationReconciliationStateIndex: index(
      'integrationReconciliationStateIndex',
    ).on(finding.state, finding.severity, finding.lastDetectedOn),
    integrationReconciliationAggregateIndex: index(
      'integrationReconciliationAggregateIndex',
    ).on(finding.aggregateType, finding.aggregateId, finding.state),
  }),
)
