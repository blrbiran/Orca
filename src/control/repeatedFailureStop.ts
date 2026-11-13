/**
 * Tester #235 (follow-up K): ccloop's stop reason for a failure that repeats (its stopController's isRepeatedFailure). The
 * run ends `exhausted` while attempts may remain, so the CLI (`run show`) and the Web reason word it as the same failure
 * repeating, not as a budget or attempts running out. Shared by both so the match cannot drift; wording only.
 */
export const REPEATED_FAILURE_STOP = "repeated failure pattern detected";
