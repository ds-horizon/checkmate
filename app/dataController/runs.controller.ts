import RunsDao from '@dao/runs.dao'
import {runs} from '@schema/runs'
import {IRunsMetaInfo} from './testRuns.controller'

export type RunsStatus = (typeof runs.$inferSelect)['status']

export interface IGetAllRuns {
  projectId: number
  pageSize?: number
  page?: number
  search?: string
  status?: RunsStatus
}

export interface ICreateRuns {
  projectId: number
  runName: string
  runDescription?: string | null
  labelIds?: number[] | null
  squadIds?: number[] | null
  sectionIds?: number[] | null
  createdBy: number
  filterType?: 'and' | 'or'
  platformIds?: number[] | null
  priorityIds?: number[] | null
}

export interface IUpdateRun {
  runId: number
  runName: string
  runDescription: string
  projectId: number
  userId: number
}

const RunsController = {
  getAllRuns: (params: IGetAllRuns) => RunsDao.getAllRuns(params),
  createRun: (params: ICreateRuns) => RunsDao.createRun(params),
  getRunInfo: (param: IRunsMetaInfo) => RunsDao.getRunInfo(param),
  deleteRun: (param: {runId: number; projectId: number; userId: number}) =>
    RunsDao.deleteRun(param),
  lockRun: (param: {runId: number; projectId: number; userId: number}) =>
    RunsDao.lockRun(param),
  updateRun: (param: IUpdateRun) => RunsDao.updateRun(param),
}

export default RunsController
