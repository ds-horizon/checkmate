import {
  capturePlaneOneShotOperatorEnvironment,
  PLANE_CANARY_ONE_SHOT_FLAG,
  PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS,
} from './plane-one-shot-environment'

describe('plane one-shot operator environment', () => {
  it('preserves process-level enablement when a later dotenv import overrides it', () => {
    const processEnvironment: Record<string, string | undefined> = {
      [PLANE_CANARY_ONE_SHOT_FLAG]: 'true',
    }
    const captured = capturePlaneOneShotOperatorEnvironment(processEnvironment)

    processEnvironment[PLANE_CANARY_ONE_SHOT_FLAG] = 'false'

    expect(captured.enabled).toBe(true)
    expect(captured.environment[PLANE_CANARY_ONE_SHOT_FLAG]).toBe('true')
  })

  it('preserves a true worker guard when a later dotenv import overrides it', () => {
    const processEnvironment: Record<string, string | undefined> = {
      [PLANE_CANARY_ONE_SHOT_FLAG]: 'true',
      [PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS[0]]: 'true',
    }
    const captured = capturePlaneOneShotOperatorEnvironment(processEnvironment)

    processEnvironment[PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS[0]] = 'false'

    expect(captured.enabled).toBe(true)
    expect(captured.workerRolesDisabled).toBe(false)
    expect(captured.environment[PLANE_ONE_SHOT_BLOCKING_WORKER_FLAGS[0]]).toBe(
      'true',
    )
  })

  it('fails closed when the one-shot flag is absent or not exactly true', () => {
    expect(capturePlaneOneShotOperatorEnvironment({})).toMatchObject({
      enabled: false,
    })
    expect(
      capturePlaneOneShotOperatorEnvironment({
        [PLANE_CANARY_ONE_SHOT_FLAG]: '1',
      }).enabled,
    ).toBe(false)
  })
})
