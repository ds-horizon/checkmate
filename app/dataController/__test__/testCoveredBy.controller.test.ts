import TestCoveredByController from '../testCoveredBy.controller';
import TestCoveredByDao from '@dao/testCoveredBy.dao';

jest.mock('@dao/testCoveredBy.dao');

describe('TestCoveredByController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should get all test covered by for a given organisation', async () => {
    const mockTestCoveredBy = [{ id: 1, name: 'Manual' }, { id: 2, name: 'Automated' }];
    (TestCoveredByDao.getAllTestCoveredBy as jest.Mock).mockResolvedValue(mockTestCoveredBy);

    const param = { orgId: 1 };
    const result = await TestCoveredByController.getAllTestCoveredBy(param);

    expect(result).toEqual(mockTestCoveredBy);
    expect(TestCoveredByDao.getAllTestCoveredBy).toHaveBeenCalledWith(param);
    expect(TestCoveredByDao.getAllTestCoveredBy).toHaveBeenCalledTimes(1);
  });

  it('should return an empty array when no entries exist', async () => {
    (TestCoveredByDao.getAllTestCoveredBy as jest.Mock).mockResolvedValue([]);

    const result = await TestCoveredByController.getAllTestCoveredBy({ orgId: 1 });

    expect(result).toEqual([]);
  });

  it('should throw when DAO throws', async () => {
    (TestCoveredByDao.getAllTestCoveredBy as jest.Mock).mockRejectedValue(new Error('DB error'));

    await expect(
      TestCoveredByController.getAllTestCoveredBy({ orgId: 1 }),
    ).rejects.toThrow('DB error');
  });
});
