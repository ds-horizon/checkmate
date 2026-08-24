import {readFile} from 'node:fs/promises'
import dotenv from 'dotenv'
import {
  createPlaneAdapter,
  readPlaneAdapterConfig,
  sanitizePlaneError,
} from '../app/services/planeAdapter'
import {
  parseDfrRecoveryManifest,
  buildTvp599RecoveryOperatorEnvironment,
  runPlaneTvp599DfrRecovery,
  validateDfrRecoveryEnvironment,
} from '../app/services/planeDfrRecovery'

const originalEnvironment = {...process.env}
const dotenvEnvironment: Record<string, string> = {}
dotenv.config({override: true, processEnv: dotenvEnvironment})
dotenv.config({override: false})
const effectiveEnvironment = {...process.env}
const operatorEnvironment = buildTvp599RecoveryOperatorEnvironment({
  processEnvironment: originalEnvironment,
  effectiveEnvironment,
  dotenvEnvironment,
})

const USAGE = `Usage: npx tsx scripts/recover-plane-tvp599-dfr.ts --manifest <path>`

const parseManifestPath = (argv: string[]) => {
  if (argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }
  if (argv.length !== 2 || argv[0] !== '--manifest' || !argv[1]) {
    throw new Error(USAGE)
  }
  return argv[1]
}

const main = async () => {
  const manifestPath = parseManifestPath(process.argv.slice(2))
  const manifest = parseDfrRecoveryManifest(await readFile(manifestPath, 'utf8'))
  validateDfrRecoveryEnvironment(operatorEnvironment)
  if (originalEnvironment.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be exactly production')
  }
  process.env.NODE_ENV = 'production'

  const bizConfig = readPlaneAdapterConfig(effectiveEnvironment, 'biz-development')
  const dfrConfig = readPlaneAdapterConfig(effectiveEnvironment, 'dfr-development')
  const bizAdapter = createPlaneAdapter(
    effectiveEnvironment,
    fetch,
    undefined,
    'biz-development',
  )
  const dfrAdapter = createPlaneAdapter(
    effectiveEnvironment,
    fetch,
    undefined,
    'dfr-development',
  )
  const {client, dbClient} = await import('../app/db/client')
  try {
    const {createDfrRecoveryDatabase} = await import(
      '../app/services/planeDfrRecovery'
    )
    const result = await runPlaneTvp599DfrRecovery({
      manifest,
      // Drizzle's generated MySQL overloads are richer than the narrow
      // recovery transaction seam; keep the cast at this single adapter
      // boundary rather than weakening the service contract.
      database: createDfrRecoveryDatabase(
        dbClient as unknown as Parameters<typeof createDfrRecoveryDatabase>[0],
      ),
      dfrProvider: dfrAdapter,
      bizProvider: bizAdapter,
      dfrConfig,
      environment: operatorEnvironment,
    })
    process.stdout.write(
      `${JSON.stringify({
        ...result,
        manifestSha256: manifest.sha256,
        routes: {
          biz: bizConfig.projectIdentifier,
          dfr: dfrConfig.projectIdentifier,
        },
      })}\n`,
    )
    if (result.outcome === 'partial' || result.outcome === 'manual_attention') {
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `TVP-599 DFR recovery failed: ${sanitizePlaneError(error)}\n`,
  )
  process.exitCode = 1
})
