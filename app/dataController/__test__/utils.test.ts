import SectionsController from '@controllers/sections.controller'
import SquadsController from '@controllers/squads.controller'
import {
  isValidStatus,
  transformSquadWiseRunData,
  handleNewSectionAndSquad,
} from '@controllers/utils'

jest.mock('@controllers/sections.controller', () => ({
  createSectionFromHierarchy: jest.fn(),
}))

jest.mock('@controllers/squads.controller', () => ({
  checkAndCreateSquad: jest.fn(),
}))

describe('isValidStatus', () => {
  test('should return true for valid statuses', () => {
    expect(isValidStatus('Passed')).toBe(true)
    expect(isValidStatus('Failed')).toBe(true)
    expect(isValidStatus('Untested')).toBe(true)
  })

  test('should return false for invalid statuses', () => {
    expect(isValidStatus(undefined)).toBe(false)
    expect(isValidStatus('InvalidStatus')).toBe(false)
  })
})

describe('transformSquadWiseRunData', () => {
  test('should transform data correctly', () => {
    const input = [
      {squadName: 'Alpha', squadId: 1, status: 'Passed', status_count: 3},
      {squadName: 'Alpha', squadId: 1, status: 'Failed', status_count: 2},
      {squadName: 'Beta', squadId: 2, status: 'Passed', status_count: 5},
    ]

    const output = transformSquadWiseRunData(input)

    expect(output).toEqual([
      {
        squadName: 'Alpha',
        squadId: 1,
        runData: {
          passed: 3,
          failed: 2,
          untested: 0,
          blocked: 0,
          retest: 0,
          archived: 0,
          skipped: 0,
          inprogress: 0,
          total: 5,
        },
      },
      {
        squadName: 'Beta',
        squadId: 2,
        runData: {
          passed: 5,
          failed: 0,
          untested: 0,
          blocked: 0,
          retest: 0,
          archived: 0,
          skipped: 0,
          inprogress: 0,
          total: 5,
        },
      },
    ])
  })

  test('should return null for undefined input', () => {
    expect(transformSquadWiseRunData(undefined)).toBeNull()
  })

  test('should handle cases where squadId is null', () => {
    const input = [
      {squadName: null, squadId: null, status: 'Passed', status_count: 3},
    ]

    expect(transformSquadWiseRunData(input)).toEqual([])
  })

  test('should handle squadId of 0 with a valid squadName', () => {
    const input = [
      {squadName: 'Unassigned', squadId: 0, status: 'Passed', status_count: 4},
    ]

    const output = transformSquadWiseRunData(input)

    expect(output).toEqual([
      {
        squadName: 'Unassigned',
        squadId: 0,
        runData: {
          passed: 4,
          failed: 0,
          untested: 0,
          blocked: 0,
          retest: 0,
          archived: 0,
          skipped: 0,
          inprogress: 0,
          total: 4,
        },
      },
    ])
  })
})

describe('handleNewSectionAndSquad', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should create new section when new_section is provided', async () => {
    const params = {
      new_section: 'New Section',
      new_squad: undefined,
      projectId: 1,
      createdBy: 100,
    }
    const mockSectionResponse = {id: 1, name: 'New Section'}

    ;(
      SectionsController.createSectionFromHierarchy as jest.Mock
    ).mockResolvedValue(mockSectionResponse)

    const result = await handleNewSectionAndSquad(params)

    expect(SectionsController.createSectionFromHierarchy).toHaveBeenCalledWith({
      sectionHierarchyString: params.new_section,
      projectId: params.projectId,
      createdBy: params.createdBy,
    })
    expect(SquadsController.checkAndCreateSquad).not.toHaveBeenCalled()
    expect(result).toEqual({newSection: mockSectionResponse})
  })

  it('should create new squad when new_squad is provided', async () => {
    const params = {
      new_section: undefined,
      new_squad: 'New Squad',
      projectId: 1,
      createdBy: 100,
    }
    const mockSquadResponse = {id: 1, name: 'New Squad'}

    ;(SquadsController.checkAndCreateSquad as jest.Mock).mockResolvedValue(
      mockSquadResponse,
    )

    const result = await handleNewSectionAndSquad(params)

    expect(SquadsController.checkAndCreateSquad).toHaveBeenCalledWith({
      squadName: params.new_squad,
      projectId: params.projectId,
      createdBy: params.createdBy,
    })
    expect(SectionsController.createSectionFromHierarchy).not.toHaveBeenCalled()
    expect(result).toEqual({newSquad: mockSquadResponse})
  })

  it('should create both section and squad when both are provided', async () => {
    const params = {
      new_section: 'New Section',
      new_squad: 'New Squad',
      projectId: 1,
      createdBy: 100,
    }
    const mockSectionResponse = {id: 1, name: 'New Section'}
    const mockSquadResponse = {id: 2, name: 'New Squad'}

    ;(
      SectionsController.createSectionFromHierarchy as jest.Mock
    ).mockResolvedValue(mockSectionResponse)
    ;(SquadsController.checkAndCreateSquad as jest.Mock).mockResolvedValue(
      mockSquadResponse,
    )

    const result = await handleNewSectionAndSquad(params)

    expect(SectionsController.createSectionFromHierarchy).toHaveBeenCalledWith({
      sectionHierarchyString: params.new_section,
      projectId: params.projectId,
      createdBy: params.createdBy,
    })
    expect(SquadsController.checkAndCreateSquad).toHaveBeenCalledWith({
      squadName: params.new_squad,
      projectId: params.projectId,
      createdBy: params.createdBy,
    })
    expect(result).toEqual({
      newSection: mockSectionResponse,
      newSquad: mockSquadResponse,
    })
  })

  it('should return empty object when no new section or squad is provided', async () => {
    const params = {
      new_section: undefined,
      new_squad: undefined,
      projectId: 1,
      createdBy: 100,
    }

    const result = await handleNewSectionAndSquad(params)

    expect(SectionsController.createSectionFromHierarchy).not.toHaveBeenCalled()
    expect(SquadsController.checkAndCreateSquad).not.toHaveBeenCalled()
    expect(result).toEqual({})
  })
})
