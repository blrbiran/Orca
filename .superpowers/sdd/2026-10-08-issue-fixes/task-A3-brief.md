### Task A3: English and Chinese refusal tables, `{{detail}}`, and the coverage criterion

**Files:**
- Modify `web/src/locales/en.ts`: append `export const enErrors` after the closing `} as const;` of `en` (line 770).
- Modify `web/src/locales/zh.ts`: `zhErrors` (lines 720-958): the `command-result-not-found` entry, and the view-shown reasons appended before the closing `};`.
- Modify `web/src/i18n.ts`: import line 10, `refusalText` and its doc (lines 92-106).
- Modify `web/src/Refusal.tsx`: doc lines 4-9 (now false for English).
- Modify (rewrite, approved) `tests/panel/refusalCoverage.test.ts` (whole file, 49 lines).
- Modify (rewrite, approved) `web/tests/refusalText.test.tsx`: header comment lines 2-6, the first test (lines 49-58); add one test.
- Modify (rewrite, approved) `web/tests/decisionsStatusFilter.test.tsx`: one assertion (line 171) and an import.

**Interfaces:**
- Produces (in `web/src/locales/en.ts`): `export const enErrors: Record<string, string>` — the same keys as `zhErrors`.
- Produces (in `web/src/i18n.ts`):
  - `export function errorEntry(code: string): string | undefined` — the current language's entry, own properties only.
  - `export function fillEntry(entry: string, values: { message: string; status: string; detail: string }): string`.
  - `export function refusalDetail(refusal: { code: string; message: string }): string` — `""` when the message is the code; the text after `<code>:` when it starts so; else the whole message.
  - `refusalText(refusal)` (same signature): current language's entry with `{{message}}`, `{{status}}`, `{{detail}}` filled, else the message as sent (unchanged fallback).
- Produces the coverage set's fourth list `VIEW_REASONS` (in the test) that Parts C/D/E extend; any code a later part adds gets an en and a zh entry in the same task.

- [ ] **Step 1: Write the failing tests.**

  (a) Replace `tests/panel/refusalCoverage.test.ts` whole (rewrite approved, spec §2.2(a), §2.3 first bullet):

```ts
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
```

  (b) In `web/tests/refusalText.test.tsx`: add `import { enErrors } from "../src/locales/en.js";` after the `i18n` import (line 14). Replace header lines 2-6:

```ts
/**
 * Panel i18n spec §3.2, §3.3, §6.4: an English refusal shows the server's message byte for byte (the refusal, the error
 * page, the control line); Chinese shows the entry for its code, with the server's detail where the entry carries it, and
 * the message as sent for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own
 * messages are built in the reader's language.
 */
```

  with:

```ts
/**
 * Panel i18n spec §3.2, §3.3, §6.4; spec 2026-10-08 §2.2(a): a refusal shows the current language's entry for its code
 * (English and Chinese alike), with the server's detail where the entry carries it, and the message as sent, byte for
 * byte, for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own messages are
 * built in the reader's language.
 */
```

  Replace the first test (lines 49-58), whose current assertions are:

```ts
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
    ...
    render(<ErrorPage failure={{ status: 409, code: "unresolved-project-keys", message: SENT }} />);
    expect(screen.getByTestId("error-message").textContent).toBe(SENT);
    ...
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe(`revision-conflict · HTTP 409 · server revision 7 · ${SENT}`);
```

  with (spec §2.1 root cause 1: English used to show machine text; rewrite approved):

