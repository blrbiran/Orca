import { findCovering } from "../checkpoint/covering.js";
import { git } from "../scheduler/gitExec.js";
import { orcaCommand } from "./invocation.js";
import { readLevel } from "./readLevel.js";
import { decide } from "./trigger.js";

export const DRAFT_SHAPE =
  '{"next":["..."],"open":["..."],"awaitingHuman":[{"kind":"irreversible|tied-evidence|named-authorization|ccloop-change","what":"..."}],"measure":["<command>"]}';

/**
 * D spec 3: the delivery shim. It carries no judgment of its own (Rule 5) — it reads the hook input,
 * asks the core, and hands the core's text to Claude Code verbatim as additional context.
 */
export async function levelHookClaudeCode(stdinText: string): Promise<string> {
  // D spec 4: a missing reading is reported every time, never silently. A throw escaping here would
  // leave the agent with nothing, so it becomes the same injection as every other missing reading.
  try {
    return await hookBody(stdinText);
  } catch (err) {
    return inject([`orca level: no reading — ${(err as Error).message}`]);
  }
}

async function hookBody(stdinText: string): Promise<string> {
  const input = parseHookInput(stdinText);
  if (typeof input === "string") return inject([`orca level: no reading — ${input}`]);
  // Final review I3: a subagent's tool call carries the parent's session_id and transcript_path, and only
  // agent_id tells it apart. Any reading or command built from them is the parent's, not the subagent's.
  if (input.subagent) return "";

  // Claude Code sets CLAUDE_PROJECT_DIR for hook commands. The stdin cwd follows the session's `cd`,
  // so a session that moved into another repository would otherwise be handed that repository's
  // checkpoint commands (Rule 16). The stdin cwd is only the fallback when the variable is absent.
  const start = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const repo = await git(start, ["rev-parse", "--show-toplevel"]).then(
    (out) => out.trim(),
    () => start,
  );
  const { input: reading, thresholds } = await readLevel(repo, input.sessionRef, input.transcriptPath);
  const { covering, problems } = await findCovering(repo, input.sessionRef);
  const command =
    `Run: ${orcaCommand(["checkpoint", "write", "--repo", repo, "--session", input.sessionRef, "--transcript", input.transcriptPath, "--draft"])} <draft.json>` +
    ` where the draft is a file outside the repository shaped like ${DRAFT_SHAPE}`;
  const decision = decide(reading, thresholds, covering, command);

  const lines = decision.kind === "silent" ? [] : [decision.text];
  for (const problem of problems) lines.push(`orca level: unreadable checkpoint ${problem}`);
  return lines.length === 0 ? "" : inject(lines);
}

function parseHookInput(
  text: string,
): { sessionRef: string; transcriptPath: string; cwd: string; subagent: boolean } | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "hook input is not JSON";
  }
  const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const { session_id: sessionRef, transcript_path: transcriptPath, cwd } = fields;
  if (typeof sessionRef !== "string" || typeof transcriptPath !== "string" || typeof cwd !== "string") {
    return "hook input lacks session_id, transcript_path or cwd";
  }
  return { sessionRef, transcriptPath, cwd, subagent: typeof fields.agent_id === "string" };
}

const inject = (lines: string[]): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: lines.join("\n") } })}\n`;
