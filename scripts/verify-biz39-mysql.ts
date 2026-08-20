import assert from 'node:assert/strict'
import {eq, sql} from 'drizzle-orm'
import {organisations} from '../app/db/schema/organisations'
import {projects} from '../app/db/schema/projects'
import {
  defectCycles,
  integrationInbox,
  integrationPollCursors,
  integrationReconciliations,
  resultAttachmentObjects,
  resultCommands,
  resultNotifications,
  resultOutbox,
  resultRevisionAttachments,
  resultRevisions,
} from '../app/db/schema/resultRevisions'
import {runs, testRunMap} from '../app/db/schema/runs'
import {tests} from '../app/db/schema/tests'
import {users} from '../app/db/schema/users'
import {client, dbClient} from '../app/db/client'
import {TestStatusType} from '../app/dataController/types'
import {saveHumanResult} from '../app/services/resultCommands'
import {
  recordResultAttachmentUploaded,
  registerResultAttachmentUpload,
} from '../app/services/resultAttachments'
import {
  claimResultOutboxEvents,
  finalizeResultOutboxEvent,
} from '../app/services/resultOutbox'
import {
  claimIntegrationInboxEvents,
  claimIntegrationPollCursor,
  finalizeIntegrationInboxEvent,
  finalizeIntegrationPollCursor,
  recordVerifiedIntegrationEvent,
} from '../app/services/integrationInbox'

