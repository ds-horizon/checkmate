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
  configEnvironment: Environment
  enabled: boolean
  workerRolesDisabled: boolean
}

/**
 * Capture the operator guard before importing the database client. The
 * entrypoint loads ordinary .env configuration with process precedence first,
 * but canary enablement remains process-only and worker refusal is the union
 * of the original process and raw .env environments. The raw map must be
 * captured separately because ordinary process precedence can hide a .env
 * worker flag set to true behind a process value of false.
 */
export const capturePlaneOneShotOperatorEnvironment = (
  originalEnvironment: Environment = process.env,
  effectiveEnvironment: Environment = originalEnvironment,
  dotenvEnvironment: Environment = {},
): PlaneOneShotOperatorEnvironment => {
  const snapshot: Record<string, string | undefined> = {
    [PLANE_CANARY_ONE_SHOT_FLAG]:
      originalEnvironment[PLANE_CANARY_ONE_SHOT_FLAG],
  }
  for (const flag of PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS) {
    snapshot[flag] =
      originalEnvironment[flag] === 'true' || dotenvEnvironment[flag] === 'true'
        ? 'true'
        : originalEnvironment[flag] ?? dotenvEnvironment[flag]
  }

  return {
    environment: snapshot,
    configEnvironment: {...effectiveEnvironment},
    enabled: originalEnvironment[PLANE_CANARY_ONE_SHOT_FLAG] === 'true',
    workerRolesDisabled: PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS.every(
      (flag) =>
        originalEnvironment[flag] !== 'true' &&
        dotenvEnvironment[flag] !== 'true',
    ),
  }
}
