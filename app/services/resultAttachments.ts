import {and, eq, inArray} from 'drizzle-orm'
import {projects} from '@schema/projects'
import {
  resultAttachmentObjects,
  resultRevisionAttachments,
} from '@schema/resultRevisions'
import {runs, testRunMap} from '@schema/runs'
import {users} from '@schema/users'
import {dbClient} from '~/db/client'
import {isValidAttachmentKey} from '~/services/s3'

export class ResultAttachmentError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ResultAttachmentError'
  }
}

type RegisterResultAttachmentUpload = {
  objectKey: string
  testRunMapId: number
  uploaderUserId: number
  contentType: string
  byteSize: number
  sha256: string
}

export const registerResultAttachmentUpload = async ({
  objectKey,
  testRunMapId,
  uploaderUserId,
  contentType,
  byteSize,
  sha256,
}: RegisterResultAttachmentUpload): Promise<void> => {
  return dbClient.transaction(async (trx) => {
    const [aggregate] = await trx
      .select({
        testRunMapId: testRunMap.testRunMapId,
        mapRunId: testRunMap.runId,
        mapTestId: testRunMap.testId,
        mapProjectId: testRunMap.projectId,
        isIncluded: testRunMap.isIncluded,
        runId: runs.runId,
        runProjectId: runs.projectId,
        runStatus: runs.status,
        orgId: projects.orgId,
        projectCreatedBy: projects.createdBy,
      })
      .from(testRunMap)
      .innerJoin(runs, eq(testRunMap.runId, runs.runId))
      .innerJoin(projects, eq(testRunMap.projectId, projects.projectId))
      .where(eq(testRunMap.testRunMapId, testRunMapId))
      .for('update')

    if (
      !aggregate ||
      aggregate.mapRunId === null ||
      aggregate.mapTestId === null
    ) {
      throw new ResultAttachmentError('Result not found', 404)
    }
    if (aggregate.mapProjectId !== aggregate.runProjectId) {
      throw new ResultAttachmentError('Result scope is inconsistent', 409)
    }
    if (!aggregate.isIncluded || aggregate.runStatus !== 'Active') {
      throw new ResultAttachmentError(
        'Attachments require an included result in an active run',
        409,
      )
    }

    const [actor] = await trx
      .select({userId: users.userId, role: users.role})
      .from(users)
      .where(and(eq(users.userId, uploaderUserId), eq(users.status, 'active')))
      .limit(1)

    if (!actor) {
      throw new ResultAttachmentError('Authenticated actor is not active', 403)
    }
    if (actor.role !== 'admin' && aggregate.projectCreatedBy !== actor.userId) {
      throw new ResultAttachmentError(
        'Only the project owner or an administrator can upload evidence',
        403,
      )
    }

    await trx.insert(resultAttachmentObjects).values({
      objectKey,
      testRunMapId: aggregate.testRunMapId,
      orgId: aggregate.orgId,
      projectId: aggregate.mapProjectId,
      runId: aggregate.mapRunId,
      testId: aggregate.mapTestId,
      uploaderUserId: actor.userId,
      contentType,
      byteSize,
      sha256,
      lifecycleState: 'pending_upload',
      retentionPolicy: 'source_owned',
    })
  })
}

const updateAttachmentState = async ({
  objectKey,
  fromState,
  values,
}: {
  objectKey: string
  fromState: 'pending_upload' | 'delete_pending'
  values: Partial<typeof resultAttachmentObjects.$inferInsert>
}) => {
  const result = await dbClient
    .update(resultAttachmentObjects)
    .set(values)
    .where(
      and(
        eq(resultAttachmentObjects.objectKey, objectKey),
        eq(resultAttachmentObjects.lifecycleState, fromState),
      ),
    )

  if (result[0].affectedRows !== 1) {
    throw new Error(
      'Attachment state transition did not affect exactly one row',
    )
  }
}

export const recordResultAttachmentUploaded = async (
  objectKey: string,
): Promise<void> =>
  updateAttachmentState({
    objectKey,
    fromState: 'pending_upload',
    values: {
      lifecycleState: 'uploaded',
      uploadedOn: new Date(),
      lastError: null,
    },
  })

export const recordResultAttachmentUploadFailure = async (
  objectKey: string,
  error: unknown,
): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error)
  await dbClient
    .update(resultAttachmentObjects)
    .set({lifecycleState: 'failed', lastError: message.slice(0, 10_000)})
    .where(
      and(
        eq(resultAttachmentObjects.objectKey, objectKey),
        eq(resultAttachmentObjects.lifecycleState, 'pending_upload'),
      ),
    )
}

