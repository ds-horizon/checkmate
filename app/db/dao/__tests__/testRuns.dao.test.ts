import {testRunsStatusHistory} from '@schema/runs'

const orderBy = jest.fn()
const where = jest.fn(() => ({orderBy}))
const leftJoin = jest.fn(() => ({where}))
const from = jest.fn(() => ({leftJoin}))
const select = jest.fn(() => ({from}))

jest.mock('../../client', () => ({
  dbClient: {select},
}))

import TestRunsDao from '../testRuns.dao'

describe('TestRunsDao.getTestStatusHistoryOfRun', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    orderBy.mockResolvedValue([])
  })

  it('orders same-timestamp history entries by descending ID', async () => {
    await TestRunsDao.getTestStatusHistoryOfRun({runId: 7, testId: 42})

    expect(orderBy).toHaveBeenCalledTimes(1)
    expect(orderBy.mock.calls[0]).toHaveLength(2)
    expect(orderBy.mock.calls[0][0].queryChunks).toContain(
      testRunsStatusHistory.updatedOn,
    )
    expect(orderBy.mock.calls[0][0].queryChunks).toContainEqual(
      expect.objectContaining({value: [' desc']}),
    )
    expect(orderBy.mock.calls[0][1].queryChunks).toContain(
      testRunsStatusHistory.testRunsStatusHistoryId,
    )
    expect(orderBy.mock.calls[0][1].queryChunks).toContainEqual(
      expect.objectContaining({value: [' desc']}),
    )
  })
})
