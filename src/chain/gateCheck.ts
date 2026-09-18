import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { GATE_DENY, GATE_PRE_TOOL_USE } from "../gate/settings.js";
import { SETTINGS_LOCAL } from "./facts.js";

export type GateCheck = { ok: true } | { ok: false; reason: string };
const SAMPLE_TIMEOUT_MS = 10_000;
/** Data written to the hook's stdin, never executed. The one literal the Tier 0 scan (Task 8) is expected to report. */
const MUST_BLOCK_SAMPLE = "git push";
const MUST_PASS_SAMPLE = "git status";

/**
 * D-launch spec §5.2 items 1–3 (review C1, ruling R14 "detect and stop"). `claude -p` silently ignores a settings file
 * that fails validation, so the wiring is compared with src/gate/settings.ts AND the hook command from the worktree is
 * run for real on a must-block and a must-pass sample. This is the one place the supervisor executes worktree code on
 * purpose (spec §2): it is exactly that code that has to be checked.
 */
export async function checkGate(repo: string, env: NodeJS.ProcessEnv = process.env): Promise<GateCheck> {
  let settings: any;
  try {
    settings = JSON.parse(await readFile(join(repo, ".claude", "settings.json"), "utf8"));
  } catch (err) {
    return { ok: false, reason: `.claude/settings.json cannot be read as JSON: ${(err as Error).message}` };
  }
  if (!isDeepStrictEqual(settings?.hooks?.PreToolUse, GATE_PRE_TOOL_USE)) {
    return { ok: false, reason: ".claude/settings.json hooks.PreToolUse is not exactly the Tier 0 gate hook of src/gate/settings.ts" };
  }
  const deny = settings?.permissions?.deny;
  if (!Array.isArray(deny) || !isDeepStrictEqual([...deny].sort(), [...GATE_DENY].sort())) {
    return { ok: false, reason: ".claude/settings.json permissions.deny is not exactly the Tier 0 deny list of src/gate/settings.ts" };
  }
  if (settings.disableAllHooks !== undefined) return { ok: false, reason: ".claude/settings.json sets disableAllHooks, which switches every hook off" };
  if (await stat(join(repo, SETTINGS_LOCAL)).then(() => true, () => false)) {
    return { ok: false, reason: `${SETTINGS_LOCAL} exists: its disableAllHooks can switch the gate off, and git does not see the file` };
  }
  // Plan PC-19 (review I3(c)): read only. A missing file is fine; one that cannot be read as JSON is not.
  const user = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, "settings.json") : join(env.HOME || homedir(), ".claude", "settings.json");
  let userText: string | null = null;
  try {
    userText = await readFile(user, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, reason: `${user} cannot be read: ${(err as Error).message}` };
  }
  if (userText !== null) {
    let userSettings: any;
    try {
      userSettings = JSON.parse(userText);
    } catch (err) {
      return { ok: false, reason: `${user} cannot be read as JSON: ${(err as Error).message}` };
    }
    if (userSettings?.disableAllHooks !== undefined) return { ok: false, reason: `${user} sets disableAllHooks, which switches every hook off, the gate included` };
  }
  const command: string = settings.hooks.PreToolUse[0].hooks[0].command;
  // Plan PC-18 (review I3(b)): every sample is new, so a changed cli.ts cannot recognise the check and answer it apart.
  const probeDir = await mkdtemp(join(tmpdir(), "orca-gate-probe-"));
  try {
    const push = await runHook(repo, command, MUST_BLOCK_SAMPLE, probeDir);
    if (push.code !== 2 || !push.stderr.startsWith("orca gate:")) {
      return { ok: false, reason: `the gate hook let the must-block sample through: ${MUST_BLOCK_SAMPLE} exited ${push.code}, stderr ${JSON.stringify(push.stderr.slice(0, 200))}` };
    }
    const status = await runHook(repo, command, MUST_PASS_SAMPLE, probeDir);
    if (status.code !== 0) {
      return { ok: false, reason: `the gate hook blocked the must-pass sample: ${MUST_PASS_SAMPLE} exited ${status.code}, stderr ${JSON.stringify(status.stderr.slice(0, 200))}` };
    }
    return { ok: true };
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

async function runHook(repo: string, command: string, sample: string, probeDir: string): Promise<{ code: number | null; stderr: string }> {
  const sessionId = randomUUID();
  const transcriptPath = join(probeDir, `${sessionId}.jsonl`);
  await writeFile(transcriptPath, "");
  const input = JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd: repo, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: sample } });
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, stdio: ["pipe", "ignore", "pipe"], detached: true });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        // Already gone.
      }
    }, SAMPLE_TIMEOUT_MS);
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.once("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: e.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
    child.stdin.end(input);
  });
}