export const reserveResultAttachmentDeletion = async ({
  objectKey,
  actorUserId,
}: {
  objectKey: string
  actorUserId: number
}): Promise<'pending_upload' | 'uploaded' | 'failed'> => {
  return dbClient.transaction(async (trx) => {
    const [attachment] = await trx
      .select({
        resultAttachmentObjectId:
          resultAttachmentObjects.resultAttachmentObjectId,
        uploaderUserId: resultAttachmentObjects.uploaderUserId,
        lifecycleState: resultAttachmentObjects.lifecycleState,
      })
      .from(resultAttachmentObjects)
      .where(eq(resultAttachmentObjects.objectKey, objectKey))
      .for('update')

    if (!attachment) {
      throw new ResultAttachmentError('Attachment not found', 404)
    }
    if (attachment.uploaderUserId !== actorUserId) {
      throw new ResultAttachmentError(
        'Only the attachment uploader can remove this draft',
        403,
      )
    }
    const recoveryState = attachment.lifecycleState
    if (
      recoveryState !== 'pending_upload' &&
      recoveryState !== 'uploaded' &&
      recoveryState !== 'failed'
    ) {
      throw new ResultAttachmentError(
        'Only an uncommitted attachment draft can be deleted',
        409,
      )
    }

    const [revisionReference] = await trx
      .select({
        resultRevisionAttachmentId:
          resultRevisionAttachments.resultRevisionAttachmentId,
      })
      .from(resultRevisionAttachments)
      .where(
        eq(
          resultRevisionAttachments.resultAttachmentObjectId,
          attachment.resultAttachmentObjectId,
        ),
      )
      .limit(1)

    if (revisionReference) {
      throw new ResultAttachmentError(
        'Revision evidence is retained and cannot be deleted',
        409,
      )
    }

    const updateResult = await trx
      .update(resultAttachmentObjects)
      .set({lifecycleState: 'delete_pending', lastError: null})
      .where(
        and(
          eq(
            resultAttachmentObjects.resultAttachmentObjectId,
            attachment.resultAttachmentObjectId,
          ),
          inArray(resultAttachmentObjects.lifecycleState, [
            'pending_upload',
            'uploaded',
            'failed',
          ]),
        ),
      )

    if (updateResult[0].affectedRows !== 1) {
      throw new Error('Attachment delete reservation lost its lock')
    }

    return recoveryState
  })
}

export const recordResultAttachmentDeleted = async (
  objectKey: string,
): Promise<void> =>
  updateAttachmentState({
    objectKey,
    fromState: 'delete_pending',
    values: {lifecycleState: 'deleted', deletedOn: new Date(), lastError: null},
  })

export const recordResultAttachmentDeletionFailure = async (
  objectKey: string,
  error: unknown,
  recoveryState: 'pending_upload' | 'uploaded' | 'failed',
): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error)
  await updateAttachmentState({
    objectKey,
    fromState: 'delete_pending',
    values: {
      lifecycleState: recoveryState,
      lastError: message.slice(0, 10_000),
    },
  })
}

export const assertResultAttachmentReadScope = async ({
  objectKeys,
  runId,
  testId,
}: {
  objectKeys: string[]
  runId: number
  testId: number
}): Promise<void> => {
  const uniqueObjectKeys = [...new Set(objectKeys)]
  if (uniqueObjectKeys.length === 0) return

  const attachmentObjects = await dbClient
    .select({
      objectKey: resultAttachmentObjects.objectKey,
      objectRunId: resultAttachmentObjects.runId,
      objectTestId: resultAttachmentObjects.testId,
      lifecycleState: resultAttachmentObjects.lifecycleState,
    })
    .from(resultAttachmentObjects)
    .where(inArray(resultAttachmentObjects.objectKey, uniqueObjectKeys))

  const metadataByKey = new Map(
    attachmentObjects.map((attachment) => [attachment.objectKey, attachment]),
  )
  const invalidMetadata = uniqueObjectKeys.some((objectKey) => {
    const attachment = metadataByKey.get(objectKey)
    return (
      attachment !== undefined &&
      (attachment.objectRunId !== runId ||
        attachment.objectTestId !== testId ||
        attachment.lifecycleState !== 'committed')
    )
  })

  if (invalidMetadata) {
    throw new ResultAttachmentError(
      'Attachment evidence is outside this result scope',
      403,
    )
  }

  // Result attachment metadata was introduced after historical status rows
  // existed. This reader may sign only valid legacy keys that this run/test
  // history query already returned; new metadata-bearing objects remain bound
  // to their committed scope. Remove this compatibility path after backfill.
  if (uniqueObjectKeys.some((objectKey) => !isValidAttachmentKey(objectKey))) {
    throw new ResultAttachmentError(
      'Attachment evidence is outside this result scope',
      403,
    )
  }
}
