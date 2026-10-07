/** A leaf (no imports): src/cli.ts checks the word here and loads the service modules only for these. */
export const SERVICE_SUBCOMMANDS = ["install", "uninstall", "start", "stop", "restart", "status", "logs"] as const;
