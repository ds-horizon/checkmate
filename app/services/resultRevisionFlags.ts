export const areResultRevisionCommandsEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.RESULT_REVISION_COMMANDS_ENABLED === 'true'

export const isPlaneDeliveryWorkerEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.PLANE_DELIVERY_WORKER_ENABLED === 'true'

export const arePlaneApiWritesEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.PLANE_API_WRITES_ENABLED === 'true'