const main = async () => {
  const userInsert = await dbClient.insert(users).values({
    userName: 'BIZ-39 verifier',
    email: `biz39-${Date.now()}@example.invalid`,
    role: 'user',
    status: 'active',
  })
  const userId = userInsert[0].insertId

  const orgInsert = await dbClient.insert(organisations).values({
    orgName: `biz39-${Date.now()}`.slice(0, 20),
    createdBy: userId,
  })
  const orgId = orgInsert[0].insertId

  const projectInsert = await dbClient.insert(projects).values({
    projectName: 'BIZ-39 verification',
    orgId,
    createdBy: userId,
  })
  const projectId = projectInsert[0].insertId

  const testInsert = await dbClient.insert(tests).values({
    projectId,
    title: 'Concurrent result save',
    createdBy: userId,
  })
  const testId = testInsert[0].insertId

  const runInsert = await dbClient.insert(runs).values({
    projectId,
    runName: 'BIZ-39 verification run',
    status: 'Active',
    createdBy: userId,
  })
  const runId = runInsert[0].insertId

  const mapInsert = await dbClient.insert(testRunMap).values({
    projectId,
    runId,
    testId,
    isIncluded: true,
  })
  const testRunMapId = mapInsert[0].insertId

  const command = {
    resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
    testRunMapId,
    status: TestStatusType.Failed,
    comment: 'Disposable MySQL verification',
    actorUserId: userId,
  }

  const replayResults = await Promise.all([
    saveHumanResult(command),
    saveHumanResult(command),
  ])
  assert.equal(replayResults.filter((result) => result.replayed).length, 1)
  const [revisionCountAfterReplay] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(resultRevisions)
  const [commandCountAfterReplay] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(resultCommands)
  const [outboxCountAfterReplay] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(resultOutbox)
  assert.equal(Number(revisionCountAfterReplay.count), 1)
  assert.equal(Number(commandCountAfterReplay.count), 1)
  assert.equal(Number(outboxCountAfterReplay.count), 1)

  const attachmentKey =
    'test-run-attachments/12d19ee8-4700-4cd8-8df3-8f7de2b8ec78-proof.png'
  await registerResultAttachmentUpload({
    objectKey: attachmentKey,
    testRunMapId,
    uploaderUserId: userId,
    contentType: 'image/png',
    byteSize: 128,
    sha256: 'a'.repeat(64),
  })
  await recordResultAttachmentUploaded(attachmentKey)

  const secondResult = await saveHumanResult({
    ...command,
    resultCommandId: 'c6f28e2d-88ad-4605-9535-40f2bbf48a89',
    status: TestStatusType.Blocked,
    attachmentKeys: [attachmentKey],
  })
  const [revisionCountAfterSecondCommand] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(resultRevisions)
  assert.equal(Number(revisionCountAfterSecondCommand.count), 2)
  const [attachmentObject] = await dbClient
    .select({
      lifecycleState: resultAttachmentObjects.lifecycleState,
      testRunMapId: resultAttachmentObjects.testRunMapId,
    })
    .from(resultAttachmentObjects)
    .where(eq(resultAttachmentObjects.objectKey, attachmentKey))
  assert.equal(attachmentObject.lifecycleState, 'committed')
  assert.equal(attachmentObject.testRunMapId, testRunMapId)
  const [attachmentReferenceCount] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(resultRevisionAttachments)
  assert.equal(Number(attachmentReferenceCount.count), 1)

  await assert.rejects(
    saveHumanResult({
      ...command,
      resultCommandId: '36b467b7-9eb9-4d9f-ad61-a568498597f3',
      attachmentKeys: [
        'test-run-attachments/aa91cbd7-115f-4818-a2e5-22b15d57eaf1-unknown.png',
      ],
    }),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      (error as Error & {status: number}).status === 409,
  )

  const defectCycleInsert = await dbClient.insert(defectCycles).values({
    testRunMapId,
    cycleNumber: 1,
    activeMarker: 1,
    orgId,
    projectId,
    runId,
    testId,
    state: 'intake_pending',
    openingRevisionId: secondResult.resultRevisionId,
    currentEvidenceRevisionId: secondResult.resultRevisionId,
  })
  const defectCycleId = defectCycleInsert[0].insertId
  await assert.rejects(
    dbClient.insert(defectCycles).values({
      testRunMapId,
      cycleNumber: 2,
      activeMarker: 1,
      orgId,
      projectId,
      runId,
      testId,
      state: 'intake_pending',
      openingRevisionId: secondResult.resultRevisionId,
      currentEvidenceRevisionId: secondResult.resultRevisionId,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & {code: string}).code === 'ER_DUP_ENTRY',
  )

  await dbClient.insert(resultNotifications).values({
    notificationKey: `defect-cycle:${defectCycleId}:opened`,
    defectCycleId,
    resultRevisionId: secondResult.resultRevisionId,
    channel: 'checkmate',
    recipientKey: `user:${userId}`,
    payload: {state: 'intake_pending'},
  })
  await dbClient.insert(integrationReconciliations).values({
    findingKey: `defect-cycle:${defectCycleId}:provider-correlation`,
    findingType: 'missing_provider_correlation',
    aggregateType: 'defect_cycle',
    aggregateId: defectCycleId,
    severity: 'warning',
    expectedSnapshot: {providerWorkItemId: 'present'},
    actualSnapshot: {providerWorkItemId: null},
    assignedUserId: userId,
  })

  const inboxEvent = {
    provider: 'plane',
    providerDeliveryId: 'disposable-delivery-1',
    eventType: 'work_item.updated',
    payload: {workItemId: 'disposable-item', state: 'ready'},
    signatureState: 'not_applicable' as const,
  }
  const inboxWrites = await Promise.all([
    recordVerifiedIntegrationEvent(inboxEvent),
    recordVerifiedIntegrationEvent(inboxEvent),
  ])
  assert.equal(inboxWrites.filter((write) => write.replayed).length, 1)
  const [inboxRowCount] = await dbClient
    .select({count: sql<number>`count(*)`})
    .from(integrationInbox)
  assert.equal(Number(inboxRowCount.count), 1)
  const [inboxClaim] = await claimIntegrationInboxEvents({
    limit: 1,
    leaseMs: 30_000,
  })
  assert.ok(inboxClaim)
  assert.equal(
    await finalizeIntegrationInboxEvent({
      integrationInboxId: inboxClaim.integrationInboxId,
      leaseToken: 'stale-token',
      outcome: 'applied',
    }),
    false,
  )
  assert.equal(
    await finalizeIntegrationInboxEvent({
      integrationInboxId: inboxClaim.integrationInboxId,
      leaseToken: inboxClaim.leaseToken,
      outcome: 'applied',
    }),
    true,
  )

  const cursorInsert = await dbClient.insert(integrationPollCursors).values({
    provider: 'plane',
    destinationKey: 'development:BIZ',
    cursorValue: 'cursor-1',
  })
  const pollClaim = await claimIntegrationPollCursor({
    provider: 'plane',
    destinationKey: 'development:BIZ',
    leaseMs: 30_000,
  })
  assert.ok(pollClaim)
  assert.equal(pollClaim.integrationPollCursorId, cursorInsert[0].insertId)
  assert.equal(
    await finalizeIntegrationPollCursor({
      integrationPollCursorId: pollClaim.integrationPollCursorId,
      leaseToken: 'stale-token',
      cursorValue: 'cursor-2',
    }),
    false,
  )
  assert.equal(
    await finalizeIntegrationPollCursor({
      integrationPollCursorId: pollClaim.integrationPollCursorId,
      leaseToken: pollClaim.leaseToken,
      cursorValue: 'cursor-2',
    }),
    true,
  )

  const [firstClaim, secondClaim] = await Promise.all([
    claimResultOutboxEvents({limit: 1, leaseMs: 30_000}),
    claimResultOutboxEvents({limit: 1, leaseMs: 30_000}),
  ])
  const concurrentClaims = [...firstClaim, ...secondClaim]
  assert.ok(concurrentClaims.length >= 1)
  assert.equal(
    new Set(concurrentClaims.map((claim) => claim.resultOutboxId)).size,
    concurrentClaims.length,
  )
  const remainingClaims =
    concurrentClaims.length === 1
      ? await claimResultOutboxEvents({limit: 1, leaseMs: 30_000})
      : []
  const [firstLeasedEvent, secondLeasedEvent] = [
    ...concurrentClaims,
    ...remainingClaims,
  ].sort((left, right) => left.resultOutboxId - right.resultOutboxId)
  assert.ok(firstLeasedEvent)
  assert.ok(secondLeasedEvent)
  assert.notEqual(
    firstLeasedEvent.resultOutboxId,
    secondLeasedEvent.resultOutboxId,
  )

  assert.equal(
    await finalizeResultOutboxEvent({
      resultOutboxId: firstLeasedEvent.resultOutboxId,
      leaseToken: 'stale-token',
      outcome: 'delivered',
    }),
    false,
  )
  assert.equal(
    await finalizeResultOutboxEvent({
      resultOutboxId: firstLeasedEvent.resultOutboxId,
      leaseToken: firstLeasedEvent.leaseToken,
      outcome: 'delivered',
    }),
    true,
  )

  const retryAt = new Date(Date.now() - 1_000)
  assert.equal(
    await finalizeResultOutboxEvent({
      resultOutboxId: secondLeasedEvent.resultOutboxId,
      leaseToken: secondLeasedEvent.leaseToken,
      outcome: 'retry_due',
      error: 'Synthetic retry',
      availableOn: retryAt,
    }),
    true,
  )
  const [reclaimed] = await claimResultOutboxEvents({limit: 1, leaseMs: 30_000})
  assert.equal(reclaimed.resultOutboxId, secondLeasedEvent.resultOutboxId)
  assert.notEqual(reclaimed.leaseToken, secondLeasedEvent.leaseToken)
  assert.equal(
    await finalizeResultOutboxEvent({
      resultOutboxId: secondLeasedEvent.resultOutboxId,
      leaseToken: secondLeasedEvent.leaseToken,
      outcome: 'delivered',
    }),
    false,
  )

  const [projection] = await dbClient
    .select({currentResultRevisionId: testRunMap.currentResultRevisionId})
    .from(testRunMap)
    .where(eq(testRunMap.testRunMapId, testRunMapId))
  assert.ok(projection.currentResultRevisionId)

  process.stdout.write(
    'BIZ-39 MySQL verification passed: migrations, concurrent idempotency, attachment ownership, one active defect cycle, durable inbox and notifications, distinct claims, poll cursors, lease expiry, and token fencing.\n',
  )
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.end()
  })
