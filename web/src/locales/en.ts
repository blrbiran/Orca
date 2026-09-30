/**
 * Panel i18n spec §2: the English resource. It is the source shape (`as const`), and every value is today's panel text
 * byte for byte. Keys are grouped by panel area. Enum families (spec §3.5) are Records over the value unions, so a new
 * value is a compile error here until it has its words. Tasks 3-10 add their areas.
 */
import type { ThemePref } from "../theme.js";

/** The Chinese resource's type: the same key set, every value widened to string (spec §2). */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

const theme = { system: "system", light: "light", dark: "dark" } as const satisfies Record<ThemePref, string>;

export const en = {
  nav: { sections: "Sections", decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" },
  shell: {
    brandTitle: "Leave it to Orca — every idea, made real.",
    chainRunning: "a chain is running",
    needsAttention: "needs attention",
    theme: "Theme",
    language: "Language",
    loading: "orca panel loading…",
    epoch: "epoch {{epoch}}",
  },
  common: { none: "none", na: "n/a", unknown: "unknown", dispatchBlocked: "dispatch blocked", dispatchLive: "dispatch live" },
  loopPlan: {
    // Panel i18n spec §3.1, §6.9: one entry per registry version, equal to src/control/loopPlans.ts (the English source of
    // record); a version with no discipline has no discipline key.
    plan: {
      standard: { v1: { name: "Standard" }, v2: { name: "Standard" } },
      bugfix: {
        v1: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
        v2: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
      },
      refactor: {
        v1: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
        v2: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
      },
      design: {
        v1: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
        v2: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
      },
      investigate: {
        v1: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
        v2: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
      },
    },
    title: { line: "{{name}} · v{{version}} · {{how}}", byHand: "chosen by hand", noLabel: "no label, default", byLabel: "chosen by label `{{label}}`", changed: " · changed" },
    summary: {
      goal: "Goal: {{goal}}",
      doneWhen: "Done when: {{condition}}",
      onlyChanges: "Only changes: {{paths}}",
      mustNotChange: "Must not change: {{paths}} (reported by the agent, not checked in git)",
      files_one: "At most {{count}} file changed (reported by the agent)",
      files_other: "At most {{count}} files changed (reported by the agent)",
      noFileLimit: "No file limit",
      checks_one: "Acceptance: {{count}} check command, all must pass",
      checks_other: "Acceptance: {{count}} check commands, all must pass",
      pathSeparator: ", ",
    },
  },
  enums: { theme },
} as const;
