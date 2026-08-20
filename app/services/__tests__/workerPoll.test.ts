import {waitForWorkerPoll} from '../workerPoll'

describe('waitForWorkerPoll', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves immediately when shutdown was already requested', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      waitForWorkerPoll(5 * 60_000, controller.signal),
    ).resolves.toBeUndefined()
  })

  it('wakes an idle worker when shutdown is requested', async () => {
    jest.useFakeTimers()
    const controller = new AbortController()
    const waiting = waitForWorkerPoll(5 * 60_000, controller.signal)

    controller.abort()

    await expect(waiting).resolves.toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('resolves normally after the poll interval', async () => {
    jest.useFakeTimers()
    const controller = new AbortController()
    const waiting = waitForWorkerPoll(5_000, controller.signal)

    await jest.advanceTimersByTimeAsync(5_000)

    await expect(waiting).resolves.toBeUndefined()
  })
})
