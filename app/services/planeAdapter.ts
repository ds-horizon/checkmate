const DEFAULT_TIMEOUT_MS = 10_000
// Two singleton Plane workers share one API key. Keep each process at half of
// the approved combined budget unless an operator explicitly tightens it.
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 6
const MAX_REQUESTS_PER_MINUTE = 60
const MAX_REQUEST_WAIT_MS = 60_000
const MAX_ERROR_LENGTH = 500

/** The maximum documented number of Plane API calls for one outbox event. */
export const MAX_PLANE_API_REQUESTS_PER_DELIVERY = 6

const PLANE_DESTINATIONS = {
  'biz-development': {
    publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
    workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
    workspaceSlug: 'infinimind',
    projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
    projectIdentifier: 'BIZ',
  },
} as const

export type PlanePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export type PlaneAdapterConfig = {
  apiBaseUrl: string
  publicBaseUrl: string
  apiKey: string
  workspaceId: string
  workspaceSlug: string
  projectId: string
  projectIdentifier: string
  timeoutMs: number
  maxRequestsPerMinute: number
  maxRequestWaitMs: number
}

type Now = () => number
type Sleep = (milliseconds: number) => Promise<void>

export type PlaneRequestLimiter = {
  wait(): Promise<void>
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * Enforces a rolling one-minute limit on Plane API starts. Reserving a slot
 * before sleeping prevents concurrent callers from creating a post-wait burst.
 */
export const createPlaneRequestLimiter = ({
  requestsPerMinute,
  now = Date.now,
  sleepFor = sleep,
}: {
  requestsPerMinute: number
  now?: Now
  sleepFor?: Sleep
}): PlaneRequestLimiter => {
  if (
    !Number.isInteger(requestsPerMinute) ||
    requestsPerMinute < 1 ||
    requestsPerMinute > MAX_REQUESTS_PER_MINUTE
  ) {
    throw new Error(
      `PLANE_MAX_REQUESTS_PER_MINUTE must be between 1 and ${MAX_REQUESTS_PER_MINUTE}`,
    )
  }
  const reservedStarts: number[] = []

  return {
    async wait() {
      const requestedOn = now()
      const firstRelevantStart = reservedStarts.findIndex(
        (startedOn) => startedOn > requestedOn - MAX_REQUEST_WAIT_MS,
      )
      if (firstRelevantStart > 0) {
        reservedStarts.splice(0, firstRelevantStart)
      } else if (firstRelevantStart === -1) {
        reservedStarts.splice(0)
      }
      let permittedOn = requestedOn
      while (
        reservedStarts.filter(
          (startedOn) =>
            startedOn > permittedOn - MAX_REQUEST_WAIT_MS &&
            startedOn <= permittedOn,
        ).length >= requestsPerMinute
      ) {
        const oldestStart = reservedStarts.find(
          (startedOn) => startedOn > permittedOn - MAX_REQUEST_WAIT_MS,
        )
        if (oldestStart === undefined) break
        permittedOn = oldestStart + MAX_REQUEST_WAIT_MS
      }
      reservedStarts.push(permittedOn)
      const delayMs = permittedOn - requestedOn
      if (delayMs > 0) await sleepFor(delayMs)
    },
  }
}

export type PlaneIntakeCreateRequest = {
  title: string
  description: string
  priority: PlanePriority
}

export type PlaneIntakeCreateResponse = {
  intakeId: string | null
  workItemId: string
  sequenceId: number | null
  projectIdentifier: string | null
  raw: Record<string, unknown>
}

export type PlaneCommentDeliveryRequest = {
  workItemId: string
  marker: string
  commentHtml: string
}

export type PlaneCommentDeliveryResponse = {
  commentId: string
}

export type PlaneAttachmentDeliveryRequest = {
  workItemId: string
  name: string
  contentType: string
  bytes: Buffer
}

export type PlaneAttachmentDeliveryResponse = {
  assetId: string
  attachmentId: string
}

export type PlaneWorkItem = {
  workItemId: string
  stateId: string
  versionMarker: string | null
  raw: Record<string, unknown>
  source?: 'work_item' | 'intake'
}

export type PlaneIntakeWorkItemRequest = {
  workItemId: string
  intakeId: string
}

export type PlaneWorkItemStateRequest = {
  workItemId: string
  stateId: string
}

export type PlaneErrorKind =
  | 'retryable'
  | 'ambiguous_create'
  | 'manual_attention'

export class PlaneAdapterError extends Error {
  constructor(
    message: string,
    readonly kind: PlaneErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'PlaneAdapterError'
  }
}

type Fetch = typeof fetch

const required = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
) => {
  const value = environment[name]?.trim()
  if (!value)
    throw new Error(`${name} is required when Plane writes are enabled`)
  return value
}

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
  name: string,
) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const readMaxRequestsPerMinute = (value: string | undefined) => {
  const parsed = parsePositiveInteger(
    value,
    DEFAULT_MAX_REQUESTS_PER_MINUTE,
    'PLANE_MAX_REQUESTS_PER_MINUTE',
  )
  if (parsed > MAX_REQUESTS_PER_MINUTE) {
    throw new Error(
      `PLANE_MAX_REQUESTS_PER_MINUTE must be between 1 and ${MAX_REQUESTS_PER_MINUTE}`,
    )
  }
  return parsed
}

