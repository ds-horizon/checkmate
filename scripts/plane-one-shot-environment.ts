export const PLANE_CANARY_ONE_SHOT_FLAG = 'PLANE_CANARY_ONE_SHOT_ENABLED'
export const PLANE_CANARY_ONE_SHOT_DESTINATION = 'biz-development'

export const PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS = [
  'PLANE_DELIVERY_WORKER_ENABLED',
  'PLANE_RETEST_READINESS_ENABLED',
  'PLANE_RETEST_READINESS_WORKER_ENABLED',
] as const

type Environment = Readonly<Record<string, string | undefined>>

export type PlaneOneShotOperatorEnvironment = {
  environment: Environment
  enabled: boolean
  workerRolesDisabled: boolean
}

/**
 * Capture operator flags before importing the database client. That client
 * loads .env with override enabled in non-production environments, so checks
 * against process.env after the import could use the wrong operator intent.
 */
export const capturePlaneOneShotOperatorEnvironment = (
  environment: Environment = process.env,
): PlaneOneShotOperatorEnvironment => {
  const snapshot: Record<string, string | undefined> = {
    [PLANE_CANARY_ONE_SHOT_FLAG]: environment[PLANE_CANARY_ONE_SHOT_FLAG],
  }
  for (const flag of PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS) {
    snapshot[flag] = environment[flag]
  }

  return {
    environment: snapshot,
    enabled: snapshot[PLANE_CANARY_ONE_SHOT_FLAG] === 'true',
    workerRolesDisabled: PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS.every(
      (flag) => snapshot[flag] !== 'true',
    ),
  }
}
