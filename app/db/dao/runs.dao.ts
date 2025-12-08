import {and, count, desc, eq, inArray, like, or, sql} from 'drizzle-orm'
import {dbClient} from '../client'
import {runs, testRunMap} from '@schema/runs'
import {logger, LogType} from '~/utils/logger'
import {errorHandling} from './utils'
import {users} from '@schema/users'
import {alias} from 'drizzle-orm/mysql-core'
import {
  ICreateRuns,
  IGetAllRuns,
  IUpdateRun,
} from '~/dataController/runs.controller'
import {tests} from '@schema/tests'
import {labelTestMap} from '@schema/labels'
import {ICreateTestRuns} from './testRuns.dao'
import {IRunsMetaInfo} from '@controllers/testRuns.controller'
import {ErrorCause} from '~/constants'

const RunsDao = {
  getAllRuns: async (params: IGetAllRuns) => {
    try {
      const {projectId, pageSize, page, search, status} = params

      const whereClauses: any[] = [eq(runs.projectId, projectId)]
      if (search) {
        whereClauses.push(like(runs.runName, `%${search.toLowerCase()}%`))
      }
      if (status) {
        whereClauses.push(eq(runs.status, status))
      }

      const usersAlias = alias(users, 'usersAlias')

      let runsDataQuery = dbClient
        .select({
          runId: runs.runId,
          runName: runs.runName,
          status: runs.status,
          createdByUserName: users.userName,
          createdOn: runs.createdOn,
          lockedBy: usersAlias.userName,
          lockedOn: runs.lockedOn,
          runDescription: runs.runDescription,
          refrence: runs.refrence,
          projectId: runs.projectId,
        })
        .from(runs)
        .leftJoin(users, eq(runs.createdBy, users.userId))
        .leftJoin(usersAlias, eq(runs.lockedBy, usersAlias.userId))
        .where(and(...whereClauses))
        .orderBy(desc(runs.createdOn))
        .$dynamic()

      if (pageSize) runsDataQuery = runsDataQuery.limit(pageSize)
      if (page && pageSize)
        runsDataQuery = runsDataQuery.offset((page - 1) * pageSize)

      const [runsData, runsCount] = await Promise.all([
        runsDataQuery.execute(),
        dbClient
          .select({count: count()})
          .from(runs)
          .where(and(...whereClauses))
          .execute(),
      ])

      return {runsData, runsCount}
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching runs',
        message: error,
      })

      if (error.errno && error.errno === 1064)
        throw new Error('Invalid SQL Syntax while getting runs')

      if (error.errno && error.errno === 1146)
        throw new Error('Requested table not found')

      throw error
    }
  },

  createRun: async ({
    projectId,
    runName,
    createdBy,
    labelIds,
    runDescription,
    squadIds,
    filterType,
    sectionIds,
    platformIds,
    priorityIds,
  }: ICreateRuns) => {
    try {
      const resp = await dbClient.transaction(async (trx) => {
        const addRunsResp = await trx.insert(runs).values({
          projectId,
          runName,
          runDescription,
          createdBy,
          status: 'Active',
        })

        const runId = addRunsResp[0].insertId
        const andWhereCluase: any[] = [
          eq(tests.projectId, projectId),
          eq(tests.status, 'Active'),
        ]

        let whereClauses: any[] = []
        if (labelIds?.length)
          whereClauses.push(inArray(labelTestMap.labelId, labelIds))

        if (platformIds?.length)
          whereClauses.push(inArray(tests.platformId, platformIds))

        if (priorityIds?.length)
          whereClauses.push(inArray(tests.priorityId, priorityIds))

        if (sectionIds?.length)
          andWhereCluase.push(inArray(tests.sectionId, sectionIds))

        if (squadIds)
          if (squadIds.length > 0) {
            if (squadIds.includes(0)) {
              whereClauses.push(
                or(
                  inArray(tests.squadId, squadIds),
                  sql`${tests.squadId} IS NULL`,
                ),
              )
            } else whereClauses.push(inArray(tests.squadId, squadIds))
          } else
            throw new Error('Empty squadIds provided', {
              cause: ErrorCause.INVALID_PARAMS,
            })

        const conditionType = filterType === 'or' ? or : and

        const testIds = await trx
          .select({testId: tests.testId})
          .from(tests)
          .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
          .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
          .groupBy(tests.testId)

        const testIdsSet = new Set(testIds.map((test) => test.testId))
        const testRunsData: ICreateTestRuns[] = []

        for (let testData of testIdsSet) {
          testRunsData.push({
            projectId: projectId,
            runId: runId,
            testId: testData,
          })
        }

        if (testRunsData.length === 0) {
          throw new Error('No tests found for the given filter')
        }

        const addToTestsRunMap = await trx
          .insert(testRunMap)
          .values(testRunsData)

        const runsAdded = addToTestsRunMap[0].affectedRows
        return {runId, runsAdded}
      })
      return resp
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while creating run',
        message: error,
      })
      errorHandling(error)
    }
  },

  getRunInfo: async ({runId, projectId}: IRunsMetaInfo) => {
    try {
      const whereClauses: any[] = [eq(runs.runId, runId)]
      if (projectId) whereClauses.push(eq(runs.projectId, projectId))

      return await dbClient
        .select()
        .from(runs)
        .where(and(...whereClauses))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching runs',
        message: error,
      })
      errorHandling(error)
    }
  },

  deleteRun: async ({
    runId,
    projectId,
    userId,
  }: {
    runId: number
    projectId: number
    userId: number
  }) => {
    try {
      const whereClauses: any[] = [
        eq(runs.runId, runId),
        eq(runs.projectId, projectId),
      ]

      return await dbClient
        .update(runs)
        .set({status: 'Deleted', updatedOn: new Date(), updatedBy: userId})
        .where(and(...whereClauses))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while deleting run',
        message: error,
      })
      errorHandling(error)
    }
  },

  lockRun: async ({
    runId,
    projectId,
    userId,
  }: {
    runId: number
    projectId: number
    userId: number
  }) => {
    try {
      const whereClauses: any[] = [
        eq(runs.runId, runId),
        eq(runs.projectId, projectId),
      ]

      return await dbClient
        .update(runs)
        .set({status: 'Locked', lockedBy: userId, lockedOn: new Date()})
        .where(and(...whereClauses))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while Locking run',
        message: error,
      })
      errorHandling(error)
    }
  },

  updateRun: async ({
    runId,
    runName,
    runDescription,
    projectId,
    userId,
  }: IUpdateRun) => {
    try {
      const whereClauses = [
        eq(runs.runId, runId),
        eq(runs.projectId, projectId),
      ]

      return dbClient
        .update(runs)
        .set({
          runName: runName,
          runDescription: runDescription,
          updatedBy: userId,
        })
        .where(and(...whereClauses))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while updating run',
        message: error,
      })
      errorHandling(error)
    }
  },
}

export default RunsDao
