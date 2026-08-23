import {
  createPlaneRequestLimiter,
  createPlaneAdapter,
  PlaneAdapterError,
  readPlaneAdapterConfig,
} from '../planeAdapter'

const environment = {
  PLANE_DESTINATION: 'biz-development',
  PLANE_API_KEY: 'secret-api-key',
  PLANE_API_TIMEOUT_MS: '100',
}
const environmentWorkspaceId = 'e36dfd86-953a-4e33-a410-856208893bb9'
const environmentProjectId = '67726ee5-7d0c-4656-8bc8-b2f8a959d5da'

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
      apiBaseUrl: 'https://plane-dev.geep-fence.ts.net',
      publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
      apiKey: 'key',
      workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
      workspaceSlug: 'infinimind',
      projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
      projectIdentifier: 'BIZ',
      timeoutMs: 2500,
      maxRequestsPerMinute: 6,
      maxRequestWaitMs: 60000,
    })
  })

  it('allows only the two exact approved API origins', () => {
    expect(
      readPlaneAdapterConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
        PLANE_API_BASE_URL:
          'http://plane-app-api.plane.svc.cluster.local:8000',
      }).apiBaseUrl,
    ).toBe('http://plane-app-api.plane.svc.cluster.local:8000')

    for (const value of [
      'https://plane-dev.geep-fence.ts.net/',
      'https://plane-dev.geep-fence.ts.net.evil.example',
      'https://user@plane-dev.geep-fence.ts.net',
      'https://plane-dev.geep-fence.ts.net/api',
      'https://plane-dev.geep-fence.ts.net?next=evil',
      'http://plane-app-api.plane.svc.cluster.local:8000#fragment',
    ]) {
      expect(() =>
        readPlaneAdapterConfig({
          PLANE_DESTINATION: 'biz-development',
          PLANE_API_KEY: 'key',
          PLANE_API_BASE_URL: value,
        }),
      ).toThrow('PLANE_API_BASE_URL is not an approved exact origin')
    }
  })

  it('rejects a missing, non-positive, or unsafe Plane request bound', () => {
    expect(() =>
      readPlaneAdapterConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
        PLANE_MAX_REQUESTS_PER_MINUTE: '0',
      }),
    ).toThrow('PLANE_MAX_REQUESTS_PER_MINUTE must be a positive integer')
    expect(() =>
      readPlaneAdapterConfig({
        PLANE_DESTINATION: 'biz-development',
        PLANE_API_KEY: 'key',
        PLANE_MAX_REQUESTS_PER_MINUTE: '61',
      }),
    ).toThrow('PLANE_MAX_REQUESTS_PER_MINUTE must be between 1 and 60')
  })

  it('rate gates Plane API starts before the fetch is invoked', async () => {
    let now = 1_000
    const waits: number[] = []
    const limiter = createPlaneRequestLimiter({
      requestsPerMinute: 6,
      now: () => now,
      sleepFor: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      },
    })
    const fetchImplementation = jest.fn(async () =>
      Response.json({
        id: 'work-item-id',
        state: {id: 'done-state-id'},
      }),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation, limiter)

    for (let index = 0; index < 7; index += 1) {
      await adapter.getWorkItem('work-item-id')
    }

    expect(waits).toEqual([60_000])
    expect(fetchImplementation).toHaveBeenCalledTimes(7)
  })

  it('projects the one-shot runtime surface to one authoritative GET', async () => {
    const fetchImplementation = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        id: 'work-item-id',
        state: {id: 'done-state-id'},
      }),
    )
    const fullAdapter = createPlaneAdapter(environment, fetchImplementation)
    const {getWorkItem, getIntakeWorkItem} = fullAdapter
    const oneShotAdapter = {getWorkItem, getIntakeWorkItem}

    expect(Object.keys(oneShotAdapter)).toEqual([
      'getWorkItem',
      'getIntakeWorkItem',
    ])
    await oneShotAdapter.getWorkItem('work-item-id')

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining('/work-items/work-item-id/'),
      expect.objectContaining({method: 'GET'}),
    )
    expect(
      fetchImplementation.mock.calls.some((call) =>
        ['POST', 'PATCH'].includes(String(call[1]?.method)),
      ),
    ).toBe(false)
  })
})

