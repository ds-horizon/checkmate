export const areResultRevisionCommandsEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.RESULT_REVISION_COMMANDS_ENABLED === 'true'

export const isPlaneDeliveryWorkerEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.PLANE_DELIVERY_WORKER_ENABLED === 'true'

export const arePlaneApiWritesEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.PLANE_API_WRITES_ENABLED === 'true'

export const isPlaneDefectCreationEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  environment.PLANE_DEFECT_CREATION_ENABLED === 'true' &&
  isPlaneDeliveryWorkerEnabled(environment) &&
  arePlaneApiWritesEnabled(environment)

export const isPlaneEvidenceCopyEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  environment.PLANE_EVIDENCE_COPY_ENABLED === 'true' &&
  isPlaneDeliveryWorkerEnabled(environment) &&
  arePlaneApiWritesEnabled(environment)

export const isPlaneRetestReadinessEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  environment.PLANE_RETEST_READINESS_ENABLED === 'true' &&
  environment.PLANE_RETEST_NOTIFICATION_ENABLED === 'true' &&
  areResultRevisionCommandsEnabled(environment)
