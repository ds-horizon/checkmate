import TypeController from '../type.controller';
import TypeDao from '~/db/dao/type.dao';

jest.mock('~/db/dao/type.dao');

describe('TypeController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should get all types for a given organisation', async () => {
    const mockTypes = [{ id: 1, name: 'Type1' }, { id: 2, name: 'Type2' }];
    (TypeDao.getAllType as jest.Mock).mockResolvedValue(mockTypes);

    const param = { orgId: 1 };
    const result = await TypeController.getAllType(param);

    expect(result).toEqual(mockTypes);
    expect(TypeDao.getAllType).toHaveBeenCalledWith(param);
    expect(TypeDao.getAllType).toHaveBeenCalledTimes(1);
  });

  it('should return an empty array when no types exist', async () => {
    (TypeDao.getAllType as jest.Mock).mockResolvedValue([]);

    const result = await TypeController.getAllType({ orgId: 1 });

    expect(result).toEqual([]);
  });

  it('should throw when DAO throws', async () => {
    (TypeDao.getAllType as jest.Mock).mockRejectedValue(new Error('DB error'));

    await expect(TypeController.getAllType({ orgId: 1 })).rejects.toThrow('DB error');
  });
});