const readApiBaseUrl = (
  value: string | undefined,
  defaultValue: string,
) => {
  const apiBaseUrl = value ?? defaultValue
  const allowed = [
    'https://plane-dev.geep-fence.ts.net',
    'http://plane-app-api.plane.svc.cluster.local:8000',
  ] as const
  if (!allowed.some((origin) => origin === apiBaseUrl)) {
    throw new Error('PLANE_API_BASE_URL is not an approved exact origin')
  }
  return apiBaseUrl
}

export const readPlaneAdapterConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlaneAdapterConfig => {
  const destinationName = required(environment, 'PLANE_DESTINATION')
  if (!(destinationName in PLANE_DESTINATIONS)) {
    throw new Error(`PLANE_DESTINATION is not allowlisted: ${destinationName}`)
  }
  const destination =
    PLANE_DESTINATIONS[destinationName as keyof typeof PLANE_DESTINATIONS]

  const maxRequestsPerMinute = readMaxRequestsPerMinute(
    environment.PLANE_MAX_REQUESTS_PER_MINUTE,
  )
  return {
    ...destination,
    apiBaseUrl: readApiBaseUrl(
      environment.PLANE_API_BASE_URL,
      destination.publicBaseUrl,
    ),
    apiKey: required(environment, 'PLANE_API_KEY'),
    timeoutMs: parsePositiveInteger(
      environment.PLANE_API_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'PLANE_API_TIMEOUT_MS',
    ),
    maxRequestsPerMinute,
    maxRequestWaitMs: MAX_REQUEST_WAIT_MS,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const numberValue = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null

const objectOrStringId = (value: unknown) =>
  stringValue(value) ?? (isRecord(value) ? stringValue(value.id) : null)

export const sanitizePlaneError = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value)
  return text
    .replace(
      /\bX-API-Key\s*[:=]?\s*["']?[^"',;\s]+["']?/gi,
      'X-API-Key [redacted]',
    )
    .replace(/\bBearer\s+[^"',;\s]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[_-]?key|token|secret)\s*[:=]\s*["']?[^"',;\s]+["']?/gi,
      '$1=[redacted]',
    )
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .slice(0, MAX_ERROR_LENGTH)
}

const responseMessage = async (response: Response) => {
  const body = await response.text()
  if (!body) return `Plane returned HTTP ${response.status}`

  try {
    const parsed = JSON.parse(body)
    if (isRecord(parsed)) {
      const detail = stringValue(parsed.detail) ?? stringValue(parsed.message)
      if (detail) return detail.slice(0, MAX_ERROR_LENGTH)
    }
  } catch {
    // A bounded plain-text provider error is still useful to operators.
  }

  return sanitizePlaneError(body)
}

const parseRetryAfterMs = (value: string | null) => {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) return undefined
  return Math.max(0, retryAt - Date.now())
}

