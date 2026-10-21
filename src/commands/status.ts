import type { CommandIo, ParsedArgs } from "./types.js";

export interface StatusCheck { level: "ok" | "warn" | "fail"; subject: string; fact: string }

/** Spec §8: is the panel answering on its socket. Read-only: a GET, never a start. */
export async function panelCheck(stateDirFlag: string | undefined, env: NodeJS.ProcessEnv): Promise<StatusCheck> {
  const { discoverSocketPath } = await import("../entry/discovery.js");
  const { requestOverSocket } = await import("../entry/socketClient.js");
  const { EntryRejection } = await import("../entry/envelope.js");
  try {
    const socketPath = discoverSocketPath({ stateDirFlag, env });
    const { status, body } = await requestOverSocket({ socketPath, method: "GET", path: "summary", client: "cli", timeoutMs: 10_000 });
    if (status !== 200) return { level: "fail", subject: "panel", fact: `${socketPath} answered ${status}` };
    const groups = (body as { groups?: unknown[] }).groups?.length ?? 0;
    return { level: "ok", subject: "panel", fact: `answering on ${socketPath} (${groups} group${groups === 1 ? "" : "s"})` };
  } catch (error) {
    if (error instanceof EntryRejection) return { level: "fail", subject: "panel", fact: `${error.code}: ${error.message}` };
    throw error;
  }
}

/** Spec §8: one line per check, `ok|warn|fail <subject>: <fact>`; exit 1 on any fail, 0 otherwise. */
export async function runStatus(args: ParsedArgs, io: CommandIo): Promise<number> {
  const checks = [await panelCheck(args.global.controlStateDir, io.env)];
  const code = checks.some((check) => check.level === "fail") ? 1 : 0;
  if (args.global.json) io.stdout(`${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-status-v1", checks } })}\n`);
  else if (!args.global.quiet || code !== 0) io.stdout(checks.map((c) => `${c.level} ${c.subject}: ${c.fact}\n`).join(""));
  return code;
}
