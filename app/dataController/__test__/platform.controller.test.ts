import PlatformController from '../platform.controller';
import PlatformDao from '@dao/platform.dao';

jest.mock('@dao/platform.dao');

describe('PlatformController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should get all platforms for a given organisation', async () => {
    const mockPlatforms = [{ id: 1, name: 'Platform1' }, { id: 2, name: 'Platform2' }];
    (PlatformDao.getAllPlatform as jest.Mock).mockResolvedValue(mockPlatforms);

    const param = { orgId: 1 };
    const result = await PlatformController.getAllPlatform(param);

    expect(result).toEqual(mockPlatforms);
    expect(PlatformDao.getAllPlatform).toHaveBeenCalledWith(param);
    expect(PlatformDao.getAllPlatform).toHaveBeenCalledTimes(1);
  });

  it('should return an empty array when no platforms exist', async () => {
    (PlatformDao.getAllPlatform as jest.Mock).mockResolvedValue([]);

    const result = await PlatformController.getAllPlatform({ orgId: 1 });

    expect(result).toEqual([]);
  });

  it('should throw when DAO throws', async () => {
    (PlatformDao.getAllPlatform as jest.Mock).mockRejectedValue(new Error('DB error'));

    await expect(PlatformController.getAllPlatform({ orgId: 1 })).rejects.toThrow('DB error');
  });

  describe('createPlatform', () => {
    it('should create a platform and return the result', async () => {
      const mockParam = { platformName: 'Web', createdBy: 1, orgId: 1 };
      const mockResponse = { platformId: 10, platformName: 'Web' };
      (PlatformDao.createPlatform as jest.Mock).mockResolvedValue(mockResponse);

      const result = await PlatformController.createPlatform(mockParam);

      expect(result).toEqual(mockResponse);
      expect(PlatformDao.createPlatform).toHaveBeenCalledWith(mockParam);
    });

    it('should throw when createPlatform DAO throws', async () => {
      (PlatformDao.createPlatform as jest.Mock).mockRejectedValue(new Error('Insert failed'));

      await expect(
        PlatformController.createPlatform({ platformName: 'iOS', createdBy: 1, orgId: 1 }),
      ).rejects.toThrow('Insert failed');
    });
  });
});
