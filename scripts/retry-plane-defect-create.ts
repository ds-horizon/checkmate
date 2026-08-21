import {retryManualAttentionPlaneDefectCreate} from '../app/services/planeDefectRetry'
import {client} from '../app/db/client'

const outboxId = Number(process.env.PLANE_DEFECT_RETRY_OUTBOX_ID)
const correlationKey = process.env.PLANE_DEFECT_RETRY_CORRELATION_KEY ?? ''

const run = async () => {
  const result = await retryManualAttentionPlaneDefectCreate({
    resultOutboxId: outboxId,
    correlationKey,
  })
  if (result.outcome !== 'retried') {
    throw new Error(`Plane defect retry refused: ${result.reason}`)
  }
  process.stdout.write(`Plane defect retry reset outbox ${outboxId}\n`)
}

run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Plane defect retry failed: ${message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.end()
  })
