import {areResultRevisionCommandsEnabled} from '../resultRevisionFlags'

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
