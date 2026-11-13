import { GATE_DEADLINE_MS, gitBranchOf } from "./branch.js";
import { type BranchOf, type Verdict, blockMessage, classify as realClassify } from "./classify.js";
import { hasLivePushGrant } from "./pushGrant.js";

/** Spec §12: what the agent is told when a push is blocked because the session holds no grant. */
export const NO_GRANT_HINT =
  " A person can allow a plain push for this session (12 h) by starting their next message with allow-push.";

/**
 * Tier 0 gate spec 4 layer 1: the delivery shim. Unlike the level hook it fails closed — anything it cannot
 * read or any throw becomes a block. A subagent's call (stdin with agent_id) is gated like the main session's.
 * Spec §12: a live push grant for the input's session_id lets classify admit a plain push to origin.
 */
export async function gateHookClaudeCode(
  stdinText: string,
  deps: { classify?: typeof realClassify; branchOf?: BranchOf; env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<{ exitCode: 0 | 2; stderr: string }> {
  let verdict: Verdict;
  let granted = false;
  try {
    const decided = await decide(stdinText, deps.classify ?? realClassify, deps.branchOf ?? gitBranchOf(Date.now() + GATE_DEADLINE_MS), deps.env ?? process.env, deps.now ?? Date.now());
    verdict = decided.verdict;
    granted = decided.granted;
  } catch (err) {
    verdict = { kind: "block", action: "this command", unclear: (err as Error).message };
  }
  if (verdict.kind === "allow") return { exitCode: 0, stderr: "" };
  const hint = verdict.action === "push" && !granted ? NO_GRANT_HINT : "";
  return { exitCode: 2, stderr: `${blockMessage(verdict)}${hint}\n` };
}

async function decide(
  stdinText: string,
  classify: typeof realClassify,
  branchOf: BranchOf,
  env: NodeJS.ProcessEnv,
  now: number,
): Promise<{ verdict: Verdict; granted: boolean }> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdinText);
  } catch {
    return { verdict: { kind: "block", action: "this command", unclear: "hook input is not JSON" }, granted: false };
  }
  const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const toolInput = (typeof fields.tool_input === "object" && fields.tool_input !== null ? fields.tool_input : {}) as Record<string, unknown>;
  if (typeof fields.tool_name === "string" && fields.tool_name !== "Bash") return { verdict: { kind: "allow" }, granted: false };
  if (typeof fields.tool_name !== "string" || typeof toolInput.command !== "string" || typeof fields.cwd !== "string") {
    return { verdict: { kind: "block", action: "this command", unclear: "hook input lacks tool_name, tool_input.command or cwd" }, granted: false };
  }
  const granted = hasLivePushGrant(env, fields.session_id, now);
  return { verdict: await classify(toolInput.command, fields.cwd, branchOf, granted), granted };
}