const parseIntakeResponse = (value: unknown): PlaneIntakeCreateResponse => {
  if (!isRecord(value)) {
    throw new PlaneAdapterError(
      'Plane create response was not an object',
      'manual_attention',
    )
  }

  const issue = isRecord(value.issue_detail)
    ? value.issue_detail
    : isRecord(value.issue)
      ? value.issue
      : null
  const workItemId = issue
    ? stringValue(issue.id)
    : stringValue(value.issue)
  if (!workItemId) {
    throw new PlaneAdapterError(
      'Plane create response did not include a work item id',
      'manual_attention',
    )
  }

  return {
    intakeId: stringValue(value.id),
    workItemId,
    sequenceId: issue ? numberValue(issue.sequence_id) : null,
    projectIdentifier: issue
      ? stringValue(issue.project_identifier)
      : null,
    raw: value,
  }
}

const parseWorkItem = (
  requestedWorkItemId: string,
  value: unknown,
): PlaneWorkItem => {
  if (!isRecord(value)) {
    throw new PlaneAdapterError(
      'Plane work item response was not an object',
      'manual_attention',
    )
  }

  const workItemId = stringValue(value.id)
  const state = value.state
  const stateId =
    stringValue(state) ?? (isRecord(state) ? stringValue(state.id) : null)
  const version =
    stringValue(value.updated_at) ??
    stringValue(value.updatedAt) ??
    stringValue(value.updated_on) ??
    (numberValue(value.version) === null
      ? null
      : String(numberValue(value.version)))
  if (!workItemId || !stateId) {
    throw new PlaneAdapterError(
      'Plane work item response did not include an id and state id',
      'manual_attention',
    )
  }
  if (workItemId !== requestedWorkItemId) {
    throw new PlaneAdapterError(
      'Plane work item response did not match the requested id',
      'manual_attention',
    )
  }

  const workspaceId = objectOrStringId(value.workspace)
  const projectId = objectOrStringId(value.project)
  // Preserve the provider response while exposing scalar/object destination
  // fields through the same aliases used by the Intake envelope. Never infer
  // a project identifier from a UUID; only a provider-supplied identifier is
  // authoritative.
  const raw = {
    ...value,
    ...(workspaceId && value.workspace_id === undefined
      ? {workspace_id: workspaceId}
      : {}),
    ...(projectId && value.project_id === undefined
      ? {project_id: projectId}
      : {}),
  }

  return {workItemId, stateId, versionMarker: version, raw}
}

const parseIntakeWorkItem = (
  config: PlaneAdapterConfig,
  request: PlaneIntakeWorkItemRequest,
  value: unknown,
): PlaneWorkItem => {
  if (!isRecord(value) || !isRecord(value.issue_detail)) {
    throw new PlaneAdapterError(
      'Plane intake response did not include the exact backing issue envelope',
      'manual_attention',
    )
  }

  const issueDetail = value.issue_detail
  const wrapperIntakeId = stringValue(value.id)
  const wrapperWorkItemId = stringValue(value.issue)
  const detailWorkItemId = stringValue(issueDetail.id)
  if (
    wrapperIntakeId !== request.intakeId ||
    wrapperWorkItemId !== request.workItemId ||
    detailWorkItemId !== request.workItemId
  ) {
    throw new PlaneAdapterError(
      'Plane intake response did not match the exact wrapper and backing issue',
      'manual_attention',
    )
  }

  const wrapperWorkspaceId = objectOrStringId(value.workspace)
  const detailWorkspaceId = objectOrStringId(issueDetail.workspace)
  const wrapperProjectId = objectOrStringId(value.project)
  const detailProjectId = objectOrStringId(issueDetail.project)
  if (
    wrapperWorkspaceId !== config.workspaceId ||
    detailWorkspaceId !== wrapperWorkspaceId ||
    wrapperProjectId !== config.projectId ||
    detailProjectId !== wrapperProjectId
  ) {
    throw new PlaneAdapterError(
      'Plane intake response did not match the exact pinned destination',
      'manual_attention',
    )
  }

  const state = issueDetail.state
  const stateId = objectOrStringId(state)
  if (!stateId) {
    throw new PlaneAdapterError(
      'Plane intake response did not include an authoritative state',
      'manual_attention',
    )
  }

  // Keep the provider's Intake shape and do not invent a project identifier;
  // destination identity is proven by the scoped wrapper/inner UUIDs above.
  const raw = {
    ...value,
    state,
    workspace_id: wrapperWorkspaceId,
    project_id: wrapperProjectId,
    intake_id: wrapperIntakeId,
    name: issueDetail.name,
    description: issueDetail.description,
    sequence_id: issueDetail.sequence_id,
  }
  const version =
    stringValue(issueDetail.updated_at) ?? stringValue(value.updated_at)
  return {
    workItemId: detailWorkItemId,
    stateId,
    versionMarker: version,
    raw,
    source: 'intake',
  }
}

