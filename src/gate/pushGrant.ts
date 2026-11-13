import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDir, writePrivateFile } from "../service/privateFiles.js";

/**
 * Tier 0 gate spec §12 (human, Orca session 7e164691: 「在人明确要求的情况下要允许push」): a hook cannot see the
 * conversation, so the human's explicit request is a token in their own prompt. The UserPromptSubmit hook turns it into
 * a session-bound, time-limited grant file; the PreToolUse gate reads it for that same session.
 */
export const PUSH_GRANT_MS = 12 * 60 * 60 * 1000;
/** Rule 17: redirectable, so criteria never touch the person's real ~/.orca. */
export const gateDir = (env: NodeJS.ProcessEnv): string => env.ORCA_GATE_DIR || join(env.HOME || homedir(), ".orca", "gate");
export const pushGrantPath = (dir: string, sessionId: string): string => join(dir, "push-grants", `${sessionId}.json`);
/** The session id names a file: anything but a plain id is refused rather than joined into a path. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Grant only when the prompt STARTS with the token: text the human pastes or quotes (a subagent's report, a resume
 * output, a chain goal) can mention `allow-push` without granting anything. Revoking is the safe direction, so the
 * revoke tokens count anywhere as a standalone word; when both appear, revoke wins.
 */
const GRANT = /^\s*\/?allow-push(?![\w-])/i;
const REVOKE = /(?<![\w-])\/?(?:deny|revoke)-push(?![\w-])/i;

export function promptIntent(prompt: string): "grant" | "revoke" | null {
  if (REVOKE.test(prompt)) return "revoke";
  return GRANT.test(prompt) ? "grant" : null;
}

/** True when a grant for exactly this session exists and `now` lies inside it. Anything unreadable is no grant. */
export function hasLivePushGrant(env: NodeJS.ProcessEnv, sessionId: unknown, now: number): boolean {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return false;
  try {
    const grant = JSON.parse(readFileSync(pushGrantPath(gateDir(env), sessionId), "utf8")) as Record<string, unknown>;
    if (grant.sessionId !== sessionId || typeof grant.grantedAt !== "string" || typeof grant.expiresAt !== "string") return false;
    return Date.parse(grant.grantedAt) <= now && now < Date.parse(grant.expiresAt);
  } catch {
    return false;
  }
}

/**
 * `orca dev gate --hook claude-code-prompt`. Never blocks the prompt: the caller always exits 0. stdout (which Claude
 * Code shows the model) carries one line only when a grant was written; the hook's own errors go to stderr as one line.
 * A chain session (ORCA_CHAIN_ID) never gets a grant: its prompt is written by the chain, and no person is watching.
 */
export function promptHookClaudeCode(stdinText: string, env: NodeJS.ProcessEnv, now: number): { stdout: string; stderr: string } {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(stdinText);
    } catch {
      return { stdout: "", stderr: "orca gate: prompt hook input is not JSON; no push grant changed\n" };
    }
    const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    // Claude Code's UserPromptSubmit input names the text `prompt`; `user_prompt` is read too in case a version renames it.
    const prompt = typeof fields.prompt === "string" ? fields.prompt : typeof fields.user_prompt === "string" ? fields.user_prompt : null;
    const sessionId = fields.session_id;
    if (prompt === null) return { stdout: "", stderr: "orca gate: prompt hook input has no prompt; no push grant changed\n" };
    const intent = promptIntent(prompt);
    if (intent === null) return { stdout: "", stderr: "" };
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
      return { stdout: "", stderr: "orca gate: prompt hook input has no usable session_id; no push grant changed\n" };
    }
    const path = pushGrantPath(gateDir(env), sessionId);
    if (intent === "revoke") {
      rmSync(path, { force: true });
      return { stdout: "", stderr: "" };
    }
    if (env.ORCA_CHAIN_ID) return { stdout: "", stderr: "orca gate: a chain session gets no push grant\n" };
    const expiresAt = new Date(now + PUSH_GRANT_MS).toISOString();
    ensurePrivateDir(join(gateDir(env), "push-grants"));
    writePrivateFile(path, `${JSON.stringify({ sessionId, grantedAt: new Date(now).toISOString(), expiresAt })}\n`);
    return { stdout: `orca gate: push allowed for this session until ${expiresAt} (human said allow-push)\n`, stderr: "" };
  } catch (err) {
    return { stdout: "", stderr: `orca gate: prompt hook failed: ${(err as Error).message}; no push grant changed\n` };
  }
}
