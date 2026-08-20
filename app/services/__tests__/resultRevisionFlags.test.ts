import {
  arePlaneApiWritesEnabled,
  areResultRevisionCommandsEnabled,
  isPlaneDeliveryWorkerEnabled,
} from '../resultRevisionFlags'

describe('areResultRevisionCommandsEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(areResultRevisionCommandsEnabled({})).toBe(false)
    expect(
      areResultRevisionCommandsEnabled({
        RESULT_REVISION_COMMANDS_ENABLED: 'false',
      }),
    ).toBe(false)
  })

  it('accepts only the explicit true value', () => {
    expect(
      areResultRevisionCommandsEnabled({
        RESULT_REVISION_COMMANDS_ENABLED: 'true',
      }),
    ).toBe(true)
    expect(
      areResultRevisionCommandsEnabled({
        RESULT_REVISION_COMMANDS_ENABLED: 'TRUE',
      }),
    ).toBe(false)
  })
})

describe('Plane integration flags', () => {
  it('keeps the worker and provider writes disabled by default', () => {
    expect(isPlaneDeliveryWorkerEnabled({})).toBe(false)
    expect(arePlaneApiWritesEnabled({})).toBe(false)
  })

  it('accepts only an explicit lowercase true for each boundary', () => {
    expect(
      isPlaneDeliveryWorkerEnabled({PLANE_DELIVERY_WORKER_ENABLED: 'true'}),
    ).toBe(true)
    expect(
      arePlaneApiWritesEnabled({PLANE_API_WRITES_ENABLED: 'true'}),
    ).toBe(true)
    expect(
      isPlaneDeliveryWorkerEnabled({PLANE_DELIVERY_WORKER_ENABLED: 'TRUE'}),
    ).toBe(false)
    expect(
      arePlaneApiWritesEnabled({PLANE_API_WRITES_ENABLED: '1'}),
    ).toBe(false)
  })
})