export type PlaneAdapter = {
  createIntake(
    request: PlaneIntakeCreateRequest,
  ): Promise<PlaneIntakeCreateResponse>
  getWorkItem(workItemId: string): Promise<PlaneWorkItem>
  ensureComment(
    request: PlaneCommentDeliveryRequest,
  ): Promise<PlaneCommentDeliveryResponse>
  ensureAttachment(
    request: PlaneAttachmentDeliveryRequest,
  ): Promise<PlaneAttachmentDeliveryResponse>
  ensureWorkItemState(
    request: PlaneWorkItemStateRequest,
  ): Promise<PlaneWorkItem>
}

export type PlaneOneShotAdapter = Pick<PlaneAdapter, 'getWorkItem'> & {
  getIntakeWorkItem(
    request: PlaneIntakeWorkItemRequest,
  ): Promise<PlaneWorkItem>
}

export const createPlaneAdapter = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation: Fetch = fetch,
  requestLimiter?: PlaneRequestLimiter,
): PlaneAdapter & PlaneOneShotAdapter => {
  const config = readPlaneAdapterConfig(environment)
  const limiter =
    requestLimiter ??
    createPlaneRequestLimiter({
      requestsPerMinute: config.maxRequestsPerMinute,
    })
  const workItemPath = (workItemId: string, resource?: string) =>
    [
      'api',
      'v1',
      'workspaces',
      encodeURIComponent(config.workspaceSlug),
      'projects',
      encodeURIComponent(config.projectId),
      'work-items',
      encodeURIComponent(workItemId),
      ...(resource ? [resource] : []),
    ].join('/')
  const intakePath = (workItemId: string) =>
    [
      'api',
      'v1',
      'workspaces',
      encodeURIComponent(config.workspaceSlug),
      'projects',
      encodeURIComponent(config.projectId),
      'intake-issues',
      encodeURIComponent(workItemId),
    ].join('/')

  const planeFetch = async (
    path: string,
    init: RequestInit,
    ambiguousWrite: boolean,
  ) => {
    // This gate is immediately before every Plane API request. Attachment
    // payload uploads use object storage and retain their own timeout below.
    await limiter.wait()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetchImplementation(`${config.apiBaseUrl}/${path}/`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'X-API-Key': config.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = sanitizePlaneError(await responseMessage(response))
        if (response.status === 429) {
          throw new PlaneAdapterError(
            `Plane request was rate limited: ${message}`,
            'retryable',
            parseRetryAfterMs(response.headers.get('retry-after')),
          )
        }
        if (response.status === 408 || response.status >= 500) {
          throw new PlaneAdapterError(
            `Plane request failed: ${message}`,
            ambiguousWrite ? 'ambiguous_create' : 'retryable',
          )
        }
        throw new PlaneAdapterError(
          `Plane request was rejected: ${message}`,
          'manual_attention',
        )
      }
      if (response.status === 204) return null
      try {
        return (await response.json()) as unknown
      } catch (error) {
        throw new PlaneAdapterError(
          `Plane returned invalid JSON: ${sanitizePlaneError(error)}`,
          'manual_attention',
        )
      }
    } catch (error) {
      if (error instanceof PlaneAdapterError) throw error
      throw new PlaneAdapterError(
        `Plane request failed: ${sanitizePlaneError(error)}`,
        ambiguousWrite ? 'ambiguous_create' : 'retryable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  const listValues = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.filter(isRecord)
    if (!isRecord(value)) return []
    const results = Array.isArray(value.results)
      ? value.results
      : Array.isArray(value.data)
      ? value.data
      : []
    return results.filter(isRecord)
  }

  const findComment = async (request: PlaneCommentDeliveryRequest) => {
    const value = await planeFetch(
      workItemPath(request.workItemId, 'comments'),
      {method: 'GET'},
      false,
    )
    const found = listValues(value).find((comment) =>
      (stringValue(comment.comment_html) ?? '').includes(request.marker),
    )
    const commentId = found ? stringValue(found.id) : null
    return commentId ? {commentId} : null
  }

  const ensureComment = async (request: PlaneCommentDeliveryRequest) => {
    const existing = await findComment(request)
    if (existing) return existing

    try {
      const value = await planeFetch(
        workItemPath(request.workItemId, 'comments'),
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({comment_html: request.commentHtml}),
        },
        true,
      )
      const commentId = isRecord(value) ? stringValue(value.id) : null
      if (!commentId) {
        throw new PlaneAdapterError(
          'Plane comment response did not include an id',
          'manual_attention',
        )
      }
      return {commentId}
    } catch (error) {
      if (
        error instanceof PlaneAdapterError &&
        error.kind === 'ambiguous_create'
      ) {
        const reconciled = await findComment(request)
        if (reconciled) return reconciled
      }
      throw error
    }
  }

  const findAttachment = async (request: PlaneAttachmentDeliveryRequest) => {
    const value = await planeFetch(
      workItemPath(request.workItemId, 'attachments'),
      {method: 'GET'},
      false,
    )
    const found = listValues(value).find(
      (attachment) =>
        stringValue(attachment.name) === request.name &&
        numberValue(attachment.size) === request.bytes.byteLength,
    )
    if (!found) return null
    if (found.is_uploaded !== true) return {pending: true as const}
    const assetId =
      stringValue(found.asset_id) ??
      stringValue(found.asset) ??
      stringValue(found.id)
    const attachmentId = stringValue(found.id) ?? assetId
    return assetId && attachmentId ? {assetId, attachmentId} : null
  }

  const ensureAttachment = async (request: PlaneAttachmentDeliveryRequest) => {
    const existing = await findAttachment(request)
    if (existing && !('pending' in existing)) return existing
    if (existing?.pending) {
      throw new PlaneAdapterError(
        'Plane has a matching attachment slot that is not finalized',
        'manual_attention',
      )
    }

    let slot: unknown
    try {
      slot = await planeFetch(
        workItemPath(request.workItemId, 'attachments'),
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            name: request.name,
            type: request.contentType,
            size: request.bytes.byteLength,
          }),
        },
        true,
      )
    } catch (error) {
      if (
        error instanceof PlaneAdapterError &&
        error.kind === 'ambiguous_create'
      ) {
        const reconciled = await findAttachment(request)
        if (reconciled && !('pending' in reconciled)) return reconciled
        if (reconciled?.pending) {
          throw new PlaneAdapterError(
            'Plane has a matching attachment slot that is not finalized',
            'manual_attention',
          )
        }
      }
      throw error
    }
    if (!isRecord(slot) || !isRecord(slot.upload_data)) {
      throw new PlaneAdapterError(
        'Plane attachment slot response was invalid',
        'manual_attention',
      )
    }
    const uploadUrl = stringValue(slot.upload_data.url)
    const fields = isRecord(slot.upload_data.fields)
      ? slot.upload_data.fields
      : null
    const assetId = stringValue(slot.asset_id)
    const attachment = isRecord(slot.attachment) ? slot.attachment : null
    const attachmentId =
      (attachment ? stringValue(attachment.id) : null) ?? assetId
    if (!uploadUrl || !fields || !assetId || !attachmentId) {
      throw new PlaneAdapterError(
        'Plane attachment slot omitted required upload data',
        'manual_attention',
      )
    }

    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== 'string') {
        throw new PlaneAdapterError(
          'Plane attachment slot included an invalid form field',
          'manual_attention',
        )
      }
      form.append(key, value)
    }
    form.append(
      'file',
      new Blob([new Uint8Array(request.bytes)], {type: request.contentType}),
      request.name,
    )

    const uploadController = new AbortController()
    const uploadTimeout = setTimeout(
      () => uploadController.abort(),
      config.timeoutMs,
    )
    let uploadResponse: Response
    try {
      uploadResponse = await fetchImplementation(uploadUrl, {
        method: 'POST',
        body: form,
        signal: uploadController.signal,
      })
    } catch (error) {
      throw new PlaneAdapterError(
        `Plane object upload outcome is unknown: ${sanitizePlaneError(error)}`,
        'manual_attention',
      )
    } finally {
      clearTimeout(uploadTimeout)
    }
    if (!uploadResponse.ok) {
      throw new PlaneAdapterError(
        `Plane object upload failed with HTTP ${uploadResponse.status}`,
        'manual_attention',
      )
    }

    try {
      await planeFetch(
        `${workItemPath(
          request.workItemId,
          'attachments',
        )}/${encodeURIComponent(assetId)}`,
        {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({is_uploaded: true}),
        },
        true,
      )
    } catch (error) {
      const reconciled = await findAttachment(request)
      if (reconciled && !('pending' in reconciled)) return reconciled
      if (reconciled?.pending) {
        throw new PlaneAdapterError(
          'Plane has a matching attachment slot that is not finalized',
          'manual_attention',
        )
      }
      throw error
    }

    return {assetId, attachmentId}
  }
  const createIntake = async (request: PlaneIntakeCreateRequest) => {
    const path = [
      'api',
      'v1',
      'workspaces',
      encodeURIComponent(config.workspaceSlug),
      'projects',
      encodeURIComponent(config.projectId),
      'intake-issues',
    ].join('/')

    // The rate-limit queue can legitimately outlast the network timeout.
    await limiter.wait()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetchImplementation(`${config.apiBaseUrl}/${path}/`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
        },
        body: JSON.stringify({
          issue: {
            name: request.title,
            description: request.description,
            priority: request.priority,
          },
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = sanitizePlaneError(await responseMessage(response))
        if (response.status === 429) {
          throw new PlaneAdapterError(
            `Plane intake create failed: ${message}`,
            'retryable',
            parseRetryAfterMs(response.headers.get('retry-after')),
          )
        }
        if (response.status === 408 || response.status >= 500) {
          throw new PlaneAdapterError(
            `Plane intake create outcome is unknown: ${message}`,
            'ambiguous_create',
          )
        }
        throw new PlaneAdapterError(
          `Plane intake create was rejected: ${message}`,
          'manual_attention',
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch (error) {
        throw new PlaneAdapterError(
          `Plane intake create returned invalid JSON: ${sanitizePlaneError(
            error,
          )}`,
          'manual_attention',
        )
      }
      return parseIntakeResponse(body)
    } catch (error) {
      if (error instanceof PlaneAdapterError) throw error
      throw new PlaneAdapterError(
        `Plane intake create outcome is unknown: ${sanitizePlaneError(error)}`,
        'ambiguous_create',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  const getWorkItem = async (workItemId: string) => {
    const body = await planeFetch(
      workItemPath(workItemId),
      {method: 'GET'},
      false,
    )
    return parseWorkItem(workItemId, body)
  }

  const getIntakeWorkItem = async (
    request: PlaneIntakeWorkItemRequest,
  ) => {
    const body = await planeFetch(
      intakePath(request.workItemId),
      {method: 'GET'},
      false,
    )
    return parseIntakeWorkItem(config, request, body)
  }

  const ensureWorkItemState = async (request: PlaneWorkItemStateRequest) => {
    const current = await getWorkItem(request.workItemId)
    if (current.stateId === request.stateId) return current

    try {
      const body = await planeFetch(
        workItemPath(request.workItemId),
        {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({state: request.stateId}),
        },
        true,
      )
      const updated = parseWorkItem(request.workItemId, body)
      if (updated.stateId !== request.stateId) {
        throw new PlaneAdapterError(
          'Plane work item update did not return the requested state',
          'manual_attention',
        )
      }
      return updated
    } catch (error) {
      if (
        error instanceof PlaneAdapterError &&
        error.kind === 'ambiguous_create'
      ) {
        const reconciled = await getWorkItem(request.workItemId)
        if (reconciled.stateId === request.stateId) return reconciled
        throw new PlaneAdapterError(
          'Plane work item state update outcome is unknown',
          'retryable',
          error.retryAfterMs,
        )
      }
      throw error
    }
  }

  return {
    createIntake,
    getWorkItem,
    getIntakeWorkItem,
    ensureComment,
    ensureAttachment,
    ensureWorkItemState,
  }
}
