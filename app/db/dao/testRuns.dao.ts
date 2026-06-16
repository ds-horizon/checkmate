import {
  IDeleteTestRun,
  IMarkPassedAsRetest,
  IRunsMetaInfo,
  ITestStatusHistory,
  ITestStatusHistoryRun,
} from '@controllers/testRuns.controller'
import {labels, labelTestMap} from '@schema/labels'
import {runs, testRunMap, testRunsStatusHistory} from '@schema/runs'
import {squads} from '@schema/squads'
import {
  automationStatus,
  automationStatus as automationTable,
  platform as platformTable,
  priority as priorityTable,
  sections,
  testCoveredBy,
  tests,
} from '@schema/tests'
import {users} from '@schema/users'
import {like, or} from 'drizzle-orm'
import {and, asc, count, desc, eq, inArray, sql, SQL} from 'drizzle-orm/sql'
import {TestStatusType} from '~/dataController/types'
import {logger, LogType} from '~/utils/logger'
import {dbClient} from '../client'
import {errorHandling, sortingFunction} from './utils'
import {ErrorCause} from '~/constants'

export type ICreateTestRuns = {
  runId: number
  testId: number
  projectId: number
}

interface IUpdateTestStatus {
  runId: number
  projectId?: number
  markStatusArray: {
    status: TestStatusType
    testId: number
    comment?: string
  }[]
  userId: number
}

export type ITestRunData = {
  runId: number
  projectId?: number
  statusArray?: string[]
  squadIds?: number[]
  labelIds?: number[]
  sectionIds?: number[]
  assignedTo?: string
  priorityIds?: number[]
  platformIds?: number[]
  automationStatusIds?: number[]
  pageSize: number
  page: number
  textSearch?: string
  sortOrder?: 'asc' | 'desc'
  sortBy?: string
  filterType?: 'and' | 'or'
}

