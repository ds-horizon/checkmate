import {TestStatusQueryParams} from '@api/testStatus'
import {
  ITestsController,
  ITestsCountController,
} from '@controllers/tests.controller'
import {ITestRunData} from '@dao/testRuns.dao'
import {ErrorCause} from '~/constants'
import {MED_PAGE_SIZE} from './constants'
import {
  checkForProjectId,
  checkForRunId,
  checkForTestId,
  jsonParseWithError,
} from './utils'

interface ISearchParams {
  params: any
  request: Request
}

const SearchParams = {
  getTests: ({params, request}: ISearchParams): ITestsController => {
    const url = new URL(request.url)

    const searchParams = Object.fromEntries(url.searchParams.entries())

    const projectId = params?.projectId
      ? Number(params?.projectId)
      : Number(searchParams['projectId'])
    const squadIds = searchParams.squadIds
      ? jsonParseWithError(searchParams.squadIds, 'squadIds')
      : undefined
    const labelIds = searchParams.labelIds
      ? jsonParseWithError(searchParams.labelIds, 'labelIds')
      : undefined
    const platformIds = searchParams.platformIds
      ? jsonParseWithError(searchParams.platformIds, 'platformIds')
      : undefined
    const page = Number(url.searchParams.get('page')) || 1
    const pageSize = Number(url.searchParams.get('pageSize')) || 250
    const filterType = searchParams.filterType ? searchParams.filterType : 'and'

    const textSearch = searchParams.textSearch
      ? searchParams.textSearch
      : undefined

    const sectionIds = searchParams.sectionIds
      ? jsonParseWithError(searchParams.sectionIds, 'sectionIds')
      : undefined

    if (!checkForProjectId(projectId))
      throw new Error('Invalid projectId', {cause: ErrorCause.INVALID_PARAMS})

    if (!page || !pageSize)
      throw new Error('Invalid page or pageSize, provide valid entry', {
        cause: ErrorCause.INVALID_PARAMS,
      })

    const sortBy = searchParams.sortBy ? searchParams.sortBy : undefined
    const sortOrder = searchParams.sortOrder
      ? searchParams.sortOrder
      : undefined

    return {
      projectId,
      squadIds,
      labelIds,
      page,
      pageSize,
      textSearch,
      filterType: filterType as 'and' | 'or',
      sectionIds: sectionIds?.length ? sectionIds : undefined,
      sortBy,
      sortOrder: sortOrder as ITestRunData['sortOrder'],
      platformIds: platformIds?.length ? platformIds : undefined,
    }
  },

  getTestCount: ({params, request}: ISearchParams): ITestsCountController => {
    const url = new URL(request.url)

    const searchParams = Object.fromEntries(url.searchParams.entries())

    const projectId = params?.projectId ?? Number(searchParams['projectId'])

    const squadIds = searchParams.squadIds
      ? jsonParseWithError(searchParams.squadIds, 'squadIds')
      : undefined
    const labelIds = searchParams.labelIds
      ? jsonParseWithError(searchParams.labelIds, 'labelIds')
      : undefined
    const platformIds = searchParams.platformIds
      ? jsonParseWithError(searchParams.platformIds, 'platformIds')
      : undefined
    const priorityIds = searchParams.priorityIds
      ? jsonParseWithError(searchParams.priorityIds, 'priorityIds')
      : undefined
    const filterType = searchParams.filterType
      ? (searchParams.filterType as ITestsController['filterType'])
      : 'and'
    const includeTestIds = searchParams.includeTestIds
      ? searchParams.includeTestIds === 'true'
      : false

    if (!checkForProjectId(projectId))
      throw new Error('Invalid projectId', {cause: ErrorCause.INVALID_PARAMS})
    return {
      projectId,
      platformIds,
      squadIds,
      labelIds,
      priorityIds,
      filterType,
      includeTestIds,
    }
  },
  getRunTests: ({params, request}: ISearchParams): ITestRunData => {
    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams.entries())

    const projectId = params?.projectId
      ? Number(params?.projectId)
      : Number(searchParams['projectId'])
    const runId = params?.runId
      ? Number(params?.runId)
      : Number(searchParams['runId'])
    const squadIds = searchParams.squadIds
      ? jsonParseWithError(searchParams.squadIds, 'squadIds')
      : undefined
    const labelIds = searchParams.labelIds
      ? jsonParseWithError(searchParams.labelIds, 'labelIds')
      : undefined
    const platformIds = searchParams.platformIds
      ? jsonParseWithError(searchParams.platformIds, 'platformIds')
      : undefined
    const page = Number(url.searchParams.get('page')) || 1
    const pageSize = Number(url.searchParams.get('pageSize')) || 100
    const filterType = searchParams.filterType ? searchParams.filterType : 'and'
    const textSearch = searchParams.textSearch
      ? searchParams.textSearch
      : undefined
    const statusArray = searchParams.statusArray
      ? jsonParseWithError(searchParams.statusArray, 'statusArray')
      : undefined
    const sectionIds = searchParams.sectionIds
      ? jsonParseWithError(searchParams.sectionIds, 'sectionIds')
      : undefined
    const priorityIds = searchParams.priorityIds
      ? jsonParseWithError(searchParams.priorityIds, 'priorityIds')
      : undefined
    const automationStatusIds = searchParams.automationStatusIds
      ? jsonParseWithError(
          searchParams.automationStatusIds,
          'automationStatusIds',
        )
      : undefined
    const sortBy = searchParams.sortBy ? searchParams.sortBy : undefined
    const sortOrder = searchParams.sortOrder
      ? searchParams.sortOrder
      : undefined

    if (!checkForProjectId(projectId))
      throw new Error('Invalid projectId', {cause: ErrorCause.INVALID_PARAMS})

    if (!checkForProjectId(runId))
      throw new Error('Invalid runId', {cause: ErrorCause.INVALID_PARAMS})

    if (!page || !pageSize)
      throw new Error('Invalid page or pageSize, provide valid entry', {
        cause: ErrorCause.INVALID_PARAMS,
      })

    return {
      platformIds,
      runId,
      projectId,
      statusArray,
      squadIds,
      labelIds,
      page,
      pageSize,
      textSearch,
      filterType: filterType as 'and' | 'or',
      sectionIds,
      priorityIds,
      automationStatusIds,
      sortBy: sortBy as ITestRunData['sortBy'],
      sortOrder: sortOrder as ITestRunData['sortOrder'],
    }
  },
  getTestStatus: ({params, request}: ISearchParams): TestStatusQueryParams => {
    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams.entries())

    const projectId = params?.projectId
      ? Number(params?.projectId)
      : Number(searchParams['projectId'])
    const testId = params?.testId
      ? Number(params?.testId)
      : Number(searchParams['testId'])
    const runId = params?.runId
      ? Number(params?.runId)
      : Number(searchParams['runId'])

    if (!checkForProjectId(projectId))
      throw new Error('Invalid projectId', {cause: ErrorCause.INVALID_PARAMS})

    if (!checkForTestId(testId))
      throw new Error('Invalid testId', {cause: ErrorCause.INVALID_PARAMS})

    if (!checkForRunId(runId))
      throw new Error('Invalid runId', {cause: ErrorCause.INVALID_PARAMS})

    return {projectId, testId, runId}
  },
  getAllUsers: ({params, request}: ISearchParams) => {
    const url = new URL(request.url)
    const rawPage = url.searchParams.get('page')
    const rawPageSize = url.searchParams.get('pageSize')
    const page = rawPage ? Number(rawPage) : 1
    const pageSize = rawPageSize ? Number(rawPageSize) : MED_PAGE_SIZE
    const textSearch = url.searchParams.get('textSearch') || ''
    const userRoles = url.searchParams.get('userRoles')
      ? jsonParseWithError(url.searchParams.get('userRoles'), 'userRoles')
      : undefined

    if (page <= 0 || pageSize <= 0)
      throw new Error('Invalid page or pageSize, provide valid entry', {
        cause: ErrorCause.INVALID_PARAMS,
      })

    userRoles?.forEach((role: string) => {
      if (!['admin', 'user', 'reader'].includes(role)) {
        throw new Error('Invalid user role', {cause: ErrorCause.INVALID_PARAMS})
      }
    })

    return {
      page,
      pageSize,
      textSearch,
      userRoles,
    }
  },
  getSections: ({
    params,
    request,
  }: ISearchParams): {projectId: number; runId?: number} => {
    const url = new URL(request.url)

    const projectId = params.projectId
      ? Number(params.projectId)
      : Number(url.searchParams.get('projectId'))

    if (!checkForProjectId(projectId))
      throw new Error('Invalid projectId', {cause: ErrorCause.INVALID_PARAMS})

    const runId = params.runId
      ? Number(params.runId)
      : url.searchParams.get('runId')
      ? Number(url.searchParams.get('runId'))
      : undefined

    return {
      projectId,
      runId,
    }
  },
}

export default SearchParams
