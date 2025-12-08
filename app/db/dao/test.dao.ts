import {
  IBulkDeleteTests,
  ICreateTestController,
  IDeleteTestController,
  ITestsController,
  ITestsCountController,
  ITestStatus,
  IUpdateLabelTestMapController,
  IUpdateTestController,
  IUpdateTests,
} from '@controllers/tests.controller'
import {labels, labelTestMap} from '@schema/labels'
import {runs, testRunMap} from '@schema/runs'
import {squads} from '@schema/squads'
import {
  automationStatus,
  platform,
  priority,
  sections,
  testCoveredBy,
  tests,
  type,
} from '@schema/tests'
import {users} from '@schema/users'
import {count, like, or, sql} from 'drizzle-orm'
import {and, eq, inArray} from 'drizzle-orm/sql'
import {ErrorCause} from '~/constants'
import {logger, LogType} from '~/utils/logger'
import {dbClient} from '../client'
import {errorHandling, sortingFunction} from './utils'
import {alias} from 'drizzle-orm/mysql-core'

export type IBulkAddTestsDao = typeof tests.$inferInsert

const TestsDao = {
  async getTests(params: ITestsController) {
    const {
      projectId,
      labelIds,
      squadIds,
      sectionIds,
      page,
      pageSize = 10,
      textSearch,
      filterType,
      status = 'Active',
      sortBy,
      sortOrder,
      platformIds,
    } = params

    try {
      const andWhereCluase: any[] = [
        eq(tests.projectId, projectId),
        eq(tests.status, status),
      ]
      const whereClauses: any[] = []

      if (labelIds)
        if (labelIds.length > 0)
          whereClauses.push(inArray(labelTestMap.labelId, labelIds))
        else
          throw new Error('Empty labelIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })
      if (platformIds)
        if (platformIds.length > 0)
          whereClauses.push(inArray(tests.platformId, platformIds))
        else
          throw new Error('Empty platformIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

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

      if (textSearch) {
        andWhereCluase.push(
          or(
            like(tests.testId, `%${textSearch}%`),
            like(tests.title, `%${textSearch.toLowerCase()}%`),
          ),
        )
      }

      if (sectionIds && sectionIds?.length)
        andWhereCluase.push(inArray(tests.sectionId, sectionIds))

      const conditionType = filterType === 'or' ? or : and

      const orderByClause = sortingFunction(sortBy, sortOrder)

      const testsData = await dbClient
        .select({
          title: tests.title,
          testId: tests.testId,
          squadId: tests.squadId,
          priority: priority.priorityName,
          automationStatus: automationStatus.automationStatusName,
          createdByName: tests.createdByName,
          testCoveredBy: testCoveredBy.testCoveredByName,
          createdOn: tests.createdOn,
          squadName: squads.squadName,
          platform: platform.platformName,
          labelName:
            sql`GROUP_CONCAT(${labels.labelName} ORDER BY ${labels.labelName} ASC)`.as(
              'labelNames',
            ),
          refCreatedByName: users.userName,
          projectId: tests.projectId,
          section: sections.sectionName,
          sectionId: sections.sectionId,
          sectionParentId: sections.parentId,
        })
        .from(tests)
        .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(labels, eq(labelTestMap.labelId, labels.labelId))
        .leftJoin(users, eq(tests.createdBy, users.userId))
        .leftJoin(priority, eq(tests.priorityId, priority.priorityId))
        .leftJoin(
          automationStatus,
          eq(tests.automationStatusId, automationStatus.automationStatusId),
        )
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(
          testCoveredBy,
          eq(tests.testCoveredById, testCoveredBy.testCoveredById),
        )
        .leftJoin(platform, eq(tests.platformId, platform.platformId))
        .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
        .groupBy(tests.testId)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .$dynamic()

      return testsData
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching tests list',
        message: `${error.message}  ${error.cause}`,
      })
      errorHandling(error)
    }
  },

  async getTestsCount({
    projectId,
    labelIds,
    squadIds,
    filterType,
    includeTestIds = false,
    status = 'Active',
    textSearch,
    sectionIds,
    platformIds,
    priorityIds,
  }: ITestsCountController) {
    try {
      const andWhereCluase: any[] = [
        eq(tests.projectId, projectId),
        eq(tests.status, status),
      ]

      if (sectionIds && sectionIds.length > 0) {
        andWhereCluase.push(inArray(tests.sectionId, sectionIds))
      }

      let whereClauses: any[] = []

      if (labelIds)
        if (labelIds.length > 0)
          whereClauses.push(inArray(labelTestMap.labelId, labelIds))
        else
          throw new Error('Empty labelIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

      if (platformIds)
        if (platformIds.length > 0)
          whereClauses.push(inArray(tests.platformId, platformIds))
        else
          throw new Error('Empty platformIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

      if (priorityIds)
        if (priorityIds.length > 0)
          whereClauses.push(inArray(tests.priorityId, priorityIds))
        else
          throw new Error('Empty priorityIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

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

      if (textSearch) {
        andWhereCluase.push(
          or(
            like(tests.testId, `%${textSearch}%`),
            like(tests.title, `%${textSearch.toLowerCase()}%`),
          ),
        )
      }

      const conditionType = filterType === 'or' ? or : and

      const testIdQuery = dbClient
        .select({
          testId: tests.testId,
        })
        .from(tests)
        .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
        .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
        .groupBy(tests.testId)

      const countQuery = dbClient
        .select({count: count()})
        .from(sql`(${testIdQuery}) as testIdQuery`)

      if (includeTestIds) {
        const [result, testIds] = await Promise.all([
          await countQuery.execute(),
          await testIdQuery.execute(),
        ])
        return {count: result[0].count, testIds}
      } else {
        const result = await countQuery.execute()
        return {count: result[0].count}
      }
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Fetching tests count',
        message: error,
      })
      errorHandling(error)
    }
  },

  async updateTests(params: IUpdateTests) {
    try {
      const whereClauses: any[] = [inArray(tests.testId, params.testIds)]
      if (params.projectId)
        whereClauses.push(eq(tests.projectId, params.projectId))
      const updateObject: Partial<typeof tests.$inferInsert> = {
        [params.property]: params.value,
        updatedOn: new Date(),
        updatedBy: params.userId,
      }

      const updateData = await dbClient
        .update(tests)
        .set(updateObject)
        .where(and(...whereClauses))
        .execute()
      return updateData[0]
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Updating tests',
        message: error,
      })
      errorHandling(error)
    }
  },

  async createTest(
    params: Omit<ICreateTestController, 'new_section' | 'new_squad'>,
  ) {
    try {
      const createTestResp = await dbClient.insert(tests).values(params)
      const testId = createTestResp[0].insertId
      const testData = createTestResp[0].affectedRows
      return {testData, testId}
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Create new test',
        message: error,
      })
      errorHandling(error)
    }
  },

  async deleteTest(params: IDeleteTestController) {
    try {
      const testId = params.testId

      const deleteTestResp = await dbClient
        .update(tests)
        .set({status: 'Deleted', updatedBy: params.userId})
        .where(eq(tests.testId, testId))
      const testData = deleteTestResp[0].affectedRows
      return {testData}
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Delete new test',
        message: error,
      })
      errorHandling(error)
    }
  },

  async updateTest(
    params: Omit<IUpdateTestController, 'new_section' | 'new_squad'>,
  ) {
    try {
      const testId = params.testId
      const updateTestResp = await dbClient
        .update(tests)
        .set(params)
        .where(eq(tests.testId, testId))
      const testData = updateTestResp[0].affectedRows
      return {testData}
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Update new test',
        message: error,
      })
      errorHandling(error)
    }
  },

  async updateLabelTestMap(params: IUpdateLabelTestMapController) {
    try {
      const testId = params.testId

      const resp = await dbClient.transaction(async (trx) => {
        const deleteLabelTestMap = trx
          .delete(labelTestMap)
          .where(eq(labelTestMap.testId, testId))

        await deleteLabelTestMap.execute()

        const insertData =
          params?.labelIds?.map((labelId) => ({
            labelId,
            testId: params.testId,
            createdBy: params.createdBy,
            projectId: params.projectId,
          })) ?? []
        if (insertData.length > 0)
          await trx.insert(labelTestMap).values(insertData)
        return {message: 'Updated Label Test Map successfully'}
      })

      return resp
    } catch (error: any) {
      // FOR DEV PURPOSES
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Update Label test map',
        message: error,
      })
      errorHandling(error)
    }
  },

  async bulkAddTests({
    insertTest,
    labelIds,
    projectId,
    createdBy,
  }: {
    insertTest: IBulkAddTestsDao[]
    labelIds?: number[]
    projectId: number
    createdBy: number
  }) {
    try {
      if (insertTest.length === 0) {
        throw new Error('No test data provided', {
          cause: ErrorCause.INVALID_PARAMS,
        })
      }

      const resp = await dbClient.insert(tests).values(insertTest)
      const ids = insertTest[0]?.testId
        ? insertTest.filter((item) => !!item.testId).map((item) => item.testId)
        : []

      const testIds: (number | undefined)[] =
        ids?.length > 0
          ? ids
          : Array.from(
              {length: resp?.[0].affectedRows},
              (_, j) => resp?.[0].insertId + j,
            )

      const numberOfTestsAdded = resp?.[0].affectedRows
      if (labelIds && labelIds.length > 0) {
        for (const testId of testIds) {
          if (!testId) continue
          for (const labelId of labelIds) {
            await dbClient
              .insert(labelTestMap)
              .values({
                labelId,
                testId,
                projectId,
                createdBy,
              })
              .execute()
          }
        }
      }

      return {
        testIds: testIds,
        testsAdded: numberOfTestsAdded
          ? `${numberOfTestsAdded} tests added`
          : 'No tests added',
      }
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Updating tests',
        message: error,
      })
      errorHandling(error)
    }
  },

  getTestDetails: async ({
    projectId,
    testId,
  }: {
    projectId: number
    testId: number
  }) => {
    try {
      const usersAlias = alias(users, 'usersAlias')

      const result = await dbClient
        .select({
          testId: tests.testId,
          title: tests.title,
          section: sections.sectionName,
          squad: squads.squadName,
          priority: priority.priorityName,
          automationStatus: automationStatus.automationStatusName,
          type: type.typeName,
          platform: platform.platformName,
          testCoveredBy: testCoveredBy.testCoveredByName,
          jiraTicket: tests.jiraTicket,
          defects: tests.defects,
          preConditions: tests.preConditions,
          steps: tests.steps,
          expectedResult: tests.expectedResult,
          sectionId: sections.sectionId,
          sectionParentId: sections.parentId,
          automationId: tests.automationId,
          additionalGroups: tests.additionalGroups,
          labelNames:
            sql`GROUP_CONCAT(${labels.labelName} ORDER BY ${labels.labelName} ASC)`.as(
              'labelNames',
            ),
          description: tests.description,
          createdBy: users.userName,
          createdOn: tests.createdOn,
          updatedBy: usersAlias.userName,
          updatedOn: tests.updatedOn,
        })
        .from(tests)
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(priority, eq(tests.priorityId, priority.priorityId))
        .leftJoin(
          automationStatus,
          eq(tests.automationStatusId, automationStatus.automationStatusId),
        )
        .leftJoin(type, eq(tests.typeId, type.typeId))
        .leftJoin(platform, eq(tests.platformId, platform.platformId))
        .leftJoin(
          testCoveredBy,
          eq(tests.testCoveredById, testCoveredBy.testCoveredById),
        )
        .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
        .leftJoin(labels, eq(labelTestMap.labelId, labels.labelId))
        .leftJoin(users, eq(tests.createdBy, users.userId))
        .leftJoin(usersAlias, eq(tests.updatedBy, usersAlias.userId))

        .where(and(eq(tests.testId, testId), eq(tests.projectId, projectId)))

      return result[0]
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching test details',
        message: error,
      })
      errorHandling(error)
    }
  },
  getTestStatus: async ({projectId, runId, testId}: ITestStatus) => {
    try {
      const result = await dbClient
        .select({
          status: testRunMap.status,
          runStatus: runs.status,
        })
        .from(testRunMap)
        .leftJoin(runs, eq(testRunMap.runId, runs.runId))
        .where(
          and(
            eq(testRunMap.projectId, projectId),
            eq(testRunMap.runId, runId),
            eq(testRunMap.testId, testId),
          ),
        )

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching sections',
        message: error,
      })
      errorHandling(error)
    }
  },
  async downloadTests(params: ITestsController) {
    const {
      projectId,
      labelIds,
      squadIds,
      sectionIds,
      textSearch,
      filterType,
      status = 'Active',
      sortBy,
      sortOrder,
    } = params

    try {
      const andWhereCluase: any[] = [
        eq(tests.projectId, projectId),
        eq(tests.status, status),
      ]

      const whereClauses: any[] = []

      if (labelIds)
        if (labelIds.length > 0)
          whereClauses.push(inArray(labelTestMap.labelId, labelIds))
        else
          throw new Error('Empty labelIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

      if (squadIds)
        if (squadIds.length > 0)
          whereClauses.push(inArray(tests.squadId, squadIds))
        else
          throw new Error('Empty squadIds provided', {
            cause: ErrorCause.INVALID_PARAMS,
          })

      if (textSearch) {
        andWhereCluase.push(
          or(
            like(tests.testId, `%${textSearch}%`),
            like(tests.title, `%${textSearch.toLowerCase()}%`),
          ),
        )
      }

      if (sectionIds && sectionIds?.length)
        andWhereCluase.push(inArray(tests.sectionId, sectionIds))

      const conditionType = filterType === 'or' ? or : and

      const orderByClause = sortingFunction(sortBy, sortOrder)
      const testsData = await dbClient
        .select({
          testId: tests.testId,
          title: tests.title,
          squadId: tests.squadId,
          priority: priority.priorityName,
          automationStatus: automationStatus.automationStatusName,
          createdByName: tests.createdByName,
          testCoveredBy: testCoveredBy.testCoveredByName,
          createdOn: tests.createdOn,
          squadName: squads.squadName,
          platform: platform.platformName,
          labelName:
            sql`GROUP_CONCAT(${labels.labelName} ORDER BY ${labels.labelName} ASC)`.as(
              'labelNames',
            ),
          refCreatedByName: users.userName,
          projectId: tests.projectId,
          section: sections.sectionName,
          sectionId: sections.sectionId,
          sectionParentId: sections.parentId,
        })
        .from(tests)
        .leftJoin(labelTestMap, eq(tests.testId, labelTestMap.testId))
        .leftJoin(squads, eq(tests.squadId, squads.squadId))
        .leftJoin(labels, eq(labelTestMap.labelId, labels.labelId))
        .leftJoin(users, eq(tests.createdBy, users.userId))
        .leftJoin(priority, eq(tests.priorityId, priority.priorityId))
        .leftJoin(
          automationStatus,
          eq(tests.automationStatusId, automationStatus.automationStatusId),
        )
        .leftJoin(sections, eq(tests.sectionId, sections.sectionId))
        .leftJoin(
          testCoveredBy,
          eq(tests.testCoveredById, testCoveredBy.testCoveredById),
        )
        .leftJoin(platform, eq(tests.platformId, platform.platformId))
        .where(and(and(...andWhereCluase), conditionType(...whereClauses)))
        .groupBy(tests.testId)
        .orderBy(orderByClause)
        .$dynamic()

      return testsData
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error while fetching tests list',
        message: `${error.message}  ${error.cause}`,
      })
      errorHandling(error)
    }
  },

  bulkDeleteTests: async ({testIds, userId}: IBulkDeleteTests) => {
    try {
      if (!testIds.length) {
        throw new Error('No testIds provided', {
          cause: ErrorCause.INVALID_PARAMS,
        })
      }

      const updateData: Partial<typeof tests.$inferInsert> = {
        status: 'Deleted',
        updatedBy: userId,
        updatedOn: new Date(),
      }

      const data = await dbClient
        .update(tests)
        .set(updateData)
        .where(inArray(tests.testId, testIds))
        .execute()

      return data[0]
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'Error deleting bulk tests',
        message: `${error.message}  ${error.cause}`,
      })
      errorHandling(error)
    }
  },
}

export default TestsDao
