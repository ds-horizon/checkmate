const DEFAULT_TIMEOUT_MS = 10_000
const MAX_ERROR_LENGTH = 500

const PLANE_DESTINATIONS = {
  'biz-development': {
    baseUrl: 'https://plane-dev.geep-fence.ts.net',
    workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
    workspaceSlug: 'infinimind',
    projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
    projectIdentifier: 'BIZ',
  },
} as const

export type PlanePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export type PlaneAdapterConfig = {
  baseUrl: string
  apiKey: string
  workspaceId: string
  workspaceSlug: string
  projectId: string
  projectIdentifier: string
  timeoutMs: number
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
  if (!value) throw new Error(`${name} is required when Plane writes are enabled`)
  return value
}

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('PLANE_API_TIMEOUT_MS must be a positive integer')
  }
  return parsed
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

  return {
    ...destination,
    apiKey: required(environment, 'PLANE_API_KEY'),
    timeoutMs: parsePositiveInteger(
      environment.PLANE_API_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const numberValue = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null

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

  const issue = isRecord(value.issue) ? value.issue : value
  const workItemId = stringValue(issue.id)
  if (!workItemId) {
    throw new PlaneAdapterError(
      'Plane create response did not include a work item id',
      'manual_attention',
    )
  }

  return {
    intakeId: stringValue(value.id),
    workItemId,
    sequenceId: numberValue(issue.sequence_id),
    projectIdentifier: stringValue(issue.project_identifier),
    raw: value,
  }
}

export type PlaneAdapter = {
  createIntake(request: PlaneIntakeCreateRequest): Promise<PlaneIntakeCreateResponse>
  ensureComment(
    request: PlaneCommentDeliveryRequest,
  ): Promise<PlaneCommentDeliveryResponse>
  ensureAttachment(
    request: PlaneAttachmentDeliveryRequest,
  ): Promise<PlaneAttachmentDeliveryResponse>
}

export const createPlaneAdapter = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation: Fetch = fetch,
): PlaneAdapter => {
  const config = readPlaneAdapterConfig(environment)
  const workItemPath = (workItemId: string, resource: string) =>
    [
      'api',
      'v1',
      'workspaces',
      encodeURIComponent(config.workspaceSlug),
      'projects',
      encodeURIComponent(config.projectId),
      'work-items',
      encodeURIComponent(workItemId),
      resource,
    ].join('/')

  const planeFetch = async (
    path: string,
    init: RequestInit,
    ambiguousWrite: boolean,
  ) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetchImplementation(`${config.baseUrl}/${path}/`, {
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
      stringValue(found.asset_id) ?? stringValue(found.asset) ?? stringValue(found.id)
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
        `${workItemPath(request.workItemId, 'attachments')}/${encodeURIComponent(assetId)}`,
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    const path = [
      'api',
      'v1',
      'workspaces',
      encodeURIComponent(config.workspaceSlug),
      'projects',
      encodeURIComponent(config.projectId),
      'intake-issues',
    ].join('/')

    try {
      const response = await fetchImplementation(`${config.baseUrl}/${path}/`, {
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
          `Plane intake create returned invalid JSON: ${sanitizePlaneError(error)}`,
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

  return {createIntake, ensureComment, ensureAttachment}
}
