import {defectCycles} from '@schema/resultRevisions'

const execute = jest.fn()
const query: Record<string, jest.Mock> = {execute}
type Projection = Record<string, {sql: {queryChunks: unknown[]}}>

const staticSqlText = (field: Projection[string]) =>
  field.sql.queryChunks
    .flatMap((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) {
        return []
      }
      return Array.isArray(chunk.value) ? chunk.value : []
    })
    .join('')

for (const method of [
  'from',
  'leftJoin',
  'where',
  'groupBy',
  'orderBy',
  'limit',
  'offset',
  '$dynamic',
]) {
  query[method] = jest.fn(() => query)
}

const select = jest.fn((_projection?: Projection) => query)

jest.mock('../../client', () => ({
  dbClient: {select},
}))

import TestRunsDao from '../testRuns.dao'

describe('TestRunsDao.getAllTestRuns Plane projection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{count: 0}])
  })

  it('selects linkage only for an unambiguous active defect cycle', async () => {
    await TestRunsDao.getAllTestRuns({
      runId: 7,
      page: 1,
      pageSize: 20,
    })

    const projection = select.mock.calls[0][0]
    if (!projection) throw new Error('Expected a test-run projection')
    expect(projection.planeDefectState.sql.queryChunks).toContain(
      defectCycles.state,
    )
    expect(staticSqlText(projection.planeDefectState)).toContain(
      'WHEN COUNT(DISTINCT',
    )
    expect(projection.planeDefectUrl.sql.queryChunks).toContain(
      defectCycles.providerUrl,
    )
    expect(staticSqlText(projection.planeDefectUrl)).toContain(
      'WHEN COUNT(DISTINCT',
    )
    expect(
      query.leftJoin.mock.calls.some(([table]) => table === defectCycles),
    ).toBe(true)
  })
})
