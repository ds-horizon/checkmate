import {createHash} from 'node:crypto'
import {and, desc, eq, inArray} from 'drizzle-orm'
import {projects} from '@schema/projects'
import {
  resultCommands,
  resultAttachmentObjects,
  resultOutbox,
  resultRevisionAttachments,
  resultRevisions,
  ResultCommandOutcome,
  ResultRevisionCommittedPayload,
} from '@schema/resultRevisions'
import {runs, testRunMap, testRunsStatusHistory} from '@schema/runs'
import {users} from '@schema/users'
import {TestStatusType} from '~/dataController/types'
import {dbClient} from '~/db/client'

export type SaveHumanResultCommand = {
  resultCommandId: string
  testRunMapId: number
  status: TestStatusType
  comment?: string | null
  attachmentKeys?: string[]
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
  })
}

export const fingerprintResultCommand = (command: SaveHumanResultCommand) =>
  createHash('sha256')
    .update(canonicalCommandPayload(command), 'utf8')
    .digest('hex')

const parseOutcome = (outcome: ResultCommandOutcome | string) => {
  if (typeof outcome === 'string') {
    return JSON.parse(outcome) as ResultCommandOutcome
  }
  return outcome
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
      })
      .from(testRunMap)
      .innerJoin(runs, eq(testRunMap.runId, runs.runId))
      .innerJoin(projects, eq(testRunMap.projectId, projects.projectId))
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
    if (aggregate.mapProjectId !== aggregate.runProjectId) {
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
    }

    await trx.insert(resultOutbox).values({
      eventKey: `result-revision:${resultRevisionId}:committed`,
      eventType: 'result_revision_committed',
      aggregateType: 'test_run_map',
      aggregateId: aggregate.testRunMapId,
      resultRevisionId,
      payload: outboxPayload,
    })

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
