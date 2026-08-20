import {runConfiguredPlaneDeliveryBatch} from '../app/services/planeDefectDelivery'
import {sanitizePlaneError} from '../app/services/planeAdapter'
import {client} from '../app/db/client'
import {waitForWorkerPoll} from '../app/services/workerPoll'

const DEFAULT_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 5 * 60_000
const watch = process.argv.includes('--watch')
const shutdownController = new AbortController()

const readPollInterval = () => {
  const configured = process.env.PLANE_DELIVERY_POLL_INTERVAL_MS
  if (!configured) return DEFAULT_POLL_INTERVAL_MS

  const value = Number(configured)
  if (!Number.isInteger(value) || value < 1 || value > MAX_POLL_INTERVAL_MS) {
    throw new Error(
      `PLANE_DELIVERY_POLL_INTERVAL_MS must be between 1 and ${MAX_POLL_INTERVAL_MS}`,
    )
  }
  return value
}

const main = async () => {
  const pollIntervalMs = watch ? readPollInterval() : 0

  do {
    const summary = await runConfiguredPlaneDeliveryBatch()
    if (!watch || !summary.enabled || summary.claimed > 0) {
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    }

    if (!summary.enabled) return
    if (!watch) {
      if (summary.manualAttention > 0 || summary.staleLeases > 0) {
        process.exitCode = 1
      }
      return
    }

    if (summary.claimed === 0) {
      await waitForWorkerPoll(pollIntervalMs, shutdownController.signal)
    }
  } while (!shutdownController.signal.aborted)
}

const run = async () => {
  try {
    await main()
  } catch (error) {
    process.stderr.write(
      `Plane delivery failed: ${sanitizePlaneError(error)}\n`,
    )
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

process.once('SIGINT', () => {
  shutdownController.abort()
})
process.once('SIGTERM', () => {
  shutdownController.abort()
})

void run()
