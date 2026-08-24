import {
  PLANE_DESTINATIONS,
  planeDestinationForProjectName,
  planeDestinationForProviderTuple,
  planeDestinationForProviderIds,
  planeDestinationMatchesProviderIds,
} from '../planeRouting'

describe('Plane project routing', () => {
  it.each([
    'DeepFrame',
    'DeepFrame Platform',
    'DeepFrame - Production',
    'deepframe customer validation',
    'DEEPFRAME / API',
  ])('routes the DeepFrame project name %s to DFR', (projectName) => {
    expect(planeDestinationForProjectName(projectName)).toBe('dfr-development')
  })

  it('matches DeepFrame case-insensitively and keeps non-DeepFrame on BIZ', () => {
    expect(planeDestinationForProjectName('deepFRAME')).toBe('dfr-development')
    expect(planeDestinationForProjectName('Checkout')).toBe('biz-development')
  })

  it('keeps empty and unrelated project names on the legacy BIZ route', () => {
    expect(planeDestinationForProjectName('  ')).toBe('biz-development')
    expect(planeDestinationForProjectName('')).toBe('biz-development')
  })

  it('only accepts the exact allowlisted provider destination', () => {
    expect(
      planeDestinationForProviderIds(
        PLANE_DESTINATIONS['dfr-development'].workspaceId,
        PLANE_DESTINATIONS['dfr-development'].projectId,
      ),
    ).toBe('dfr-development')
    expect(
      planeDestinationForProviderIds(
        PLANE_DESTINATIONS['dfr-development'].workspaceId,
        'unexpected-project-id',
      ),
    ).toBe(null)
    expect(
      planeDestinationMatchesProviderIds(
        'dfr-development',
        PLANE_DESTINATIONS['biz-development'].workspaceId,
        PLANE_DESTINATIONS['biz-development'].projectId,
      ),
    ).toBe(false)
    expect(
      planeDestinationForProviderTuple(
        PLANE_DESTINATIONS['dfr-development'].workspaceId,
        PLANE_DESTINATIONS['dfr-development'].projectId,
        'DFR',
      ),
    ).toBe('dfr-development')
    expect(
      planeDestinationForProviderTuple(
        PLANE_DESTINATIONS['dfr-development'].workspaceId,
        PLANE_DESTINATIONS['dfr-development'].projectId,
        'BIZ',
      ),
    ).toBe('dfr-development')
    expect(
      planeDestinationForProviderTuple(
        PLANE_DESTINATIONS['dfr-development'].workspaceId,
        'unexpected-project-id',
        'DFR',
      ),
    ).toBe(null)
  })

  it('locks all DFR workflow state IDs', () => {
    expect(PLANE_DESTINATIONS['dfr-development']).toEqual(
      expect.objectContaining({
        backlogStateId: '431aafc8-5296-407e-80ec-14df0c8d96db',
        todoStateId: 'ba623262-3ee5-4f54-ad55-c837933d7d17',
        doneStateId: 'ff905e71-9caa-49cd-83c3-cdd90cd345a6',
        cancelledStateId: '2d284b72-cabb-45ec-9e9d-44721ee5b722',
      }),
    )
  })
})
