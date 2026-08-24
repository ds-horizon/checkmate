export const PLANE_DESTINATIONS = {
  'biz-development': {
    publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
    workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
    workspaceSlug: 'infinimind',
    projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
    projectIdentifier: 'BIZ',
  },
  'dfr-development': {
    publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
    workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
    workspaceSlug: 'infinimind',
    projectId: '65452c58-ac2a-4077-a91d-40bf6b5cf4ec',
    projectIdentifier: 'DFR',
    backlogStateId: '431aafc8-5296-407e-80ec-14df0c8d96db',
    todoStateId: 'ba623262-3ee5-4f54-ad55-c837933d7d17',
    doneStateId: 'ff905e71-9caa-49cd-83c3-cdd90cd345a6',
    cancelledStateId: '2d284b72-cabb-45ec-9e9d-44721ee5b722',
  },
} as const

export type PlaneDestinationKey = keyof typeof PLANE_DESTINATIONS
export type PlaneDestination = (typeof PLANE_DESTINATIONS)[PlaneDestinationKey]

export const planeDestinationForProjectName = (
  projectName: string,
): PlaneDestinationKey => {
  return /deepframe/i.test(projectName) ? 'dfr-development' : 'biz-development'
}

export const planeDestinationForProviderIds = (
  workspaceId: string | null | undefined,
  projectId: string | null | undefined,
): PlaneDestinationKey | null => {
  if (!workspaceId || !projectId) return null
  const entry = Object.entries(PLANE_DESTINATIONS).find(
    ([, destination]) =>
      destination.workspaceId === workspaceId &&
      destination.projectId === projectId,
  )
  return (entry?.[0] as PlaneDestinationKey | undefined) ?? null
}

export const planeDestinationForProviderTuple = (
  workspaceId: string | null | undefined,
  projectId: string | null | undefined,
  _projectIdentifier?: string | null | undefined,
): PlaneDestinationKey | null => {
  // The UUID pair is the durable route identity. The project identifier is
  // mutable Plane display/config metadata and must not affect dispatch.
  return planeDestinationForProviderIds(workspaceId, projectId)
}

export const planeDestinationMatchesProviderIds = (
  destination: PlaneDestinationKey,
  workspaceId: string | null,
  projectId: string | null,
) =>
  workspaceId === PLANE_DESTINATIONS[destination].workspaceId &&
  projectId === PLANE_DESTINATIONS[destination].projectId

export const planeDestinationMatchesProviderTuple = (
  destination: PlaneDestinationKey,
  workspaceId: string | null | undefined,
  projectId: string | null | undefined,
  _projectIdentifier?: string | null | undefined,
) =>
  planeDestinationMatchesProviderIds(
    destination,
    workspaceId ?? null,
    projectId ?? null,
  )

export const planeDestinationStateId = (
  destination: PlaneDestinationKey,
  state: 'backlog' | 'todo' | 'done' | 'cancelled',
) => {
  const destinationConfig = PLANE_DESTINATIONS[destination] as {
    backlogStateId?: string
    todoStateId?: string
    doneStateId?: string
    cancelledStateId?: string
  }
  if (destination !== 'dfr-development') return undefined
  return destinationConfig[
    `${state}StateId` as
      | 'backlogStateId'
      | 'todoStateId'
      | 'doneStateId'
      | 'cancelledStateId'
  ]
}
