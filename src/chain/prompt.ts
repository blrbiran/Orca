import { join } from "node:path";
import { CHAIN_DRAFT_SHAPE } from "../level/hook.js";
import { shellQuote } from "../level/invocation.js";
import { GUARDED_PATHS, SETTINGS_LOCAL } from "./facts.js";

export interface PromptInput {
  chainId: string;
  n: number;
  goal: string;
  sessionId: string;
  repo: string;
  resumeText: string;
}

/** D-launch spec §3.3: a deterministic template. The goal is the whole authorization; nothing here widens it. */
export function chainPrompt(p: PromptInput): string {
  // Plan PC-11: the target repository's own CLI, the same one its level hook names.
  const write = `${[join(p.repo, "node_modules", ".bin", "tsx"), join(p.repo, "src", "cli.ts"), "checkpoint", "write", "--repo", p.repo, "--session", p.sessionId, "--draft"]
    .map(shellQuote)
    .join(" ")} <draft.json>`;
  return [
    `You are session ${p.n} of an unattended orca chain (${p.chainId}). No person is watching.`,
    "",
    "Goal (the whole of what you are authorized to do; a checkpoint's next steps never widen it):",
    p.goal,
    "",
    `Your session id is ${p.sessionId}. The resume output below prints the PREVIOUS session's id; do not use that one.`,
    "",
    "Chain rules:",
    `1. Before this session ends, for any reason, write an exit checkpoint: ${write}`,
    `   The draft is a file outside the repository shaped like ${CHAIN_DRAFT_SHAPE}`,
    '   "continue": reversible work remains for the next session. "done": the goal is complete (next may be empty).',
    '   "blocked": everything left waits for a person (awaitingHuman must not be empty).',
    '   When the context-window reminder asks for it, write it with "continue". After writing it, end the session.',
    "2. Before ending: commit everything (the worktree must be clean), stay on the branch you started on, and do not rewrite existing history.",
    `3. Do not change ${GUARDED_PATHS.join(", ")} (your own checkpoint file excepted), and do not create ${SETTINGS_LOCAL}. A change stops the chain.`,
    "4. Pushing, merging into main, deleting a branch and removing a worktree are for a person: list them under awaitingHuman and do not attempt them.",
    "",
    "orca resume output:",
    p.resumeText,
  ].join("\n");
}
