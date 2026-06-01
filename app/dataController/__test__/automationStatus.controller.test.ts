import AutomationStatusController from '@controllers/automationStatus.controller'
import AutomationStatusDao from '@dao/automationStatus.dao'

jest.mock('@dao/automationStatus.dao')

describe('AutomationStatusController', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getAllAutomationStatus', () => {
    it('should call AutomationStatusDao.getAllAutomationStatus with the correct parameters', async () => {
      const mockParams = {orgId: 123}
      const mockResponse = [
        {statusId: 1, statusName: 'Active'},
        {statusId: 2, statusName: 'Inactive'},
      ]

      ;(
        AutomationStatusDao.getAllAutomationStatus as jest.Mock
      ).mockResolvedValue(mockResponse)

      const result = await AutomationStatusController.getAllAutomationStatus(
        mockParams,
      )

      expect(AutomationStatusDao.getAllAutomationStatus).toHaveBeenCalledWith(
        mockParams,
      )
      expect(result).toEqual(mockResponse)
    })

    it('should throw an error if AutomationStatusDao.getAllAutomationStatus fails', async () => {
      const mockParams = {orgId: 123}
      const mockError = new Error('Database error')

      ;(
        AutomationStatusDao.getAllAutomationStatus as jest.Mock
      ).mockRejectedValue(mockError)

      await expect(
        AutomationStatusController.getAllAutomationStatus(mockParams),
      ).rejects.toThrow('Database error')

      expect(AutomationStatusDao.getAllAutomationStatus).toHaveBeenCalledWith(
        mockParams,
      )
    })

    it('should return an empty array when no automation statuses exist', async () => {
      const mockParams = {orgId: 999}
      ;(
        AutomationStatusDao.getAllAutomationStatus as jest.Mock
      ).mockResolvedValue([])

      const result =
        await AutomationStatusController.getAllAutomationStatus(mockParams)

      expect(result).toEqual([])
      expect(AutomationStatusDao.getAllAutomationStatus).toHaveBeenCalledWith(
        mockParams,
      )
    })

    it('should pass orgId correctly to the DAO', async () => {
      const mockParams = {orgId: 42}
      ;(
        AutomationStatusDao.getAllAutomationStatus as jest.Mock
      ).mockResolvedValue([])

      await AutomationStatusController.getAllAutomationStatus(mockParams)

      expect(AutomationStatusDao.getAllAutomationStatus).toHaveBeenCalledWith({
        orgId: 42,
      })
    })
  })
})
