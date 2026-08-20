import {createHash, randomUUID} from 'node:crypto'
import {and, desc, eq, inArray} from 'drizzle-orm'
import {projects} from '@schema/projects'
import {
  defectCycles,
  planeEvidenceDeliveries,
  resultCommands,
  resultAttachmentObjects,
  resultOutbox,
  resultRevisionAttachments,
  resultRevisions,
  ResultCommandOutcome,
  ResultRevisionCommittedPayload,
} from '@schema/resultRevisions'
import {runs, testRunMap, testRunsStatusHistory} from '@schema/runs'
import {tests} from '@schema/tests'
import {users} from '@schema/users'
import {TestStatusType} from '~/dataController/types'
import {dbClient} from '~/db/client'

export type SaveHumanResultCommand = {
  resultCommandId: string
  testRunMapId: number
  status: TestStatusType
  comment?: string | null
  attachmentKeys?: string[]
  createPlaneDefect?: boolean
  actorUserId: number
}

export type SaveHumanResultResponse = ResultCommandOutcome & {
  replayed: boolean
}

export class ResultCommandError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ResultCommandError'
  }
}

const canonicalCommandPayload = (command: SaveHumanResultCommand) => {
  const {
    resultCommandId,
    testRunMapId,
    status,
    comment,
    attachmentKeys,
    createPlaneDefect,
    actorUserId,
  } = command
  const normalizedAttachmentKeys = [...new Set(attachmentKeys ?? [])].sort()
  return JSON.stringify({
    resultCommandId,
    testRunMapId,
    status,
    actorUserId,
    commentIncluded: Object.prototype.hasOwnProperty.call(command, 'comment'),
    comment: comment ?? null,
    attachmentKeys: normalizedAttachmentKeys,
    ...(createPlaneDefect === true ? {createPlaneDefect: true} : {}),
  })
}

const PLANE_PROVIDER = 'plane'
const PLANE_WORKSPACE_ID = 'e36dfd86-953a-4e33-a410-856208893bb9'
const PLANE_PROJECT_ID = '67726ee5-7d0c-4656-8bc8-b2f8a959d5da'

const buildPlaneAttachmentName = ({
  objectKey,
  resultAttachmentObjectId,
  sha256,
}: {
  objectKey: string
  resultAttachmentObjectId: number
  sha256: string
}) => {
  const originalName =
    objectKey.replace(
      /^test-run-attachments\/[0-9a-f-]{36}-/,
      '',
    ) || 'screenshot'
  const prefix = `checkmate-${resultAttachmentObjectId}-${sha256.slice(0, 12)}-`
  return `${prefix}${originalName.slice(-(255 - prefix.length))}`
}

const isPlaneDefectEligibleStatus = (status: TestStatusType) =>
  status === TestStatusType.Failed || status === TestStatusType.Retest

const buildPlaneDefectIntent = ({
  defectCycleId,
  correlationKey,
  testTitle,
  status,
  runId,
  testId,
  revisionNumber,
  comment,
  attachmentKeys,
}: {
  defectCycleId: number
  correlationKey: string
  testTitle: string
  status: TestStatusType
  runId: number
  testId: number
  revisionNumber: number
  comment: string | null
  attachmentKeys: string[]
}) => ({
  create: true as const,
  defectCycleId,
  correlationKey,
  title: `${status}: ${testTitle}`.slice(0, 255),
  description: [
    `Checkmate result for ${testTitle}`,
    `Status: ${status}`,
    `Run ID: ${runId}`,
    `Test ID: ${testId}`,
    `Result revision: ${revisionNumber}`,
    `Correlation: ${correlationKey}`,
    '',
    'Result note:',
    comment?.trim() || '(no comment)',
    '',
    `Screenshots retained in Checkmate: ${attachmentKeys.length}`,
  ].join('\n'),
  priority: 'none' as const,
  attachmentKeys,
})

export const fingerprintResultCommand = (command: SaveHumanResultCommand) =>
  createHash('sha256')
    .update(canonicalCommandPayload(command), 'utf8')
    .digest('hex')

const parseOutcome = (outcome: ResultCommandOutcome | string) => {
  const parsed =
    typeof outcome === 'string'
      ? (JSON.parse(outcome) as ResultCommandOutcome)
      : outcome

  return {
    ...parsed,
    // Receipts written before defect cycles existed do not have this field.
    defectCycleId: parsed.defectCycleId ?? null,
  }
}

