export const areResultRevisionCommandsEnabled = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) => environment.RESULT_REVISION_COMMANDS_ENABLED === 'true'
