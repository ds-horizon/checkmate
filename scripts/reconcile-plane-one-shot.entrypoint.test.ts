import {spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {resolve, join} from 'node:path'

const CLI_ARGUMENTS = [
  '--project-id',
  '4',
  '--run-id',
  '17',
  '--test-id',
  '394',
  '--work-item-id',
  'BIZ-41',
  '--intake-id',
  'c2439cb6-8efd-46cc-b930-2acc886b5f9c',
  '--correlation-key',
  'defect-cycle:1:plane-create',
  '--destination',
  'biz-development',
  '--verify-only',
]

const resolveModule = createRequire(resolve(process.cwd(), 'package.json'))

const OPERATOR_ENVIRONMENT_KEYS = [
  'PLANE_CANARY_ONE_SHOT_ENABLED',
  'PLANE_DELIVERY_WORKER_ENABLED',
  'PLANE_RETEST_READINESS_ENABLED',
  'PLANE_RETEST_READINESS_WORKER_ENABLED',
  'PLANE_DESTINATION',
  'PLANE_API_KEY',
  'PLANE_API_TIMEOUT_MS',
  'PLANE_API_BASE_URL',
  'PLANE_MAX_REQUESTS_PER_MINUTE',
  'DB_URL',
  'NODE_ENV',
]

const runEntrypoint = ({
  processEnvironment,
  dotEnv,
}: {
  processEnvironment?: Record<string, string>
  dotEnv: string
}) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'tvp599-one-shot-'))
  writeFileSync(join(temporaryDirectory, '.env'), `${dotEnv.trim()}\n`)
  try {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
    }
    for (const key of OPERATOR_ENVIRONMENT_KEYS) delete environment[key]
    environment.NODE_ENV = 'production'
    Object.assign(environment, processEnvironment)

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        resolveModule.resolve('tsx/esm'),
        resolve(process.cwd(), 'scripts/reconcile-plane-one-shot.ts'),
        ...CLI_ARGUMENTS,
      ],
      {
        cwd: temporaryDirectory,
        encoding: 'utf8',
        env: environment,
        timeout: 10_000,
      },
    )
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error,
    }
  } finally {
    rmSync(temporaryDirectory, {force: true, recursive: true})
  }
}

const ordinaryPlaneConfig = ({timeout}: {timeout: string}) => `
PLANE_CANARY_ONE_SHOT_ENABLED=false
PLANE_DELIVERY_WORKER_ENABLED=false
PLANE_RETEST_READINESS_ENABLED=false
PLANE_RETEST_READINESS_WORKER_ENABLED=false
PLANE_DESTINATION=biz-development
PLANE_API_KEY=temporary-entrypoint-secret
PLANE_API_TIMEOUT_MS=${timeout}
`

describe('plane one-shot entrypoint environment boundary', () => {
  it('loads ordinary config from .env while process canary enablement wins', () => {
    const result = runEntrypoint({
      processEnvironment: {PLANE_CANARY_ONE_SHOT_ENABLED: 'true'},
      dotEnv: ordinaryPlaneConfig({timeout: 'not-a-number'}),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain('PLANE_API_TIMEOUT_MS must be a positive integer')
    expect(output).not.toContain('PLANE_CANARY_ONE_SHOT_ENABLED is disabled')
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('refuses a process-level worker flag before the database client can mask it', () => {
    const result = runEntrypoint({
      processEnvironment: {
        PLANE_CANARY_ONE_SHOT_ENABLED: 'true',
        PLANE_DELIVERY_WORKER_ENABLED: 'true',
      },
      dotEnv: ordinaryPlaneConfig({timeout: '100'}),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain(
      'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    )
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('refuses a delivery worker enabled only by .env before the database client loads', () => {
    const result = runEntrypoint({
      processEnvironment: {PLANE_CANARY_ONE_SHOT_ENABLED: 'true'},
      dotEnv: ordinaryPlaneConfig({timeout: '100'}).replace(
        'PLANE_DELIVERY_WORKER_ENABLED=false',
        'PLANE_DELIVERY_WORKER_ENABLED=true',
      ),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain(
      'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    )
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('refuses a delivery worker when process false hides .env true', () => {
    const result = runEntrypoint({
      processEnvironment: {
        PLANE_CANARY_ONE_SHOT_ENABLED: 'true',
        PLANE_DELIVERY_WORKER_ENABLED: 'false',
      },
      dotEnv: ordinaryPlaneConfig({timeout: '100'}).replace(
        'PLANE_DELIVERY_WORKER_ENABLED=false',
        'PLANE_DELIVERY_WORKER_ENABLED=true',
      ),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain(
      'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    )
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('refuses a readiness worker enabled only by .env before the database client loads', () => {
    const result = runEntrypoint({
      processEnvironment: {PLANE_CANARY_ONE_SHOT_ENABLED: 'true'},
      dotEnv: ordinaryPlaneConfig({timeout: '100'}).replace(
        'PLANE_RETEST_READINESS_ENABLED=false',
        'PLANE_RETEST_READINESS_ENABLED=true',
      ),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain(
      'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    )
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('refuses a readiness worker when process false hides .env true', () => {
    const result = runEntrypoint({
      processEnvironment: {
        PLANE_CANARY_ONE_SHOT_ENABLED: 'true',
        PLANE_RETEST_READINESS_ENABLED: 'false',
      },
      dotEnv: ordinaryPlaneConfig({timeout: '100'}).replace(
        'PLANE_RETEST_READINESS_ENABLED=false',
        'PLANE_RETEST_READINESS_ENABLED=true',
      ),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain(
      'Plane one-shot refused while a global delivery/readiness worker role is enabled',
    )
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('does not enable the one-shot from a .env flag when the process flag is absent', () => {
    const result = runEntrypoint({
      dotEnv: ordinaryPlaneConfig({timeout: '100'}).replace(
        'PLANE_CANARY_ONE_SHOT_ENABLED=false',
        'PLANE_CANARY_ONE_SHOT_ENABLED=true',
      ),
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain('PLANE_CANARY_ONE_SHOT_ENABLED is disabled')
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('requires process NODE_ENV production even when .env says production', () => {
    const result = runEntrypoint({
      processEnvironment: {
        NODE_ENV: 'test',
        PLANE_CANARY_ONE_SHOT_ENABLED: 'true',
      },
      dotEnv: `${ordinaryPlaneConfig({timeout: '100'})}\nNODE_ENV=production`,
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain('NODE_ENV must be exactly production')
    expect(output).not.toContain('temporary-entrypoint-secret')
  })

  it('keeps a process DB_URL authoritative over the shared .env DB_URL', () => {
    const result = runEntrypoint({
      processEnvironment: {
        PLANE_CANARY_ONE_SHOT_ENABLED: 'true',
        DB_URL: 'not a url',
      },
      dotEnv: `${ordinaryPlaneConfig({timeout: '100'})}\nDB_URL=mysql://dotenv:dotenv-pass@dotenv-db-url.invalid:3306/checkmate`,
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(result.error).toBeUndefined()
    expect(output).toContain('Invalid URL')
    expect(output).not.toContain('dotenv-db-url.invalid')
    expect(output).not.toContain('operator-pass')
    expect(output).not.toContain('dotenv-pass')
  })
})
