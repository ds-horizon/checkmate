export const waitForWorkerPoll = (
  milliseconds: number,
  signal: AbortSignal,
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
    const timer = setTimeout(finish, milliseconds)

    signal.addEventListener('abort', finish, {once: true})
    if (signal.aborted) finish()
  })
}
