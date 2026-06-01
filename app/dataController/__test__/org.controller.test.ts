import OrgController from '../org.controller';
import OrganisationDao from '~/db/dao/org.dao';

jest.mock('~/db/dao/org.dao');

describe('OrgController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should get organisation list', async () => {
    const mockOrgList = [{ id: 1, name: 'Org1' }, { id: 2, name: 'Org2' }];
    (OrganisationDao.getOrganisationList as jest.Mock).mockResolvedValue(mockOrgList);

    const result = await OrgController.getOrgList();

    expect(result).toEqual(mockOrgList);
    expect(OrganisationDao.getOrganisationList).toHaveBeenCalledTimes(1);
  });

  it('should get organisation info by id', async () => {
    const mockOrgInfo = { id: 1, name: 'Org1' };
    (OrganisationDao.getOrganisationInfo as jest.Mock).mockResolvedValue(mockOrgInfo);

    const result = await OrgController.getOrgInfo(1);

    expect(result).toEqual(mockOrgInfo);
    expect(OrganisationDao.getOrganisationInfo).toHaveBeenCalledWith(1);
    expect(OrganisationDao.getOrganisationInfo).toHaveBeenCalledTimes(1);
  });

  it('should return an empty list when no organisations exist', async () => {
    (OrganisationDao.getOrganisationList as jest.Mock).mockResolvedValue([]);

    const result = await OrgController.getOrgList();

    expect(result).toEqual([]);
  });

  it('should throw when getOrgList DAO throws', async () => {
    (OrganisationDao.getOrganisationList as jest.Mock).mockRejectedValue(new Error('DB error'));

    await expect(OrgController.getOrgList()).rejects.toThrow('DB error');
  });

  it('should throw when getOrgInfo DAO throws', async () => {
    (OrganisationDao.getOrganisationInfo as jest.Mock).mockRejectedValue(new Error('Not found'));

    await expect(OrgController.getOrgInfo(999)).rejects.toThrow('Not found');
  });
});
