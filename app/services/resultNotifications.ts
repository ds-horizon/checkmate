import {and, asc, desc, eq} from 'drizzle-orm'
import {dbClient} from '~/db/client'
import {projects} from '@schema/projects'
import {
  resultNotifications,
  resultRevisions,
} from '@schema/resultRevisions'
import {runs} from '@schema/runs'
import {tests} from '@schema/tests'

const RETEST_CHANNEL = 'checkmate_retest_ready'
const MAX_NOTIFICATIONS = 100

export type MyRetestNotification = {
  resultNotificationId: number
  defectCycleId: number | null
  resultRevisionId: number
  projectId: number
  projectName: string
  runId: number
  runName: string
  testId: number
  testTitle: string
  readOn: Date | null
  createdOn: Date
}

const recipientKeyFor = (userId: number) => `user:${userId}`

const requireUserId = (userId: number) => {
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error('A valid user is required for retest notifications')
  }
}

export const listMyRetestNotifications = async (
  userId: number,
): Promise<MyRetestNotification[]> => {
  requireUserId(userId)

  return dbClient
    .select({
      resultNotificationId: resultNotifications.resultNotificationId,
      defectCycleId: resultNotifications.defectCycleId,
      resultRevisionId: resultNotifications.resultRevisionId,
      projectId: resultRevisions.projectId,
      projectName: projects.projectName,
      runId: resultRevisions.runId,
      runName: runs.runName,
      testId: resultRevisions.testId,
      testTitle: tests.title,
      readOn: resultNotifications.readOn,
      createdOn: resultNotifications.createdOn,
    })
    .from(resultNotifications)
    .innerJoin(
      resultRevisions,
      eq(resultRevisions.resultRevisionId, resultNotifications.resultRevisionId),
    )
    .innerJoin(projects, eq(projects.projectId, resultRevisions.projectId))
    .innerJoin(runs, eq(runs.runId, resultRevisions.runId))
    .innerJoin(tests, eq(tests.testId, resultRevisions.testId))
    .where(
      and(
        eq(resultNotifications.recipientKey, recipientKeyFor(userId)),
        eq(resultNotifications.channel, RETEST_CHANNEL),
      ),
    )
    .orderBy(asc(resultNotifications.readOn), desc(resultNotifications.createdOn))
    .limit(MAX_NOTIFICATIONS)
}

export const acknowledgeMyRetestNotification = async ({
  userId,
  resultNotificationId,
  now = new Date(),
}: {
  userId: number
  resultNotificationId: number
  now?: Date
}): Promise<string | null> => {
  requireUserId(userId)
  if (!Number.isInteger(resultNotificationId) || resultNotificationId < 1) {
    throw new Error('A valid retest notification is required')
  }

  return dbClient.transaction(async (trx) => {
    const [notification] = await trx
      .select({
        resultNotificationId: resultNotifications.resultNotificationId,
        projectId: resultRevisions.projectId,
        runId: resultRevisions.runId,
        testId: resultRevisions.testId,
        readOn: resultNotifications.readOn,
      })
      .from(resultNotifications)
      .innerJoin(
        resultRevisions,
        eq(
          resultRevisions.resultRevisionId,
          resultNotifications.resultRevisionId,
        ),
      )
      .where(
        and(
          eq(resultNotifications.resultNotificationId, resultNotificationId),
          eq(resultNotifications.recipientKey, recipientKeyFor(userId)),
          eq(resultNotifications.channel, RETEST_CHANNEL),
        ),
      )
      .limit(1)
      .for('update')

    if (!notification) return null

    if (!notification.readOn) {
      const updateResult = await trx
        .update(resultNotifications)
        .set({readOn: now})
        .where(
          and(
            eq(
              resultNotifications.resultNotificationId,
              notification.resultNotificationId,
            ),
            eq(resultNotifications.recipientKey, recipientKeyFor(userId)),
          ),
        )

      if (updateResult[0].affectedRows !== 1) {
        throw new Error('Retest notification acknowledgement was not saved')
      }
    }

    return `/project/${notification.projectId}/run/${notification.runId}/test/${notification.testId}`
  })
}
