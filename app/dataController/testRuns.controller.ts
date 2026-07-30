import {UpdateStatusTestRunsRequestAPIType} from '@api/updateStatusTestRuns'
import RunsDao from '~/db/dao/runs.dao'
import TestRunsDao, {ITestRunData} from '~/db/dao/testRuns.dao'
import {TestStatusType} from './types'
import {isValidStatus, transformSquadWiseRunData} from './utils'

export interface ITestStatusHistoryRun {
  runId: number
  testId: number
}

export interface ITestStatusHistory {
  testId: number
}

export interface IStatusUpdateResponse {
  passed: {message: string; count: number} | undefined
  failed:
    | {
        message: string
        count: number
        details: {id?: number; message: string}[]
      }
    | undefined
}

export interface IMarkPassedAsRetest {
  runId: number
  userId: number
}

export interface IRunsMetaInfo {
  runId: number
  projectId?: number
  groupBy?: 'squads'
}

export interface IDeleteTestRun {
  testIds: number[]
  runId: number
  projectId: number
  updatedBy: number
}

interface AffectedRowQueryResponse {
  fieldCount: number
  affectedRows: number
  insertId: number
  info: string
  serverStatus: number
  warningStatus: number
  changedRows: number
}

export type AffectedRowQueryResult = [AffectedRowQueryResponse, null]

const TestRunsController = {
  getAllTestRuns: async (params: ITestRunData) =>
    TestRunsDao.getAllTestRuns(params),

  updateStatusTestRuns: async ({
    runId,
    testIdStatusArray,
    projectId,
    userId,
    comment,
  }: UpdateStatusTestRunsRequestAPIType): Promise<IStatusUpdateResponse> => {
    if (testIdStatusArray.length === 0)
      throw new Error('No data provided to update status')

    const updateStatusResp: IStatusUpdateResponse = {
      passed: undefined,
      failed: undefined,
    }

    const testIdArray = []
    for (let item of testIdStatusArray) {
      if (item.testId === undefined) {
        if (updateStatusResp.failed === undefined)
          updateStatusResp.failed = {message: '', count: 0, details: []}
        updateStatusResp.failed.details.push({
          message: 'testId missing',
        })
        continue
      }

      if (!isValidStatus(item.status)) {
        const statusString = Object.values(TestStatusType).join(', ')
        if (updateStatusResp.failed === undefined)
          updateStatusResp.failed = {message: '', count: 0, details: []}
        updateStatusResp.failed.details.push({
          message: `Invalid status provided, provide one of {${statusString}}`,
          id: item.testId,
        })
        continue
      }

      if (item.testId) {
        testIdArray.push({
          testId: item.testId,
          status: item.status as TestStatusType,
          comment: item?.comment ?? comment,
          attachments: item?.attachments,
        })
        continue
      }
    }

    const resp = await TestRunsDao.updateStatusTestRuns({
      runId,
      markStatusArray: testIdArray,
      projectId,
      userId: userId,
    })

    if (resp?.[0]?.affectedRows) {
      updateStatusResp.passed = {
        message: `Updated status of ${resp?.[0]?.affectedRows} test(s)`,
        count: resp?.[0]?.affectedRows,
      }

      if (resp?.[0]?.affectedRows !== testIdStatusArray.length) {
        updateStatusResp.passed = {
          message: `Updated status of ${resp?.[0]?.affectedRows} test(s)`,
          count: resp?.[0]?.affectedRows,
        }

        if (updateStatusResp.failed === undefined)
          updateStatusResp.failed = {message: '', count: 0, details: []}

        updateStatusResp.failed.message = `${
          testIdStatusArray.length - resp?.[0]?.affectedRows
        } test(s) failed to update`
        updateStatusResp.failed.count =
          testIdStatusArray.length - resp?.[0]?.affectedRows
      }
    } else {
      if (updateStatusResp.failed === undefined)
        updateStatusResp.failed = {message: '', count: 0, details: []}

      updateStatusResp.failed.message = `${testIdStatusArray.length} test(s) failed to update`
      updateStatusResp.failed.count = testIdStatusArray.length
    }

    return updateStatusResp
  },

  runsMetaInfo: async ({runId, projectId, groupBy}: IRunsMetaInfo) => {
    const metaInfo = await TestRunsDao.runsMetaInfo({runId, projectId, groupBy})

    const runsMetaInfo: any = {total: 0}

    Object.values(TestStatusType).map((status) => {
      const statusString = status.toLowerCase()
      runsMetaInfo[statusString] = 0
    })

    const statuCountArray = metaInfo?.statuCountArray

    if (statuCountArray === undefined) return {status: 'Error in fetching data'}

    if (statuCountArray.length === 0) {
      const data = await RunsDao.getRunInfo({runId, projectId})
      if (data && data.length === 0) {
        return {status: 'Provide valid runId'}
      }
    }

    let total = 0
    for (let item of statuCountArray) {
      const statusString = item.status.toLowerCase()
      runsMetaInfo[statusString] = item.status_count
      total += item.status_count
    }

    runsMetaInfo.total = total

    if (groupBy) {
      const groupByData = metaInfo?.groupByData
      if (groupByData !== undefined) {
        runsMetaInfo['squadData'] = transformSquadWiseRunData(groupByData)
      }
    }

    return runsMetaInfo
  },

  getTestStatusHistoryOfRun: async (param: ITestStatusHistoryRun) =>
    TestRunsDao.getTestStatusHistoryOfRun(param),

  testStatusHistory: async (param: ITestStatusHistory) =>
    TestRunsDao.testStatusHistory(param),

  deleteTestFromRun: (param: IDeleteTestRun) =>
    TestRunsDao.deleteTestFromRun(param),

  markPassedAsRetest: (param: IMarkPassedAsRetest) =>
    TestRunsDao.markPassedAsRetest(param),
  downloadReport: async ({runId}: {runId: number}) => {
    return TestRunsDao.downloadReport({runId})
  },
}

export default TestRunsController
