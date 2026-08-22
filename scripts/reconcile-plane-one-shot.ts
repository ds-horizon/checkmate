import dotenv from 'dotenv'
import {
  createPlaneAdapter,
  readPlaneAdapterConfig,
  sanitizePlaneError,
} from '../app/services/planeAdapter'
import type {PlaneOneShotReconciliationInput} from '../app/services/planeOneShotReconciliation'
import {
  capturePlaneOneShotOperatorEnvironment,
  PLANE_CANARY_ONE_SHOT_DESTINATION,
  PLANE_CANARY_ONE_SHOT_FLAG,
} from './plane-one-shot-environment'

const originalProcessEnvironment = {...process.env}
dotenv.config({override: false})
const effectiveEnvironment = {...process.env}
const operatorEnvironment = capturePlaneOneShotOperatorEnvironment(
  originalProcessEnvironment,
  effectiveEnvironment,
)

const USAGE = `Usage: yarn plane:reconcile-one-shot \\
  --project-id <id> --run-id <id> --test-id <id> \\
  --work-item-id <id> --intake-id <id> --correlation-key <key> \\
  --destination biz-development`

const ARGUMENTS = {
  '--project-id': 'projectId',
  '--run-id': 'runId',
  '--test-id': 'testId',
  '--work-item-id': 'expectedWorkItemId',
  '--intake-id': 'expectedIntakeId',
  '--correlation-key': 'expectedCorrelationKey',
  '--destination': 'expectedDestination',
} as const

type ParsedValue = {
  projectId?: string
  runId?: string
  testId?: string
  expectedWorkItemId?: string
  expectedIntakeId?: string
  expectedCorrelationKey?: string
  expectedDestination?: string
}

const parseArguments = (argv: string[]): PlaneOneShotReconciliationInput => {
  const parsed: ParsedValue = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(0)
    }
    const field = ARGUMENTS[argument as keyof typeof ARGUMENTS]
    if (!field || parsed[field] !== undefined) {
      throw new Error(`Unknown or duplicate argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`)
    }
    parsed[field] = value
    index += 1
  }

  const toPositiveInteger = (field: keyof ParsedValue) => {
    const value = Number(parsed[field])
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${field} must be a positive integer`)
    }
    return value
  }
  const required = (field: keyof ParsedValue) => {
    const value = parsed[field]?.trim()
    if (!value) throw new Error(`${field} is required`)
    return value
  }

  const expectedDestination = required('expectedDestination')
  if (expectedDestination !== PLANE_CANARY_ONE_SHOT_DESTINATION) {
    throw new Error(
      `expectedDestination must be ${PLANE_CANARY_ONE_SHOT_DESTINATION}`,
    )
  }
  return {
    projectId: toPositiveInteger('projectId'),
    runId: toPositiveInteger('runId'),
    testId: toPositiveInteger('testId'),
    expectedWorkItemId: required('expectedWorkItemId'),
    expectedIntakeId: required('expectedIntakeId'),
    expectedCorrelationKey: required('expectedCorrelationKey'),
    expectedDestination,
  }
}

const main = async () => {
  const input = parseArguments(process.argv.slice(2))
  if (!operatorEnvironment.enabled) {
    process.stdout.write(
      `${JSON.stringify({
        outcome: 'refused',
        projectId: input.projectId,
        runId: input.runId,
        testId: input.testId,
        reason: `${PLANE_CANARY_ONE_SHOT_FLAG} is disabled`,
      })}\n`,
    )
    process.exitCode = 1
    return
  }
  if (!operatorEnvironment.workerRolesDisabled) {
    process.stdout.write(
      `${JSON.stringify({
        outcome: 'refused',
        projectId: input.projectId,
        runId: input.runId,
        testId: input.testId,
        reason:
          'Plane one-shot refused while a global delivery/readiness worker role is enabled',
      })}\n`,
    )
    process.exitCode = 1
    return
  }

  process.stderr.write(
    'WARNING: operator-only one-shot; do not run concurrently with delivery/readiness workers or manual retries.\n',
  )

  // The API key is read only inside this process and is never included in the
  // result or error output. The one-shot path performs a single bounded GET.
  const config = readPlaneAdapterConfig(operatorEnvironment.configEnvironment)
  const planeAdapter = createPlaneAdapter(operatorEnvironment.configEnvironment)
  const {client} = await import('../app/db/client')
  try {
    const {reconcilePlaneDefectOneShot} = await import(
      '../app/services/planeOneShotReconciliation'
    )
    const result = await reconcilePlaneDefectOneShot({
      input,
      config,
      planeAdapter,
      enabled: operatorEnvironment.enabled,
      environment: operatorEnvironment.environment,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.outcome === 'manual_attention' || result.outcome === 'refused') {
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Plane one-shot reconciliation failed: ${sanitizePlaneError(error)}\n`,
  )
  process.exitCode = 1
})
