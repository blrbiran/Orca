import { describe, expect, it } from "vitest";
import { controlErrorCatalog } from "../../src/panel/controlErrors.js";
import { zhErrors } from "../../web/src/locales/zh.js";

/**
 * Panel i18n spec §3.2, §6.4: every refusal code with a machine-readable source has a Chinese entry -- every code of the
 * control error catalog and every code the web itself makes (http-<n> is the one entry http-status); the inline server
 * codes without a catalog are listed here by hand (plan Task 10). A code with no entry falls back to the message as sent
 * (web/tests/refusalText.test.tsx), so a missing entry is visible, but it is a gap this criterion names.
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
];
const has = (code: string): boolean => Object.prototype.hasOwnProperty.call(zhErrors, code);

describe("Chinese refusal coverage (spec §6.4)", () => {
  it("has a Chinese entry for every catalog code, every web-made code and every hand-listed code", () => {
    const catalog = controlErrorCatalog().map((entry) => entry.code);
    expect(catalog.length).toBeGreaterThanOrEqual(124);
    expect([...catalog, ...WEB_MADE, ...BY_HAND].filter((code) => !has(code))).toEqual([]);
  });

  it("interpolates nothing but the refusal's message and status, and has no empty entry", () => {
    for (const [code, text] of Object.entries(zhErrors)) {
      expect(text.trim(), code).not.toBe("");
      expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).filter((name) => name !== "message" && name !== "status"), code).toEqual([]);
    }
  });
});
