import { describe, expect, it } from "vitest";
import { controlErrorCatalog } from "../../src/panel/controlErrors.js";
import { enErrors } from "../../web/src/locales/en.js";
import { zhErrors } from "../../web/src/locales/zh.js";

/**
 * Panel i18n spec §3.2, §6.4; spec 2026-10-08 §2.2(a): every refusal code with a machine-readable source has an entry in
 * BOTH languages -- every code of the control error catalog, every code the web itself makes (http-<n> is the one entry
 * http-status), the inline server codes without a catalog (listed here by hand, plan Task 10), and the reasons a group
 * view shows on a blocked run. A code with no entry falls back to the message as sent (web/tests/refusalText.test.tsx), so
 * a missing entry is visible, but it is a gap this criterion names. Internal codes that never reach the browser (they are
 * sent as control-internal-error) have no entry.
 * Rewritten for spec 2026-10-08 §2.3 (human-approved): English added, view-shown reasons added, `detail` allowed.
 */
const WEB_MADE = ["http-status", "http-unreachable", "panel-unreachable", "command-result-invalid"];
const BY_HAND = [
  // src/panel/api.ts, src/panel/reviewsLock.ts, src/panel/compactReviews.ts
  "decision-not-found", "panel-bad-request", "panel-internal-error", "reviews-store-busy", "reviews-store-is-symlink",
  // src/corrections/* (POST /api/corrections)
  "correction-row-invalid", "correction-already-recorded", "duplicate-correction-id", "correction-not-found", "corrections-store-busy",
  // src/metrics/* (the E2 gate, 409 on every read)
  "unresolved-project-keys", "key-matches-multiple-paths", "repo-path-missing", "archive-name-ambiguous", "future-rows-without-as-of", "as-of-not-a-timestamp",
  // src/panel/chains.ts and the ChainRejection codes its "rejected:" log line relays
  "repo-not-found", "chain-args-invalid", "chain-start-failed", "chain-start-timeout", "chain-not-found", "chain-not-running",
  "chain-config-invalid", "chain-config-missing", "chain-id-exists", "chain-id-invalid", "chain-lock-stale", "chain-logs-not-ignored",
  "chain-record-invalid", "chain-running", "claude-not-found", "detached-head", "gate-check-failed", "level-config-invalid",
  "model-window-unknown", "nested-chain", "no-chain-lock", "no-running-chain", "not-a-repository", "not-repository-top-level",
  "record-commit-refused", "repo-lock-held", "tsx-missing", "worktree-dirty",
  // src/panel/projects.ts, src/panel/projectRegistry.ts (project registry spec §6)
  "projects-from-command-line", "project-path-missing", "project-path-not-repository-root", "project-path-taken", "project-path-refused",
  "project-name-invalid", "project-name-taken", "project-unknown", "projects-file-invalid", "projects-file-changed",
  // src/panel/authRoutes.ts, src/panel/accounts/store.ts (accounts spec §3.2-§3.3, §8)
  "login-failed", "login-throttled", "csrf-required", "password-too-short", "user-name-invalid", "user-name-taken", "owner-required",
  "user-role-invalid", "notice-not-found", "user-not-found",
  // src/control/spendCaps.ts gateClaim (accounts spec §6.3.1): projected on a group view, never a command outcome
  "spend-cap-reached",
];
/**
 * Spec 2026-10-08 §2.2(a): a blocked run's reason (drive.blockedReason), matched by its prefix up to the first ':'
 * (web/src/refusalExplain.ts explainRunReason). The literal reasons of src/control/executionDriver.ts's blockRun calls and
 * of the single-call purposes' prepare/usageUnknownReason, at b04e2cb; a reason that is free text (describeError) has no
 * entry and is shown as sent. Part D adds ccloop's stop reasons here.
 */
const VIEW_REASONS = [
  // src/control/executionDriver.ts blockRun(...)
  "agent-unfrozen", "repository-path", "continuation-registration", "skills-unsupported-agent", "skills-inject-failed",
  "config-hash-mismatch", "stop-proof-generation", "inspect-unknown", "accept-refused", "candidate-without-terminal", "terminal",
  "out-of-bounds", "single-call-record-invalid", "single-call-prompt-mismatch", "settle-incomplete",
  // src/control/requirementCalls.ts, src/control/singleCallPurposes.ts (prepare's `blocked`, `usageUnknownReason`)
  "requirement-call-target-moved", "estimate-request-missing", "requirement-usage-unknown", "estimate-usage-unknown",
  // Issue fixes spec §4.2(1): ccloop's stop reasons (the run view's stopReason, after web/src/runFacts.ts reasonCode).
  "codex-result-invalid", "codex-events-invalid", "codex-no-completion", "codex-usage-invalid", "codex-usage-unavailable", "codex-event-error",
  "codex-timeout", "codex-skills-cleanup-failed", "codex-skills-path-conflict", "codex-skills-pending", "codex-skills-setup-failed",
  "codex-skills-source-invalid",
];
const TABLES = { zh: zhErrors, en: enErrors } as const;
const has = (table: Record<string, string>, code: string): boolean => Object.prototype.hasOwnProperty.call(table, code);
const required = (): string[] => [...controlErrorCatalog().map((entry) => entry.code), ...WEB_MADE, ...BY_HAND, ...VIEW_REASONS];

describe("refusal coverage in both languages (panel i18n spec §6.4; spec 2026-10-08 §2.2(a))", () => {
  it.each(Object.keys(TABLES) as Array<keyof typeof TABLES>)("has a %s entry for every catalog code, web-made code, hand-listed code and view-shown reason", (lang) => {
    // 149 catalog codes at b04e2cb (./node_modules/.bin/tsx -e 'import("./src/panel/controlErrors.ts").then(m=>console.log(m.controlErrorCatalog().length))').
    expect(controlErrorCatalog().length).toBeGreaterThanOrEqual(149);
    expect(required().filter((code) => !has(TABLES[lang], code))).toEqual([]);
  });

  it("keeps the two tables over the same codes", () => {
    expect(Object.keys(enErrors).sort()).toEqual(Object.keys(zhErrors).sort());
  });

  it("interpolates nothing but the refusal's message, status and detail, and has no empty entry", () => {
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [code, text] of Object.entries(table)) {
        expect(text.trim(), `${lang} ${code}`).not.toBe("");
        expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).filter((name) => !["message", "status", "detail"].includes(name!)), `${lang} ${code}`).toEqual([]);
      }
    }
  });

  // The code is on screen beside the explanation (spec §2.2(a)); the English text never repeats it, so it interpolates
  // the detail (the message after `<code>:`), not the whole message. http-status's message carries no code.
  it("never repeats the code in English", () => {
    for (const [code, text] of Object.entries(enErrors)) {
      expect(text.includes(code), code).toBe(false);
      if (code !== "http-status") expect(text.includes("{{message}}"), code).toBe(false);
    }
  });
});