describe('Plane intake adapter', () => {
  it('fetches and validates the authoritative state for the exact work item', async () => {
    const fetchImplementation = jest.fn(async () =>
      Response.json({
        id: 'work-item-id',
        state: {id: 'done-state-id'},
        updated_at: '2026-08-20T00:00:00.000Z',
      }),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(adapter.getWorkItem('work-item-id')).resolves.toEqual(
      expect.objectContaining({
        workItemId: 'work-item-id',
        stateId: 'done-state-id',
        versionMarker: '2026-08-20T00:00:00.000Z',
      }),
    )
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://plane-dev.geep-fence.ts.net/api/v1/workspaces/infinimind/projects/67726ee5-7d0c-4656-8bc8-b2f8a959d5da/work-items/work-item-id/',
      expect.objectContaining({method: 'GET'}),
    )
  })

  it('sends API fetches to the approved internal origin', async () => {
    const fetchImplementation = jest.fn(async () =>
      Response.json({id: 'work-item-id', state: {id: 'done-state-id'}}),
    )
    const adapter = createPlaneAdapter(
      {
        ...environment,
        PLANE_API_BASE_URL:
          'http://plane-app-api.plane.svc.cluster.local:8000',
      },
      fetchImplementation,
    )

    await adapter.getWorkItem('work-item-id')

    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://plane-app-api.plane.svc.cluster.local:8000/api/v1/workspaces/infinimind/projects/67726ee5-7d0c-4656-8bc8-b2f8a959d5da/work-items/work-item-id/',
      expect.objectContaining({method: 'GET'}),
    )
  })

  it('rejects a work item response that does not prove identity and state', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => Response.json({id: 'another-work-item'})),
    )

    await expect(adapter.getWorkItem('work-item-id')).rejects.toMatchObject<
      Partial<PlaneAdapterError>
    >({kind: 'manual_attention'})
  })

  it('normalizes scalar and object destination fields without inventing an identifier', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () =>
        Response.json({
          id: 'work-item-id',
          state: {id: 'done-state-id'},
          workspace: {id: environmentWorkspaceId, name: 'Infinimind'},
          project: environmentProjectId,
        }),
      ),
    )

    const result = await adapter.getWorkItem('work-item-id')

    expect(result.raw).toEqual(
      expect.objectContaining({
        workspace: {id: environmentWorkspaceId, name: 'Infinimind'},
        project: environmentProjectId,
        workspace_id: environmentWorkspaceId,
        project_id: environmentProjectId,
      }),
    )
    expect(result.raw).not.toHaveProperty('project_identifier')
  })

  it('fetches the exact backing work item through the Intake envelope without writes', async () => {
    const fetchImplementation = jest.fn(async () =>
      Response.json({
        id: 'intake-id',
        issue: 'work-item-id',
        issue_detail: {
          id: 'work-item-id',
          state: {id: 'done-state-id'},
          workspace: environmentWorkspaceId,
          project: environmentProjectId,
          name: 'Checkmate failed step',
          description: 'Evidence',
          updated_at: '2026-08-20T00:00:00.000Z',
        },
        workspace: environmentWorkspaceId,
        project: environmentProjectId,
      }),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    const result = await adapter.getIntakeWorkItem({
      workItemId: 'work-item-id',
      intakeId: 'intake-id',
    })
    expect(result).toEqual(
      expect.objectContaining({
        workItemId: 'work-item-id',
        stateId: 'done-state-id',
        source: 'intake',
        raw: expect.objectContaining({
          id: 'intake-id',
          issue: 'work-item-id',
          intake_id: 'intake-id',
          project_id: environmentProjectId,
          workspace_id: environmentWorkspaceId,
        }),
      }),
    )
    expect(result.raw).not.toHaveProperty('project_identifier')
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://plane-dev.geep-fence.ts.net/api/v1/workspaces/infinimind/projects/67726ee5-7d0c-4656-8bc8-b2f8a959d5da/intake-issues/work-item-id/',
      expect.objectContaining({method: 'GET'}),
    )
    expect(
      fetchImplementation.mock.calls.some((call) =>
        ['POST', 'PATCH'].includes(
          String((call as unknown as [unknown, RequestInit?])[1]?.method),
        ),
      ),
    ).toBe(false)
  })

  it.each([
    ['wrapper intake id', {id: 'wrong-intake-id'}],
    ['wrapper backing id', {issue: 'wrong-work-item-id'}],
    [
      'inner backing id',
      {issue_detail: {id: 'wrong-work-item-id'}},
    ],
    ['workspace destination', {workspace: 'wrong-workspace-id'}],
    ['project destination', {project: 'wrong-project-id'}],
    ['state', {issue_detail: {state: null}}],
  ])('rejects an Intake response with a mismatched %s', async (_field, change) => {
    const base = {
      id: 'intake-id',
      issue: 'work-item-id',
      issue_detail: {
        id: 'work-item-id',
        state: {id: 'done-state-id'},
        workspace: environmentWorkspaceId,
        project: environmentProjectId,
      },
      workspace: environmentWorkspaceId,
      project: environmentProjectId,
    }
    const changeRecord = change as Record<string, unknown>
    const response = {
      ...base,
      ...change,
      issue_detail: {
        ...base.issue_detail,
        ...(changeRecord.issue_detail ?? {}),
      },
    }
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => Response.json(response)),
    )

    await expect(
      adapter.getIntakeWorkItem({
        workItemId: 'work-item-id',
        intakeId: 'intake-id',
      }),
    ).rejects.toMatchObject({kind: 'manual_attention'})
  })

  it('moves a work item to the exact requested state and verifies the response', async () => {
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json({id: 'work-item-id', state: {id: 'done-state-id'}}),
      )
      .mockResolvedValueOnce(
        Response.json({id: 'work-item-id', state: {id: 'todo-state-id'}}),
      )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.ensureWorkItemState({
        workItemId: 'work-item-id',
        stateId: 'todo-state-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        workItemId: 'work-item-id',
        stateId: 'todo-state-id',
      }),
    )
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'https://plane-dev.geep-fence.ts.net/api/v1/workspaces/infinimind/projects/67726ee5-7d0c-4656-8bc8-b2f8a959d5da/work-items/work-item-id/',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({state: 'todo-state-id'}),
      }),
    )
  })

  it('creates Intake through the scoped API and returns durable identity', async () => {
    const fetchImplementation = jest.fn(
      async () =>
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

  it('prefers the backing work item identity from an Intake envelope', async () => {
    const fetchImplementation = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'intake-id',
            issue: 'work-item-id',
            issue_detail: {
              id: 'work-item-id',
              sequence_id: 41,
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
        sequenceId: 41,
        projectIdentifier: 'BIZ',
      }),
    )
  })

  it('uses a scalar backing issue id without confusing it with the Intake id', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () =>
        Response.json(
          {id: 'intake-id', issue: 'work-item-id'},
          {status: 201},
        ),
      ),
    )

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
        sequenceId: null,
        projectIdentifier: null,
      }),
    )
  })

  it('fails closed when an Intake envelope has no backing issue identity', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => Response.json({id: 'intake-id'}, {status: 201})),
    )

    await expect(
      adapter.createIntake({
        title: 'Checkmate failed step',
        description: 'Evidence',
        priority: 'high',
      }),
    ).rejects.toMatchObject({kind: 'manual_attention'})
  })

  it('shares the Plane request budget with other adapter methods before creating Intake', async () => {
    let now = 1_000
    const waits: number[] = []
    const limiter = createPlaneRequestLimiter({
      requestsPerMinute: 1,
      now: () => now,
      sleepFor: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      },
    })
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json({id: 'work-item-id', state: {id: 'done-state-id'}}),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'intake-id',
          issue: {id: 'work-item-id', sequence_id: 38, project_identifier: 'BIZ'},
        }),
      )
    const adapter = createPlaneAdapter(environment, fetchImplementation, limiter)

    await adapter.getWorkItem('work-item-id')
    await adapter.createIntake({
      title: 'Checkmate failed step',
      description: 'Evidence',
      priority: 'high',
    })

    expect(waits).toEqual([60_000])
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('starts the Intake timeout only after the shared rate-limit wait', async () => {
    jest.useFakeTimers()
    try {
      const limiter = createPlaneRequestLimiter({requestsPerMinute: 12})
      const signals: AbortSignal[] = []
      const fetchImplementation: typeof fetch = jest.fn(async (_input, init) => {
        if (!init?.signal) throw new Error('expected Plane request signal')
        signals.push(init.signal)
        if (signals.length <= 12) {
          return Response.json({id: 'work-item-id', state: {id: 'done-state-id'}})
        }
        return Response.json({
          id: 'intake-id',
          issue: {id: 'work-item-id', sequence_id: 38, project_identifier: 'BIZ'},
        })
      })
      const adapter = createPlaneAdapter(
        {...environment, PLANE_API_TIMEOUT_MS: '10'},
        fetchImplementation,
        limiter,
      )

      for (let index = 0; index < 12; index += 1) {
        await adapter.getWorkItem('work-item-id')
      }
      const delivery = adapter.createIntake({
        title: 'Checkmate failed step',
        description: 'Evidence',
        priority: 'high',
      })

      await jest.advanceTimersByTimeAsync(10)
      expect(fetchImplementation).toHaveBeenCalledTimes(12)

      await jest.advanceTimersByTimeAsync(59_990)
      await expect(delivery).resolves.toEqual(
        expect.objectContaining({intakeId: 'intake-id'}),
      )
      expect(signals).toHaveLength(13)
      expect(signals[12].aborted).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('classifies rate limits as retryable and respects Retry-After', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(
        async () =>
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
      jest.fn(
        async () =>
          new Response(JSON.stringify({detail: 'Internal error'}), {
            status: 503,
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
      kind: 'ambiguous_create',
    })
  })

  it('sends unknown POST outcomes to manual attention without exposing secrets', async () => {
    const adapter = createPlaneAdapter(
      environment,
      jest.fn(async () => {
        throw new Error(`request failed with X-API-Key ${'a'.repeat(48)}`)
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

  it('bounds intake response parsing within the Plane request timeout', async () => {
    jest.useFakeTimers()
    try {
      const response = new Response(null, {status: 201})
      const fetchImplementation: typeof fetch = jest.fn(
        async (_input, init) => {
          response.json = () =>
            new Promise((_, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('response body aborted')),
              )
            })
          return response
        },
      )
      const adapter = createPlaneAdapter(
        {...environment, PLANE_API_TIMEOUT_MS: '10'},
        fetchImplementation,
      )

      const delivery = adapter.createIntake({
        title: 'Defect',
        description: 'Evidence',
        priority: 'medium',
      })
      const assertion = expect(delivery).rejects.toMatchObject<
        Partial<PlaneAdapterError>
      >({
        kind: 'manual_attention',
        message: expect.stringContaining('response body aborted'),
      })
      await jest.advanceTimersByTimeAsync(10)

      await assertion
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('Plane evidence adapter', () => {
  it('reuses a comment with the deterministic evidence marker', async () => {
    const fetchImplementation = jest.fn(async () =>
      Response.json({
        results: [
          {
            id: 'comment-id',
            comment_html:
              '<p>Copied</p><p>Checkmate evidence ID: revision:41</p>',
          },
        ],
      }),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.ensureComment({
        workItemId: 'work-item-id',
        marker: 'Checkmate evidence ID: revision:41',
        commentHtml: '<p>Copied</p>',
      }),
    ).resolves.toEqual({commentId: 'comment-id'})
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining('/work-items/work-item-id/comments/'),
      expect.objectContaining({method: 'GET'}),
    )
  })

  it('uploads and finalizes a native work-item attachment', async () => {
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce(Response.json({results: []}))
      .mockResolvedValueOnce(
        Response.json(
          {
            asset_id: 'asset-id',
            attachment: {id: 'attachment-id'},
            upload_data: {
              url: 'https://objects.example/upload',
              fields: {key: 'plane/object-key', policy: 'signed-policy'},
            },
          },
          {status: 201},
        ),
      )
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(Response.json({id: 'attachment-id'}))
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.ensureAttachment({
        workItemId: 'work-item-id',
        name: 'checkmate-51-proof.png',
        contentType: 'image/png',
        bytes: Buffer.from('png-bytes'),
      }),
    ).resolves.toEqual({
      assetId: 'asset-id',
      attachmentId: 'attachment-id',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      3,
      'https://objects.example/upload',
      expect.objectContaining({method: 'POST', body: expect.any(FormData)}),
    )
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/attachments/asset-id/'),
      expect.objectContaining({method: 'PATCH'}),
    )
  })

  it('does not treat a matching unfinalized attachment slot as delivered', async () => {
    const fetchImplementation = jest.fn(async () =>
      Response.json({
        results: [
          {
            id: 'attachment-id',
            asset_id: 'asset-id',
            name: 'checkmate-51-proof.png',
            size: Buffer.byteLength('png-bytes'),
            is_uploaded: false,
          },
        ],
      }),
    )
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.ensureAttachment({
        workItemId: 'work-item-id',
        name: 'checkmate-51-proof.png',
        contentType: 'image/png',
        bytes: Buffer.from('png-bytes'),
      }),
    ).rejects.toMatchObject<Partial<PlaneAdapterError>>({
      kind: 'manual_attention',
      message: 'Plane has a matching attachment slot that is not finalized',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('fails closed after a reserved attachment slot cannot upload', async () => {
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce(Response.json({results: []}))
      .mockResolvedValueOnce(
        Response.json(
          {
            asset_id: 'asset-id',
            attachment: {id: 'attachment-id'},
            upload_data: {
              url: 'https://objects.example/upload',
              fields: {key: 'plane/object-key'},
            },
          },
          {status: 201},
        ),
      )
      .mockResolvedValueOnce(new Response(null, {status: 503}))
    const adapter = createPlaneAdapter(environment, fetchImplementation)

    await expect(
      adapter.ensureAttachment({
        workItemId: 'work-item-id',
        name: 'checkmate-51-proof.png',
        contentType: 'image/png',
        bytes: Buffer.from('png-bytes'),
      }),
    ).rejects.toMatchObject<Partial<PlaneAdapterError>>({
      kind: 'manual_attention',
    })
  })
})
