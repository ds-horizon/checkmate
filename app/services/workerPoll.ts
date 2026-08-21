const MAX_JITTER_RATIO = 0.1

export const jitterWorkerPollInterval = (
  milliseconds: number,
  random: () => number = Math.random,
) => {
  if (!Number.isInteger(milliseconds) || milliseconds < 1) {
    throw new Error('Worker poll interval must be a positive integer')
  }
  const jitterMs = Math.floor(milliseconds * MAX_JITTER_RATIO)
  if (jitterMs === 0) return milliseconds
  const sample = random()
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('Worker poll jitter source must return a value in [0, 1)')
  }
  return milliseconds - jitterMs + Math.floor(sample * (jitterMs * 2 + 1))
}

export const waitForWorkerPoll = (
  milliseconds: number,
  signal: AbortSignal,
  random: () => number = Math.random,
) => {
  if (signal.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(
      finish,
      jitterWorkerPollInterval(milliseconds, random),
    )

    signal.addEventListener('abort', finish, {once: true})
    if (signal.aborted) finish()
  })
}