```tsx
  // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows its own entry for a known code -- it used to show
  // the server's message, e.g. `control-plan-rejected:task-control-metadata:a`. The message as sent, byte for byte, is
  // still the fallback for a code with no entry, in every place a refusal is shown.
  it("renders an English refusal's entry for a known code, and the message byte for byte for a code with none, in the refusal, the error page and the control line", () => {
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(enErrors["revision-conflict"]);
    cleanup();
    render(<Refusal refusal={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
    cleanup();
    render(<ErrorPage failure={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    expect(screen.getByTestId("error-message").textContent).toBe(SENT);
    expect(screen.getByTestId("error-status").textContent).toBe("answered 409");
    cleanup();
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe(`revision-conflict · HTTP 409 · server revision 7 · ${enErrors["revision-conflict"]}`);
    cleanup();
    expect(controlLine({ status: 409, code: "a-code-nobody-listed", message: SENT, commandRevision: 7 })).toBe(`a-code-nobody-listed · HTTP 409 · server revision 7 · ${SENT}`);
  });

  it("fills {{detail}} with the message after `<code>:`, the whole message when it has no such prefix, and nothing when it is the code", () => {
    expect(refusalText({ code: "labels-invalid", message: "labels-invalid:count:17", status: 422 })).toBe("The labels are not valid: count:17");
    expect(refusalText({ code: "labels-invalid", message: "17 labels are too many", status: 422 })).toBe("The labels are not valid: 17 labels are too many");
    expect(refusalText({ code: "labels-invalid", message: "labels-invalid", status: 422 })).toBe("The labels are not valid: ");
    expect(refusalText({ code: "http-502", message: "POST /x: the panel may not have committed this command", status: 502 }))
      .toBe("The panel answered HTTP 502 without an error code: POST /x: the panel may not have committed this command");
  });
```

  (c) In `web/tests/decisionsStatusFilter.test.tsx` add `import { enErrors } from "../src/locales/en.js";` to the imports, and in "opens a reviewed decision with the correction form, and a second correction shows the refusal" replace line 171:

