import {
  createPlaneAdapter,
  PlaneAdapterError,
  readPlaneAdapterConfig,
} from '../planeAdapter'

const environment = {
  PLANE_DESTINATION: 'biz-development',
  PLANE_API_KEY: 'secret-api-key',
  PLANE_API_TIMEOUT_MS: '100',
}

describe('Plane adapter configuration', () => {
  it('requires a credentialed allowlisted destination', () => {
    expect(() => readPlaneAdapterConfig({})).toThrow('PLANE_DESTINATION')
    expect(() =>
      readPlaneAdapterConfig({
        PLANE_DESTINATION: 'production',
        PLANE_API_KEY: 'key',
      }),
    ).toThrow('not allowlisted')
  })

  it('reads the exact server-only values and a bounded timeout', () => {
    expect(
      readPlaneAdapterConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
        PLANE_API_TIMEOUT_MS: '2500',
      }),
    ).toEqual({
      baseUrl: 'https://plane-dev.geep-fence.ts.net',
      apiKey: 'key',
      workspaceSlug: 'infinimind',
      projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
      timeoutMs: 2500,
    })
  })
})

describe('Plane intake adapter', () => {
  it('creates Intake through the scoped API and returns durable identity', async () => {
    const fetchImplementation = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'intake-id',
          issue: {
            id: 'work-item-id',
            sequence_id: 38,
            project_identifier: 'BIZ',
          },
        }),
        {status: 201, headers: {'content-type': 'application/json'}},
      ),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.createIntake({
        title: 'Checkmate failed step',
        description: 'Evidence',
        priority: 'high',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        intakeId: 'intake-id',
        workItemId: 'work-item-id',
        sequenceId: 38,
        projectIdentifier: 'BIZ',
      }),
    )

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://plane-dev.geep-fence.ts.net/api/v1/workspaces/infinimind/projects/67726ee5-7d0c-4656-8bc8-b2f8a959d5da/intake-issues/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({'X-API-Key': 'secret-api-key'}),
        body: JSON.stringify({
          issue: {
            name: 'Checkmate failed step',
            description: 'Evidence',
            priority: 'high',
          },
        }),
      }),
    )
  })

  it('classifies rate limits as retryable and respects Retry-After', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () =>
        new Response(JSON.stringify({detail: 'Slow down'}), {
          status: 429,
          headers: {'retry-after': '3'},
        }),
      ),
    )

    await expect(
      adapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      }),
    ).rejects.toMatchObject<Partial<PlaneAdapterError>>({
      kind: 'retryable',
      retryAfterMs: 3000,
    })
  })

  it('treats a server error after create as ambiguous', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () =>
        new Response(JSON.stringify({detail: 'Internal error'}), {status: 503}),
      ),
    )

    await expect(
      adapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      }),
    ).rejects.toMatchObject<Partial<PlaneAdapterError>>({
      kind: 'ambiguous_create',
    })
  })

  it('sends unknown POST outcomes to manual attention without exposing secrets', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => {
        throw new Error(
          `request failed with X-API-Key ${'a'.repeat(48)}`,
        )
      }),
    )

    let error: PlaneAdapterError | undefined
    try {
      await adapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      })
    } catch (caught) {
      error = caught as PlaneAdapterError
    }

    expect(error?.kind).toBe('ambiguous_create')
    expect(error?.message).toContain('[redacted]')
    expect(error?.message).not.toContain('a'.repeat(48))

    const colonFormAdapter = createPlaneAdapter(
      environment,
      jest.fn(async () => {
        throw new Error('request failed with X-API-Key: short-secret-123')
      }),
    )
    await expect(
      colonFormAdapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      }),
    ).rejects.not.toThrow('short-secret-123')
  })

  it('rejects successful responses without authoritative work item identity', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => new Response(JSON.stringify({status: 'created'}))),
    )

    await expect(
      adapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      }),
    ).rejects.toMatchObject<Partial<PlaneAdapterError>>({
      kind: 'manual_attention',
    })
  })
})
