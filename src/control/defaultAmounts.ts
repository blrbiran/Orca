import type { Amount } from "./types.js";

/**
 * The default allocations (estimator.ts re-exports them). A leaf module on purpose: debugPlan.ts reads TASK_WORK while
 * its module is evaluated, and estimator.ts sits on an import cycle (estimator -> commands -> fundedAllowance -> budget
 * -> stopIntent -> webDispatch -> debugChecks -> debugPlan -> estimator). Imported from here, the value is defined
 * whatever order the cycle is entered in (session 3cfc2e73: adding webDispatch -> groupEdges changed that order and left
 * TASK_WORK undefined in debugPlan for 90 test files).
 */
export const TASK_WORK: Amount = Object.freeze({ tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 });
export const TASK_HANDOFF: Amount = Object.freeze({ tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 });
export const GOAL_REVIEW: Amount = Object.freeze({ tokens: 1_000_000, activeMs: 3_600_000, attempts: 1, sessions: 1 });