```ts
    expect((await screen.findByTestId("refusal-message")).textContent).toBe(ALREADY.message);
```

  with (spec §2.2(a): English shows the code's entry; rewrite approved):

```ts
    // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows the code's own entry, as Chinese always did.
    expect((await screen.findByTestId("refusal-message")).textContent).toBe(enErrors["correction-already-recorded"]);
```

- [ ] **Step 2: Run it, expect FAIL** — root: `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1 (`enErrors` is not exported: every test fails on the import / `undefined`). Web: `cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx tests/decisionsStatusFilter.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1 (`enErrors` undefined; the `{{detail}}` test gets the message as sent).

- [ ] **Step 3: Implement.**

  (a) `web/src/locales/zh.ts`. Replace the entry

```ts
  "command-result-not-found": "台账里没有这条命令的结果。",
```

  with (the web composes this code's message itself, `UsagePanel.tsx` line 101, so the entry must carry it — today Chinese drops the "not applied; try again" sentence):

```ts
  "command-result-not-found": "台账里没有这条命令的结果：{{detail}}",
```

  and append before the table's closing `};` (line 958):

```ts
  // Spec 2026-10-08 §2.2(a): the reasons a group view shows on a blocked run, by prefix up to the first ':'
  // (web/src/refusalExplain.ts explainRunReason; tests/panel/refusalCoverage.test.ts VIEW_REASONS).
  "agent-unfrozen": "运行的 agent 与确认时冻结的不一致，所以没有启动。",
  "continuation-registration": "这个运行要续接的续跑没有登记，所以没有启动。",
  "skills-inject-failed": "给运行注入技能失败（{{detail}}）；修好 syncskill 后重试运行。",
  "config-hash-mismatch": "ccloop 接受这个运行时用的配置与冻结的不一致，所以停在这里。",
  "stop-proof-generation": "ccloop 的停止证明属于这个运行的另一代。",
  "inspect-unknown": "多次检查后 ccloop 仍说不清这个运行是否还活着；ccloop 能回答后再重试运行。",
  "accept-refused": "ccloop 拒绝接受这个运行：{{detail}}",
  "candidate-without-terminal": "ccloop 停止了这个运行，但没有最终报告，所以无法结算。",
  "terminal": "ccloop 结束了这个运行，但没有成功（结果 {{detail}}）。",
  "out-of-bounds": "运行改了允许范围之外的文件：{{detail}}",
  "single-call-record-invalid": "单次调用的记录读不懂。",
  "single-call-prompt-mismatch": "单次调用回答的不是发出去的那个提示。",
  "settle-incomplete": "运行没有结算完；请重试运行。",
  "requirement-call-target-moved": "这次调用开始前需求已经往前走了，所以没有发出。",
  "estimate-request-missing": "这份估算没有冻结的请求，所以无法运行。",
  "requirement-usage-unknown": "这次需求调用的用量未知，所以它的预算无法结算。",
  "estimate-usage-unknown": "这次估算调用的用量未知，所以它的预算无法结算。",
  "repository-path": "解析不到这个组的仓库路径；确认仓库仍已登记并且存在，然后重试运行。",
```

  (`skills-unsupported-agent` already has a zh entry from the catalog.)

  (b) `web/src/locales/en.ts`: append after line 770 (`} as const;`):

```ts

/**
 * Spec 2026-10-08 §2.2(a): the English text shown for a refusal code (and a blocked run's reason) in place of the
 * server's message, keyed exactly as zhErrors (tests/panel/refusalCoverage.test.ts keeps the two key sets equal). Each
 * entry says what happened and, where there is one, what to do next; it interpolates {{detail}} (the message after
 * `<code>:`) wherever the Chinese entry carries the message, so the code shown beside it is never repeated. Not part of
 * the `en` key set, like zhErrors.
 */
export const enErrors: Record<string, string> = {
  // ... generated per the rule below, in zhErrors' order and with its section comments in English ...
};
```

  **Generation rule (the executor writes every entry; `tests/panel/refusalCoverage.test.ts` is the acceptance):**
  1. One English entry for every key of `zhErrors` after (a) above — same keys, same order, same section comments
     translated to English. Nothing else.
  2. Text: one sentence saying what happened, then — when the code's meaning implies something the person can do in the
     panel or at the command line — one short imperative sentence saying it. Meaning comes from the zh entry, the code's
     registration in `src/control/errors.ts` (status: 409 = someone else moved first / state conflict, 422 = request not
     acceptable now, 404 = not found, 423 = locked by recovery, 503 = try again later), and the throw sites found with
     `grep -rn '"<code>"' src` (read them; do not guess). No second sentence when there is no honest action (an internal
     identity conflict, an invariant). Button names are quoted as `en.ts` spells them ("Retry run", "Import plan",
     "Record another", "Resume dispatch").
  3. Placeholders: wherever the zh entry has `{{message}}`, the English entry has `{{detail}}` instead, placed where the
     server's words read naturally; `http-status` keeps `{{status}}` and `{{message}}` (its message carries no code). No
     other placeholder; the text never contains its own code.
  4. Plain ASCII punctuation, sentence case, ending with a period unless it ends in a placeholder.
  5. These entries are written verbatim (some are pinned by criteria):

```ts
  "control-plan-rejected": "The plan was not imported: {{detail}}",
  "stop-mode-conflict": "The group's current stop does not allow this command. Leave the stop first (\"Resume dispatch\", or the resume offered after a handoff), then try again.",
  "revision-conflict": "Another tab or session changed this group first. The group is read again; check it, then try again.",
  "group-state-invalid": "The group's current state does not allow this command. Only the buttons its view shows apply now.",
  "group-reserve-insufficient": "The group's unallocated reserve is too small ({{detail}}). Raise the group limit or lower another allocation in the budget editor, then try again.",
  "panel-draining": "The panel is shutting down and accepts no commands. Start it again, then retry.",
  "recovery-blocked": "Recovery is blocked: {{detail}}. Clear what the Recovery section names, then retry.",
  "control-port-unconfigured": "This panel has no execution port, so it serves only recovery and evidence. Restart it with an agents table to run work.",
  "group-stopped": "The group is stopped. Resume it before sending this command.",
  "dependency-not-done": "A task this one depends on is not done yet. Wait for it to finish.",
  "estimate-in-flight": "An estimate is already running for this group. Wait for it to finish, then try again.",
  "work-already-active": "This task already has an active run. Wait for it to settle.",
  "command-result-not-found": "The ledger has no result for this command: {{detail}}",
  "control-internal-error": "The control plane failed internally: {{detail}}. Retry; if it repeats, read the panel's log.",
  "http-status": "The panel answered HTTP {{status}} without an error code: {{message}}",
  "panel-unreachable": "Could not reach the panel: {{detail}}. Check that it is running, then reload the page.",
  "csrf-required": "The request lacks its CSRF header. Reload the page, then try again.",
  "correction-already-recorded": "You already recorded a correction on this decision. To record a second, separate one, choose \"Record another\"; it is kept alongside the first rather than replacing it.",
  "labels-invalid": "The labels are not valid: {{detail}}",
  "terminal": "ccloop finished this run without success (outcome {{detail}}).",
  "out-of-bounds": "The run changed files outside the paths it may change: {{detail}}",
```

  (c) `web/src/i18n.ts`: line 10 `import { en } from "./locales/en.js";` becomes `import { en, enErrors } from "./locales/en.js";`. Replace lines 92-106 (the `refusalText` doc comment and function) with:

```ts
/** The current language's refusal table (spec 2026-10-08 §2.2(a)). */
function errorTable(): Record<string, string> {
  return currentLanguage() === "zh" ? zhErrors : enErrors;
}

/** The current language's entry for a code; hasOwnProperty, so a code such as "toString" never finds an Object.prototype member. */
export function errorEntry(code: string): string | undefined {
  const table = errorTable();
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

/** An entry with its {{message}}, {{status}} and {{detail}} filled. */
export function fillEntry(entry: string, values: { message: string; status: string; detail: string }): string {
  return entry.replace(/\{\{(message|status|detail)\}\}/g, (_match: string, name: "message" | "status" | "detail") => values[name]);
}

/** Spec 2026-10-08 §2.2(a): the server's words after `<code>:` -- nothing when the message is the code, all of it when it has no such prefix. */
export function refusalDetail(refusal: { code: string; message: string }): string {
  if (refusal.message === refusal.code) return "";
  const prefix = `${refusal.code}:`;
  return refusal.message.startsWith(prefix) ? refusal.message.slice(prefix.length) : refusal.message;
}

/**
 * Spec §3.2; spec 2026-10-08 §2.2(a): what a refusal says -- the current language's entry for its code (http-<n> is the
 * one entry http-status), with {{message}}, {{status}} and {{detail}} filled from the refusal, else the message as sent.
 * The code is on screen beside it, so the fallback is visible.
 */
export function refusalText(refusal: { code: string; message: string; status: number | null }): string {
  const key = /^http-\d+$/.test(refusal.code) ? "http-status" : refusal.code;
  const entry = errorEntry(key);
  if (entry === undefined) return refusal.message;
  return fillEntry(entry, { message: refusal.message, status: String(refusal.status ?? ""), detail: refusalDetail(refusal) });
}
```

  (d) `web/src/Refusal.tsx` lines 4-9:

```ts
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` and `message`
 * are shown as sent -- in English; in Chinese the message is the entry for its
 * code when there is one (panel i18n spec §3.2) -- the message is the panel's
 * own sentence (spec §4.4), and for a failed `reviewed` mark it is the only
 * place the person learns the correction landed but the mark did not (spec
 * §4.3.1), so the Chinese entries for the codes that path relays carry it.
```

  become:

```ts
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` is shown as
 * sent; the message is the current language's entry for its code when there is
 * one (panel i18n spec §3.2, spec 2026-10-08 §2.2(a)) -- the message is the panel's
 * own sentence (spec §4.4), and for a failed `reviewed` mark it is the only
 * place the person learns the correction landed but the mark did not (spec
 * §4.3.1), so both languages' entries for the codes that path relays carry it.
```

- [ ] **Step 4: Run, expect PASS** — root: `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; `npm run typecheck` ⇒ rc=0. Web: `cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx tests/decisionsStatusFilter.test.tsx tests/usagePanel.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0. Then the whole web suite: `npm run --workspace web check > $S/web.txt 2>&1; echo rc=$?` ⇒ rc=0. If any other web test is red, stop and report it by name (Rule 12): only the three rewrites above are approved.

- [ ] **Step 5: Mutation** — in `$M`:
  1. Delete the `enErrors` entry `"group-not-found"` ⇒ `refusalCoverage.test.ts` "has a en entry for every …" red, and "keeps the two tables over the same codes" red.
  2. Delete the `zhErrors` entry `"group-not-found"` ⇒ "has a zh entry for every …" red.
  3. Write `"labels-invalid": "The labels are not valid: {{message}}"` in `enErrors` ⇒ "never repeats the code in English" red.
  4. In `refusalText`, pass `detail: refusal.message` ⇒ `web/tests/refusalText.test.tsx` "fills {{detail}} …" red.
  5. Restore `if (currentLanguage() !== "zh") return refusal.message;` as `refusalText`'s first line ⇒ "renders an English refusal's entry for a known code …" red.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/locales/en.ts web/src/locales/zh.ts web/src/i18n.ts web/src/Refusal.tsx tests/panel/refusalCoverage.test.ts web/tests/refusalText.test.tsx web/tests/decisionsStatusFilter.test.tsx` and:

```
feat(web): explain every refusal in English and Chinese

English showed the server's machine text (control-plan-rejected:task-control-metadata:a).
enErrors now covers the same codes as zhErrors, entries say what happened and what to do,
and {{detail}} (the message after <code>:) keeps the code from being repeated beside
itself. The coverage criterion checks both languages, the reasons a blocked run shows,
and the new placeholder.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

