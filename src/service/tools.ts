import { spawnSync } from "node:child_process";

export interface ToolResult { code: number; stdout: string; stderr: string }
/** Every external tool goes through this, so a criterion can put fakes first on opts.env.PATH (spawn looks the command up there). */
export type RunTool = (command: string, args: string[], opts: { env: NodeJS.ProcessEnv; inherit?: boolean }) => ToolResult;

export const runTool: RunTool = (command, args, opts) => {
  const result = spawnSync(command, args, { env: opts.env, encoding: "utf8", stdio: opts.inherit === true ? "inherit" : "pipe" });
  if (result.error !== undefined) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