export const saveHumanResult = async (
  command: SaveHumanResultCommand,
): Promise<SaveHumanResultResponse> => {
  const requestFingerprint = fingerprintResultCommand(command)

  return dbClient.transaction(async (trx) => {
    const [aggregate] = await trx
      .select({
        testRunMapId: testRunMap.testRunMapId,
        mapRunId: testRunMap.runId,
        mapTestId: testRunMap.testId,
        mapProjectId: testRunMap.projectId,
        isIncluded: testRunMap.isIncluded,
        currentComment: testRunMap.comment,
        runId: runs.runId,
        runProjectId: runs.projectId,
        runStatus: runs.status,
        orgId: projects.orgId,
        projectCreatedBy: projects.createdBy,
        testProjectId: tests.projectId,
        testTitle: tests.title,
      })
      .from(testRunMap)
      .innerJoin(runs, eq(testRunMap.runId, runs.runId))
      .innerJoin(projects, eq(testRunMap.projectId, projects.projectId))
      .innerJoin(tests, eq(testRunMap.testId, tests.testId))
      .where(eq(testRunMap.testRunMapId, command.testRunMapId))
      .for('update')

    if (!aggregate) {
      throw new ResultCommandError('Result not found', 404)
    }

    const [existingCommand] = await trx
      .select({
        requestFingerprint: resultCommands.requestFingerprint,
        outcome: resultCommands.outcome,
      })
      .from(resultCommands)
      .where(
        and(
          eq(resultCommands.testRunMapId, command.testRunMapId),
          eq(resultCommands.resultCommandId, command.resultCommandId),
        ),
      )
      .limit(1)

    if (existingCommand) {
      if (existingCommand.requestFingerprint !== requestFingerprint) {
        throw new ResultCommandError(
          'Result command ID was already used with a different payload',
          409,
        )
      }
      return {...parseOutcome(existingCommand.outcome), replayed: true}
    }

    if (aggregate.mapRunId === null || aggregate.mapTestId === null) {
      throw new ResultCommandError('Result not found', 404)
    }
    if (
      aggregate.mapProjectId !== aggregate.runProjectId ||
      aggregate.mapProjectId !== aggregate.testProjectId
    ) {
      throw new ResultCommandError('Result scope is inconsistent', 409)
    }
    if (!aggregate.isIncluded) {
      throw new ResultCommandError('Result is not included in this run', 409)
    }
    if (aggregate.runStatus !== 'Active') {
      throw new ResultCommandError('Run is not active', 423)
    }

    const aggregateRows = await trx
      .select({testRunMapId: testRunMap.testRunMapId})
      .from(testRunMap)
      .where(
        and(
          eq(testRunMap.runId, aggregate.mapRunId),
          eq(testRunMap.testId, aggregate.mapTestId),
          eq(testRunMap.projectId, aggregate.mapProjectId),
        ),
      )
      .for('update')

    if (aggregateRows.length !== 1) {
      throw new ResultCommandError(
        'Duplicate result mappings must be reconciled before saving',
        409,
      )
    }

    const [actor] = await trx
      .select({userId: users.userId, role: users.role})
      .from(users)
      .where(
        and(eq(users.userId, command.actorUserId), eq(users.status, 'active')),
      )
      .limit(1)

    if (!actor) {
      throw new ResultCommandError('Authenticated actor is not active', 403)
    }
    if (actor.role !== 'admin' && aggregate.projectCreatedBy !== actor.userId) {
      throw new ResultCommandError(
        'Only the project owner or an administrator can save this result',
        403,
      )
    }
    const [latestRevision] = await trx
      .select({revisionNumber: resultRevisions.revisionNumber})
      .from(resultRevisions)
      .where(eq(resultRevisions.testRunMapId, command.testRunMapId))
      .orderBy(desc(resultRevisions.revisionNumber))
      .limit(1)

    const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1
    const effectiveComment =
      command.comment === undefined ? aggregate.currentComment : command.comment
    const attachmentKeys = [...new Set(command.attachmentKeys ?? [])].sort()
    const createPlaneDefect = command.createPlaneDefect === true

    if (createPlaneDefect && !isPlaneDefectEligibleStatus(command.status)) {
      throw new ResultCommandError(
        'Plane defects can be created only for Failed or Retest results',
        400,
      )
    }
    if (
      createPlaneDefect &&
      !effectiveComment?.trim() &&
      attachmentKeys.length === 0
    ) {
      throw new ResultCommandError(
        'Add a result note or screenshot before creating a Plane defect',
        400,
      )
    }

    const attachmentObjects =
      attachmentKeys.length === 0
        ? []
        : await trx
            .select({
              resultAttachmentObjectId:
                resultAttachmentObjects.resultAttachmentObjectId,
              objectKey: resultAttachmentObjects.objectKey,
              testRunMapId: resultAttachmentObjects.testRunMapId,
              orgId: resultAttachmentObjects.orgId,
              projectId: resultAttachmentObjects.projectId,
              runId: resultAttachmentObjects.runId,
              testId: resultAttachmentObjects.testId,
              contentType: resultAttachmentObjects.contentType,
              byteSize: resultAttachmentObjects.byteSize,
              sha256: resultAttachmentObjects.sha256,
              lifecycleState: resultAttachmentObjects.lifecycleState,
            })
            .from(resultAttachmentObjects)
            .where(inArray(resultAttachmentObjects.objectKey, attachmentKeys))
            .for('update')

    if (
      attachmentObjects.length !== attachmentKeys.length ||
      attachmentObjects.some(
        (attachment) =>
          attachment.testRunMapId !== aggregate.testRunMapId ||
          attachment.orgId !== aggregate.orgId ||
          attachment.projectId !== aggregate.mapProjectId ||
          attachment.runId !== aggregate.mapRunId ||
          attachment.testId !== aggregate.mapTestId ||
          !['uploaded', 'committed'].includes(attachment.lifecycleState),
      )
    ) {
      throw new ResultCommandError(
        'Every attachment must be uploaded for this exact result',
        409,
      )
    }

    const revisionInsert = await trx.insert(resultRevisions).values({
      testRunMapId: aggregate.testRunMapId,
      revisionNumber,
      resultCommandId: command.resultCommandId,
      orgId: aggregate.orgId,
      projectId: aggregate.mapProjectId,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      status: command.status,
      comment: effectiveComment,
      actorUserId: actor.userId,
      actorType: 'human',
      sourceSystem: 'checkmate',
      sourceEventId: command.resultCommandId,
    })
    const resultRevisionId = revisionInsert[0].insertId

    if (!resultRevisionId) {
      throw new Error('Result revision insert did not return an ID')
    }

    if (attachmentKeys.length > 0) {
      await trx.insert(resultRevisionAttachments).values(
        attachmentObjects.map((attachment) => ({
          resultRevisionId,
          resultAttachmentObjectId: attachment.resultAttachmentObjectId,
          objectKey: attachment.objectKey,
          retentionPolicy: 'source_owned' as const,
        })),
      )

      await trx
        .update(resultAttachmentObjects)
        .set({lifecycleState: 'committed', lastError: null})
        .where(
          inArray(
            resultAttachmentObjects.resultAttachmentObjectId,
            attachmentObjects.map(
              (attachment) => attachment.resultAttachmentObjectId,
            ),
          ),
        )
    }

    const projectionUpdate = await trx
      .update(testRunMap)
      .set({
        status: command.status,
        comment: effectiveComment,
        updatedBy: actor.userId,
        updatedOn: new Date(),
        currentResultRevisionId: resultRevisionId,
      })
      .where(eq(testRunMap.testRunMapId, aggregate.testRunMapId))

    if (projectionUpdate[0].affectedRows !== 1) {
      throw new Error('Result projection update did not affect exactly one row')
    }

    await trx.insert(testRunsStatusHistory).values({
      status: command.status,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      updatedBy: actor.userId,
      updatedOn: new Date(),
      comment: effectiveComment,
      attachments: attachmentKeys,
    })

    let defectCycleId: number | null = null

    if (command.status === TestStatusType.Passed) {
      const [activeCorrelatedCycle] = await trx
        .select({defectCycleId: defectCycles.defectCycleId})
        .from(defectCycles)
        .where(
          and(
            eq(defectCycles.testRunMapId, aggregate.testRunMapId),
            eq(defectCycles.activeMarker, 1),
          ),
        )
        .limit(1)
        .for('update')

      if (activeCorrelatedCycle) {
        defectCycleId = activeCorrelatedCycle.defectCycleId
        const cycleUpdate = await trx
          .update(defectCycles)
          .set({
            state: 'validated',
            activeMarker: null,
            closedOn: new Date(),
          })
          .where(
            eq(defectCycles.defectCycleId, activeCorrelatedCycle.defectCycleId),
          )
        if (cycleUpdate[0].affectedRows !== 1) {
          throw new Error('Defect cycle validation did not affect exactly one row')
        }
        const revisionCycleUpdate = await trx
          .update(resultRevisions)
          .set({defectCycleId})
          .where(eq(resultRevisions.resultRevisionId, resultRevisionId))
        if (revisionCycleUpdate[0].affectedRows !== 1) {
          throw new Error(
            'Validated result revision cycle link did not affect exactly one row',
          )
        }
      }
    }

    let planeDefectIntent: ResultRevisionCommittedPayload['planeDefectIntent']
    const planeEvidenceIntents: NonNullable<
      ResultRevisionCommittedPayload['planeEvidenceIntent']
    >[] = []

    if (createPlaneDefect) {
      const [activeCycle] = await trx
        .select({
          defectCycleId: defectCycles.defectCycleId,
          provider: defectCycles.provider,
          providerWorkspaceId: defectCycles.providerWorkspaceId,
          providerProjectId: defectCycles.providerProjectId,
        })
        .from(defectCycles)
        .where(
          and(
            eq(defectCycles.testRunMapId, aggregate.testRunMapId),
            eq(defectCycles.activeMarker, 1),
          ),
        )
        .limit(1)
        .for('update')

      if (activeCycle) {
        if (
          activeCycle.provider !== PLANE_PROVIDER ||
          activeCycle.providerWorkspaceId !== PLANE_WORKSPACE_ID ||
          activeCycle.providerProjectId !== PLANE_PROJECT_ID
        ) {
          throw new ResultCommandError(
            'The active defect cycle targets a different provider destination',
            409,
          )
        }
        defectCycleId = activeCycle.defectCycleId
        const cycleUpdate = await trx
          .update(defectCycles)
          .set({currentEvidenceRevisionId: resultRevisionId})
          .where(eq(defectCycles.defectCycleId, defectCycleId))
        if (cycleUpdate[0].affectedRows !== 1) {
          throw new Error('Defect cycle update did not affect exactly one row')
        }
      } else {
        const [latestCycle] = await trx
          .select({cycleNumber: defectCycles.cycleNumber})
          .from(defectCycles)
          .where(eq(defectCycles.testRunMapId, aggregate.testRunMapId))
          .orderBy(desc(defectCycles.cycleNumber))
          .limit(1)

        const correlationKey = `checkmate:${randomUUID()}`
        const cycleInsert = await trx.insert(defectCycles).values({
          testRunMapId: aggregate.testRunMapId,
          cycleNumber: (latestCycle?.cycleNumber ?? 0) + 1,
          activeMarker: 1,
          orgId: aggregate.orgId,
          projectId: aggregate.mapProjectId,
          runId: aggregate.mapRunId,
          testId: aggregate.mapTestId,
          state: 'intake_pending',
          openingRevisionId: resultRevisionId,
          currentEvidenceRevisionId: resultRevisionId,
          provider: PLANE_PROVIDER,
          providerWorkspaceId: PLANE_WORKSPACE_ID,
          providerProjectId: PLANE_PROJECT_ID,
          createCorrelationKey: correlationKey,
        })
        defectCycleId = cycleInsert[0].insertId
        if (!defectCycleId) {
          throw new Error('Defect cycle insert did not return an ID')
        }
        planeDefectIntent = buildPlaneDefectIntent({
          defectCycleId,
          correlationKey,
          testTitle: aggregate.testTitle,
          status: command.status,
          runId: aggregate.mapRunId,
          testId: aggregate.mapTestId,
          revisionNumber,
          comment: effectiveComment,
          attachmentKeys,
        })
      }

      const revisionCycleUpdate = await trx
        .update(resultRevisions)
        .set({defectCycleId})
        .where(eq(resultRevisions.resultRevisionId, resultRevisionId))
      if (revisionCycleUpdate[0].affectedRows !== 1) {
        throw new Error(
          'Result revision cycle link did not affect exactly one row',
        )
      }

      const noteNeedsSeparateDelivery =
        !planeDefectIntent && Boolean(effectiveComment?.trim())
      const evidenceSources = [
        ...(noteNeedsSeparateDelivery
          ? [
              {
                sourceKind: 'note' as const,
                sourceIdentity: `result-revision:${resultRevisionId}:note`,
                sourceText: effectiveComment as string,
                sourceObjectKey: null,
                sourceSha256: createHash('sha256')
                  .update(effectiveComment as string, 'utf8')
                  .digest('hex'),
                sourceContentType: 'text/plain; charset=utf-8',
                sourceByteSize: Buffer.byteLength(
                  effectiveComment as string,
                  'utf8',
                ),
                providerResourceName: `Checkmate result revision ${revisionNumber}`,
                resultAttachmentObjectId: null,
              },
            ]
          : []),
        ...attachmentObjects.map((attachment) => ({
          sourceKind: 'attachment' as const,
          sourceIdentity: `result-attachment:${attachment.resultAttachmentObjectId}:${attachment.sha256}`,
          sourceText: null,
          sourceObjectKey: attachment.objectKey,
          sourceSha256: attachment.sha256,
          sourceContentType: attachment.contentType,
          sourceByteSize: attachment.byteSize,
          providerResourceName: buildPlaneAttachmentName(attachment),
          resultAttachmentObjectId: attachment.resultAttachmentObjectId,
        })),
      ]

      for (const source of evidenceSources) {
        const [existingDelivery] = await trx
          .select({
            planeEvidenceDeliveryId:
              planeEvidenceDeliveries.planeEvidenceDeliveryId,
          })
          .from(planeEvidenceDeliveries)
          .where(
            and(
              eq(planeEvidenceDeliveries.defectCycleId, defectCycleId),
              eq(planeEvidenceDeliveries.sourceIdentity, source.sourceIdentity),
            ),
          )
          .limit(1)
          .for('update')
        if (existingDelivery) continue

        const deliveryInsert = await trx.insert(planeEvidenceDeliveries).values({
          defectCycleId,
          resultRevisionId,
          resultAttachmentObjectId: source.resultAttachmentObjectId,
          sourceKind: source.sourceKind,
          sourceIdentity: source.sourceIdentity,
          sourceText: source.sourceText,
          sourceObjectKey: source.sourceObjectKey,
          sourceSha256: source.sourceSha256,
          sourceContentType: source.sourceContentType,
          sourceByteSize: source.sourceByteSize,
          providerResourceName: source.providerResourceName,
          provider: PLANE_PROVIDER,
          providerWorkspaceId: PLANE_WORKSPACE_ID,
          providerProjectId: PLANE_PROJECT_ID,
        })
        const planeEvidenceDeliveryId = deliveryInsert[0].insertId
        if (!planeEvidenceDeliveryId) {
          throw new Error('Plane evidence delivery insert did not return an ID')
        }
        planeEvidenceIntents.push({
          planeEvidenceDeliveryId,
          defectCycleId,
          resultRevisionId,
        })
      }
    }

    const outcome: ResultCommandOutcome = {
      resultCommandId: command.resultCommandId,
      resultRevisionId,
      revisionNumber,
      testRunMapId: aggregate.testRunMapId,
      orgId: aggregate.orgId,
      projectId: aggregate.mapProjectId,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      status: command.status,
      comment: effectiveComment,
      attachmentKeys,
      defectCycleId,
    }

    const outboxPayload: ResultRevisionCommittedPayload = {
      resultCommandId: command.resultCommandId,
      resultRevisionId,
      revisionNumber,
      testRunMapId: aggregate.testRunMapId,
      orgId: aggregate.orgId,
      projectId: aggregate.mapProjectId,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      status: command.status,
      actorUserId: actor.userId,
      actorType: 'human',
      sourceSystem: 'checkmate',
      ...(defectCycleId === null ? {} : {defectCycleId}),
      ...(planeDefectIntent ? {planeDefectIntent} : {}),
    }

    await trx.insert(resultOutbox).values({
      eventKey: planeDefectIntent
        ? `defect-cycle:${defectCycleId}:plane-create`
        : `result-revision:${resultRevisionId}:committed`,
      eventType: planeDefectIntent
        ? 'plane_defect_create_requested'
        : 'result_revision_committed',
      aggregateType: planeDefectIntent ? 'defect_cycle' : 'test_run_map',
      aggregateId: planeDefectIntent
        ? (defectCycleId as number)
        : aggregate.testRunMapId,
      resultRevisionId,
      payload: outboxPayload,
    })

    for (const planeEvidenceIntent of planeEvidenceIntents) {
      await trx.insert(resultOutbox).values({
        eventKey: `plane-evidence:${planeEvidenceIntent.planeEvidenceDeliveryId}`,
        eventType: 'plane_evidence_delivery_requested',
        aggregateType: 'plane_evidence',
        aggregateId: planeEvidenceIntent.planeEvidenceDeliveryId,
        resultRevisionId,
        payload: {...outboxPayload, planeEvidenceIntent},
      })
    }

    await trx.insert(resultCommands).values({
      resultCommandId: command.resultCommandId,
      testRunMapId: aggregate.testRunMapId,
      requestFingerprint,
      resultRevisionId,
      orgId: aggregate.orgId,
      projectId: aggregate.mapProjectId,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      actorUserId: actor.userId,
      outcome,
    })

    return {...outcome, replayed: false}
  })
}
