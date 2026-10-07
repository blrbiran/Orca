import { z } from "zod";
import { SERVICE_CONFIG_SCHEMA, type ServiceConfigV1 } from "./config.js";
import type { ServicePaths } from "./paths.js";
import { ensurePrivateDir, ensurePrivateFile, readTextOrNull, writePrivateFile } from "./privateFiles.js";
import { ServiceRejection } from "./rejection.js";
import { renderRunSh, renderServiceEnv } from "./render.js";

export { ensurePrivateDir, ensurePrivateFile, readTextOrNull, tailLines, writePrivateFile } from "./privateFiles.js";

/** Spec §3. Everything is rendered before anything is written, so a refused value leaves no half-installed directory. */
export function writeServiceFiles(paths: ServicePaths, config: ServiceConfigV1): void {
  const json = `${JSON.stringify(config, null, 2)}\n`;
  const env = renderServiceEnv(config);
  const run = renderRunSh(config, paths);
  ensurePrivateDir(paths.panelDir);
  ensurePrivateDir(paths.logsDir);
  writePrivateFile(paths.configFile, json);
  writePrivateFile(paths.envFile, env);
  writePrivateFile(paths.runScript, run);
  ensurePrivateFile(paths.outLog);
  ensurePrivateFile(paths.errLog);
}

const configSchema = z.object({
  schema: z.literal(SERVICE_CONFIG_SCHEMA), node: z.string().min(1), entry: z.string().min(1),
  args: z.array(z.string()), env: z.record(z.string()),
}).strict();

export function readServiceConfig(paths: ServicePaths): ServiceConfigV1 {
  const text = readTextOrNull(paths.configFile);
  if (text === null) throw new ServiceRejection("service-not-installed", `${paths.configFile} does not exist; run orca panel install first`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw new ServiceRejection("service-config-invalid", `${paths.configFile}: ${String(error)}`); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new ServiceRejection("service-config-invalid", `${paths.configFile}: ${result.error.issues.map((i) => i.message).join("; ")}`);
  return result.data;
}