const TestRunsDao = {
  getAllTestRuns: async (params: ITestRunData) => {
    try {
      const {
        runId,
        projectId,
        statusArray,
        squadIds,
        priorityIds,
        automationStatusIds,
        page,
        pageSize,
        textSearch,
        sectionIds,
        sortBy,
        sortOrder,
        filterType,
        labelIds,
        platformIds,
      } = params

      const andWhereCluase: any[] = [
        eq(testRunMap.runId, runId),
        eq(testRunMap.isIncluded, true),
      ]

      const whereClauses: any[] = []

      if (projectId) andWhereCluase.push(eq(testRunMap.projectId, projectId))

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

      if (labelIds)
        if (labelIds.length > 0)
          whereClauses.push(inArray(labelTestMap.labelId, labelIds))
        else
          throw new Error('Empty labelIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

      if (statusArray?.length)
        whereClauses.push(inArray(testRunMap.status, statusArray))

      if (sectionIds?.length)
        andWhereCluase.push(inArray(tests.sectionId, sectionIds))

      if (platformIds)
        if (platformIds.length > 0)
          whereClauses.push(inArray(tests.platformId, platformIds))
        else
          throw new Error('Empty platformIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })
      if (priorityIds?.length)
        whereClauses.push(inArray(tests.priorityId, priorityIds))

      if (automationStatusIds?.length)
        whereClauses.push(
          inArray(tests.automationStatusId, automationStatusIds),
        )

      if (textSearch) {
        andWhereCluase.push(
          or(
            like(tests.testId, `%${textSearch.toLowerCase()}%`),
            like(tests.title, `%${textSearch.toLowerCase()}%`),
          ),
        )
      }
      const conditionType = filterType === 'or' ? or : and

      const orderByClause = sortingFunction(sortBy, sortOrder)

      let testRunsQuery = dbClient
        .select({
          testStatus: sql`MAX(${testRunMap.status})`.as('testStatus'),
          testId: testRunMap.testId,
          priority: priorityTable.priorityName,
          title: tests.title,
          platform: platformTable.platformName,
          squadName: squads.squadName,
          sectionId: sections.sectionId,
          sectionName: sections.sectionName,
          sectionParentId: sections.parentId,
          runStatus: runs.status,
          testCoveredBy: testCoveredBy.testCoveredByName,
          testedBy: sql`MAX(${users.userName})`.as('testedBy'),
          automationStatus: automationTable.automationStatusName,
          createdByName: tests.createdByName,
          labelNames:
            sql`GROUP_CONCAT(${labels.labelName} ORDER BY ${labels.labelName} ASC)`.as(
              'labelNames',
            ),
          projectId: tests.projectId,
        })
        .from(testRunMap)
        .leftJoin(users, eq(testRunMap.updatedBy, users.userId))
        .leftJoin(runs, eq(testRunMap.runId, runs.runId))
        .leftJoin(tests, eq(testRunMap.testId, tests.testId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(priorityTable, eq(tests.priorityId, priorityTable.priorityId))
        .leftJoin(
          automationTable,
          eq(tests.automationStatusId, automationTable.automationStatusId),
        )
        .leftJoin(
          testCoveredBy,
          eq(tests.testCoveredById, testCoveredBy.testCoveredById),
        )
        .leftJoin(platformTable, eq(tests.platformId, platformTable.platformId))
        .leftJoin(labelTestMap, eq(testRunMap.testId, labelTestMap.testId))
        .leftJoin(labels, eq(labelTestMap.labelId, labels.labelId))
        .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
        .groupBy(testRunMap.testId)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(pageSize * (page - 1))
        .$dynamic()

      const testIdQuery = dbClient
        .select({testId: testRunMap.testId})
        .from(testRunMap)
        .leftJoin(tests, eq(testRunMap.testId, tests.testId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(platformTable, eq(tests.platformId, platformTable.platformId))
        .leftJoin(priorityTable, eq(tests.priorityId, priorityTable.priorityId))
        .leftJoin(
          automationTable,
          eq(tests.automationStatusId, automationTable.automationStatusId),
        )
        .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
        .groupBy(testRunMap.testId)
        .$dynamic()

      const countQuery = dbClient
        .select({count: count()})
        .from(sql`(${testIdQuery}) as testIdQuery`)

      const [testsList, totalCountResult] = await Promise.all([
        testRunsQuery.execute(),
        countQuery.execute(),
      ])

      return {testsList, totalCount: totalCountResult[0].count}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },

  updateStatusTestRuns: async (params: IUpdateTestStatus) => {
    try {
      const whereClauses: any[] = [
        eq(testRunMap.runId, params.runId),
        eq(testRunMap.isIncluded, true),
      ]

      if (params.projectId)
        whereClauses.push(eq(testRunMap.projectId, params.projectId))

      whereClauses.push(
        inArray(
          testRunMap.testId,
          params.markStatusArray.map((x) => x.testId),
        ),
      )

      if (params.markStatusArray && params.markStatusArray.length === 0) {
        throw new Error('No data provided to update status')
      }

      const statusSqlChunks: SQL[] = []
      statusSqlChunks.push(sql`(case`)

      const commentSqlChunks: SQL[] = []
      commentSqlChunks.push(sql`(case`)
      let isCommentPresent = false

      params.markStatusArray.forEach((item) => {
        statusSqlChunks.push(
          sql`when ${testRunMap.testId} = ${item.testId} then ${item.status}`,
        )
        if (item?.comment) {
          commentSqlChunks.push(
            sql`when ${testRunMap.testId} = ${item.testId} then ${item.comment}`,
          )
          isCommentPresent = true
        }
      })

      statusSqlChunks.push(sql`end)`)
      commentSqlChunks.push(sql`end)`)
      const finalStatusSqlChunks: SQL = sql.join(statusSqlChunks, sql.raw(' '))
      const finalCommentSql: SQL = isCommentPresent
        ? sql.join(commentSqlChunks, sql.raw(' '))
        : sql`''`

      const data = dbClient
        .update(testRunMap)
        .set({
          status: finalStatusSqlChunks,
          comment: finalCommentSql,
          updatedOn: new Date(),
          updatedBy: params.userId,
        })
        .where(and(...whereClauses))

      const logsInsertion: (typeof testRunsStatusHistory.$inferInsert)[] =
        params.markStatusArray.map((item) => {
          return {
            status: item.status as string,
            runId: params.runId,
            testId: item.testId,
            updatedBy: params.userId,
            updatedOn: new Date(),
            comment: item.comment,
          }
        })

      dbClient
        .execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
        .then((_) => {
          dbClient
            .insert(testRunsStatusHistory)
            .values(logsInsertion)
            .execute()
            .then((res) => {
              logger({
                type: LogType.INFO,
                tag: 'testRunsStatusHistory',
                message: `Test run updation logs added in testRunsStatusHistory table, No. of rows added: ${res?.[0]?.affectedRows}`,
              })
              dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
            })
            .catch((err) => {
              logger({
                type: LogType.SQL_ERROR,
                tag: 'Error while adding logs testRunsStatusHistory',
                message: err,
              })
              dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
            })
        })
        .catch((_) => {
          dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
        })

      return await data.execute()
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while updating status',
        message: error,
      })
      errorHandling(error)
    }
  },

  runsMetaInfo: async (params: IRunsMetaInfo) => {
    try {
      const whereClauses: any[] = [
        eq(testRunMap.runId, params.runId),
        eq(testRunMap.isIncluded, true),
      ]

      if (params.projectId)
        whereClauses.push(eq(testRunMap.projectId, params.projectId))

      const statuCountArrayQuery = dbClient
        .select({
          status: testRunMap.status,
          status_count: count(),
        })
        .from(testRunMap)
        .where(and(...whereClauses))
        .groupBy(testRunMap.status)

      if (params.groupBy) {
        const groupByCountQuery = dbClient
          .select({
            squadName: sql<string>`COALESCE(${squads.squadName}, 'None')`.as(
              'squadName',
            ),
            squadId: sql<number>`COALESCE(${squads.squadId}, 0)`.as('squadId'),
            status: testRunMap.status,
            status_count: count(),
          })
          .from(testRunMap)
          .leftJoin(tests, eq(testRunMap.testId, tests.testId))
          .leftJoin(squads, eq(tests.squadId, squads.squadId))
          .where(and(...whereClauses))
          .groupBy(squads.squadId, squads.squadName, testRunMap.status)

        const [statuCountArray, groupByData] = await Promise.all([
          statuCountArrayQuery.execute(),
          groupByCountQuery.execute(),
        ])

        return {statuCountArray, groupByData}
      }

      const statuCountArray = await statuCountArrayQuery.execute()
      return {statuCountArray}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },

  getTestStatusHistoryOfRun: async (param: ITestStatusHistoryRun) => {
    try {
      const whereClauses = [
        eq(testRunsStatusHistory.runId, param.runId),
        eq(testRunsStatusHistory.testId, param.testId),
      ]

      return await dbClient
        .select({
          status: testRunsStatusHistory.status,
          updatedBy: users.userName,
          updatedOn: testRunsStatusHistory.updatedOn,
          comment: testRunsStatusHistory.comment,
        })
        .from(testRunsStatusHistory)
        .leftJoin(users, eq(users.userId, testRunsStatusHistory.updatedBy))
        .where(and(...whereClauses))
        .orderBy(desc(testRunsStatusHistory.updatedOn))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },

  testStatusHistory: async (params: ITestStatusHistory) => {
    try {
      return await dbClient
        .select({
          runName: runs.runName,
          status: testRunMap.status,
          updatedBy: users.userName,
          updatedOn: testRunMap.updatedOn,
          comment: testRunMap.comment,
        })
        .from(testRunMap)
        .leftJoin(users, eq(users.userId, testRunMap.updatedBy))
        .leftJoin(runs, eq(runs.runId, testRunMap.runId))
        .where(eq(testRunMap.testId, params.testId))
        .orderBy(desc(testRunMap.updatedOn))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },

  deleteTestFromRun: async ({
    testIds,
    runId,
    projectId,
    updatedBy,
  }: IDeleteTestRun) => {
    try {
      const whereClauses = [
        inArray(testRunMap.testId, testIds),
        eq(testRunMap.runId, runId),
        eq(testRunMap.projectId, projectId),
      ]
      return await dbClient
        .update(testRunMap)
        .set({isIncluded: false, updatedBy: updatedBy})
        .where(and(...whereClauses))
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while Deleting Test from run',
        message: error,
      })
      errorHandling(error)
    }
  },

  markPassedAsRetest: async (params: IMarkPassedAsRetest) => {
    try {
      const whereClauses = [
        eq(testRunMap.runId, params.runId),
        eq(testRunMap.status, TestStatusType.Passed),
        eq(testRunMap.isIncluded, true),
      ]

      const testIds = await dbClient
        .select({testId: testRunMap.testId})
        .from(testRunMap)
        .where(and(...whereClauses))

      const filteredTestIds: number[] = []

      for (let i = 0; i < testIds?.length; i++) {
        const testId = testIds?.[i]?.testId
        if (!!testId && testId !== null) {
          filteredTestIds.push(testId)
        }
      }

      const data = await dbClient
        .update(testRunMap)
        .set({
          status: TestStatusType.Retest,
          updatedOn: new Date(),
          updatedBy: params.userId,
        })
        .where(
          and(
            inArray(testRunMap.testId, filteredTestIds),
            eq(testRunMap.runId, params.runId),
          ),
        )

      const logsInsertion: (typeof testRunsStatusHistory.$inferInsert)[] =
        filteredTestIds.map((testId) => {
          return {
            status: TestStatusType.Retest,
            runId: params.runId,
            testId: testId,
            updatedBy: params.userId,
            updatedOn: new Date(),
          }
        })

      dbClient
        .execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
        .then((_) => {
          dbClient
            .insert(testRunsStatusHistory)
            .values(logsInsertion)
            .execute()
            .then((res) => {
              logger({
                type: LogType.INFO,
                tag: 'testRunsStatusHistory',
                message: `Test run updation logs added in testRunsStatusHistory table, No. of rows added: ${res?.[0]?.affectedRows}`,
              })
              dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
            })
            .catch((err) => {
              logger({
                type: LogType.SQL_ERROR,
                tag: 'Error while adding logs testRunsStatusHistory',
                message: err,
              })
              dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
            })
        })
        .catch((_) => {
          dbClient.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
        })

      return {testIds: filteredTestIds, data}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while updating status',
        message: error,
      })
      errorHandling(error)
    }
  },

  downloadReport: async ({runId}: {runId: number}) => {
    try {
      const whereClauses = [
        eq(testRunMap.runId, runId),
        eq(testRunMap.isIncluded, true),
      ]

      const testRuns = await dbClient
        .select({
          TestId: testRunMap.testId,
          Title: tests.title,
          Status: testRunMap.status,
          Comment: testRunMap.comment,
          'Tested By': users.userName,
          'Tested On': testRunMap.updatedOn,
          Priority: priorityTable.priorityName,
          Squad: squads.squadName,
          Section: sections.sectionName,
          Platform: platformTable.platformName,
          'Automation Status': automationStatus.automationStatusName,
          'Test Covered By': testCoveredBy.testCoveredByName,
        })
        .from(testRunMap)
        .leftJoin(users, eq(testRunMap.updatedBy, users.userId))
        .leftJoin(tests, eq(testRunMap.testId, tests.testId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(priorityTable, eq(tests.priorityId, priorityTable.priorityId))
        .leftJoin(platformTable, eq(tests.platformId, platformTable.platformId))
        .leftJoin(
          automationStatus,
          eq(tests.automationStatusId, automationStatus.automationStatusId),
        )
        .leftJoin(
          testCoveredBy,
          eq(tests.testCoveredById, testCoveredBy.testCoveredById),
        )
        .where(and(...whereClauses))
        .orderBy(asc(testRunMap.testId))
        .execute()

      return testRuns
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },
}

export default TestRunsDao
