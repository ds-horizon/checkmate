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
}

export const createPlaneAdapter = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation: Fetch = fetch,
): PlaneAdapter => {
  const config = readPlaneAdapterConfig(environment)
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

    let response: Response
    try {
      response = await fetchImplementation(`${config.baseUrl}/${path}/`, {
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
    } catch (error) {
      throw new PlaneAdapterError(
        `Plane intake create outcome is unknown: ${sanitizePlaneError(error)}`,
        'ambiguous_create',
      )
    } finally {
      clearTimeout(timeout)
    }

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
  }

  return {createIntake}
}
