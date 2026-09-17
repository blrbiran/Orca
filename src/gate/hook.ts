import { GATE_DEADLINE_MS, gitBranchOf } from "./branch.js";
import { type BranchOf, type Verdict, blockMessage, classify as realClassify } from "./classify.js";

/**
 * Tier 0 gate spec 4 layer 1: the delivery shim. Unlike the level hook it fails closed — anything it cannot
 * read or any throw becomes a block. A subagent's call (stdin with agent_id) is gated like the main session's.
 */
export async function gateHookClaudeCode(
  stdinText: string,
  deps: { classify?: typeof realClassify; branchOf?: BranchOf } = {},
): Promise<{ exitCode: 0 | 2; stderr: string }> {
  let verdict: Verdict;
  try {
    verdict = await decide(stdinText, deps.classify ?? realClassify, deps.branchOf ?? gitBranchOf(Date.now() + GATE_DEADLINE_MS));
  } catch (err) {
    verdict = { kind: "block", action: "this command", unclear: (err as Error).message };
  }
  return verdict.kind === "allow" ? { exitCode: 0, stderr: "" } : { exitCode: 2, stderr: `${blockMessage(verdict)}\n` };
}

async function decide(stdinText: string, classify: typeof realClassify, branchOf: BranchOf): Promise<Verdict> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdinText);
  } catch {
    return { kind: "block", action: "this command", unclear: "hook input is not JSON" };
  }
  const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const toolInput = (typeof fields.tool_input === "object" && fields.tool_input !== null ? fields.tool_input : {}) as Record<string, unknown>;
  if (typeof fields.tool_name === "string" && fields.tool_name !== "Bash") return { kind: "allow" };
  if (typeof fields.tool_name !== "string" || typeof toolInput.command !== "string" || typeof fields.cwd !== "string") {
    return { kind: "block", action: "this command", unclear: "hook input lacks tool_name, tool_input.command or cwd" };
  }
  return classify(toolInput.command, fields.cwd, branchOf);
}
