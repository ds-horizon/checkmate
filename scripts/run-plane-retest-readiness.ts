import {client} from '../app/db/client'
import {sanitizePlaneError} from '../app/services/planeAdapter'
import {runConfiguredPlaneRetestReadinessBatch} from '../app/services/planeRetestReadiness'
import {waitForWorkerPoll} from '../app/services/workerPoll'

const DEFAULT_POLL_INTERVAL_MS = 5_000
const MAX_POLL_INTERVAL_MS = 5 * 60_000
const DEFAULT_LEASE_MS = 130_000
const watch = process.argv.includes('--watch')
const shutdownController = new AbortController()

const readPollInterval = () => {
  const configured = process.env.PLANE_RETEST_READINESS_POLL_INTERVAL_MS
  if (!configured) return DEFAULT_POLL_INTERVAL_MS
  const value = Number(configured)
  if (!Number.isInteger(value) || value < 1 || value > MAX_POLL_INTERVAL_MS) {
    throw new Error(
      `PLANE_RETEST_READINESS_POLL_INTERVAL_MS must be between 1 and ${MAX_POLL_INTERVAL_MS}`,
    )
  }
  return value
}

const readLeaseMs = () => {
  const configured = process.env.PLANE_RETEST_READINESS_LEASE_MS
  if (!configured) return DEFAULT_LEASE_MS
  const value = Number(configured)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('PLANE_RETEST_READINESS_LEASE_MS must be a positive integer')
  }
  return value
}

const main = async () => {
  const pollIntervalMs = watch ? readPollInterval() : 0
  const leaseMs = readLeaseMs()
  do {
    const summary = await runConfiguredPlaneRetestReadinessBatch({leaseMs})
    if (!watch || !summary.enabled || summary.observed > 0) {
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    }
    if (!summary.enabled || !watch) return
    await waitForWorkerPoll(pollIntervalMs, shutdownController.signal)
  } while (!shutdownController.signal.aborted)
}

const run = async () => {
  try {
    await main()
  } catch (error) {
    process.stderr.write(
      `Plane retest readiness failed: ${sanitizePlaneError(error)}\n`,
    )
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

process.once('SIGINT', () => shutdownController.abort())
process.once('SIGTERM', () => shutdownController.abort())

void run()
