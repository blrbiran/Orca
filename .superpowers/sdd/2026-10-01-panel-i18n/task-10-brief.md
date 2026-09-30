### Task 10: The error page, refusals, web-made messages and the Chinese refusal table

Spec §3.2, §3.3, §6.4. English refusals render `message` byte-identically; Chinese shows `zhErrors[code]` (with the
refusal's `{{message}}`/`{{status}}` where the entry carries them, F14), else the message as sent; the code is always on
screen.

**Files:**
- Modify: `web/src/i18n.ts` (add `refusalText`; import `zhErrors`), `web/src/locales/zh.ts` (`zhErrors`), `web/src/locales/en.ts`/`zh.ts` (`panelErrors`)
- Modify: `web/src/ErrorPage.tsx`, `web/src/Refusal.tsx`, `web/src/ControlPanel.tsx:167-173`, `web/src/api.ts:47`, `web/src/controlApi.ts:76,79,138,140,165,168,178`
- Create: `tests/panel/refusalCoverage.test.ts`, `web/tests/refusalText.test.tsx`

**Interfaces:**
- Produces (`web/src/i18n.ts`): `export function refusalText(refusal: { code: string; message: string; status: number | null }): string;`

**Keys:**

| Key | English | 中文 | Site (today) |
|---|---|---|---|
| `panelErrors.title` | `orca panel could not load` | `orca 面板加载失败` | `ErrorPage.tsx:14` |
| `panelErrors.noAnswerFromPanel` | `no answer from the panel` | `面板没有回应` | `:16` |
| `panelErrors.answered` | `answered {{status}}` | `返回了 {{status}}` | `ErrorPage.tsx:16`, `controlApi.ts:79,140` |
| `panelErrors.recordAnother` | `Record another` | `再记录一条` | `Refusal.tsx:32` |
| `panelErrors.httpStatus` | ` · HTTP {{status}}` | ` · HTTP {{status}}` | `ControlPanel.tsx:170` |
| `panelErrors.serverRevision` | ` · server revision {{revision}}` | ` · 服务端版本 {{revision}}` | `:171` |
| `panelErrors.whatAnswered` | `{{what}} answered {{status}}` | `{{what}} 返回了 {{status}}` | `api.ts:47` |
| `panelErrors.noAnswer` | `no answer` | `没有回应` | `controlApi.ts:76,138` |
| `panelErrors.neverAnswered` | `never answered` | `一直没有回应` | `:165` |
| `panelErrors.mayNotHaveCommitted` | `the panel may not have committed this command` | `面板可能没有提交这条命令` | `:168` |
| `panelErrors.noOutcome` | `The panel answered without a command outcome.` | `面板的回答里没有命令结果。` | `:178` |

Kept as written (F18): the `GET ${path}` / `POST ${path}` fragments (`api.ts:76,87`, `controlApi.ts:76,79,138,140,165,168`) are the data part (`what`) of those messages.

- [ ] **Step 1: Write the failing criteria**

`tests/panel/refusalCoverage.test.ts`:

```ts
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
```

`web/tests/refusalText.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.2, §3.3, §6.4: an English refusal shows the server's message byte for byte (the refusal, the error
 * page, the control line); Chinese shows the entry for its code, with the server's detail where the entry carries it, and
 * the message as sent for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own
 * messages are built in the reader's language.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refusalFrom } from "../src/api.js";
import { refusalFromAnswer } from "../src/controlApi.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { ErrorPage } from "../src/ErrorPage.js";
import i18n, { refusalText } from "../src/i18n.js";
import { Refusal } from "../src/Refusal.js";
import type { ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import type { ControlRefusal } from "../src/controlState.js";

const SENT = 'the server\'s own sentence <with> & "marks"';
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [], plans: [],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const controlLine = (refusal: ControlRefusal): string | null | undefined => {
  const { container } = render(
    <ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={refusal}
      refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />,
  );
  return container.querySelector(`p[role="alert"][data-status="${refusal.status ?? ""}"]`)?.textContent;
};

afterEach(cleanup);

describe("refusals in the reader's language (spec §3.2, §6.4)", () => {
  it("renders an English refusal's message byte for byte in the refusal, the error page and the control line", () => {
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
    cleanup();
    render(<ErrorPage failure={{ status: 409, code: "unresolved-project-keys", message: SENT }} />);
    expect(screen.getByTestId("error-message").textContent).toBe(SENT);
    expect(screen.getByTestId("error-status").textContent).toBe("answered 409");
    cleanup();
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe(`revision-conflict · HTTP 409 · server revision 7 · ${SENT}`);
  });

  it("shows the Chinese entry for a known code, with the server's detail where the entry carries it, and keeps the code", async () => {
    await i18n.changeLanguage("zh");
    expect(refusalText({ code: "revision-conflict", message: SENT, status: 409 })).toBe("版本冲突：别的标签页或会话先提交了，请重新读取。");
    expect(refusalText({ code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape", status: 422 })).toBe("做法的输入不合法：loop-plan-invalid:path-shape");
    expect(refusalText({ code: "http-503", message: "GET /api/x answered 503", status: 503 })).toBe("面板返回了 HTTP 503，没有给出错误码。");
    render(<Refusal refusal={{ status: 409, code: "correction-already-recorded", message: SENT, retry_field: "again" }} />);
    expect(screen.getByTestId("refusal-code").textContent).toBe("correction-already-recorded");
    expect(screen.getByTestId("refusal-message").textContent).toContain("你已经对这条决策记录过纠正。");
    expect(screen.getByTestId("record-another").textContent).toBe("再记录一条");
    cleanup();
    render(<ErrorPage failure={{ status: null, code: "panel-unreachable", message: "Failed to fetch" }} />);
    expect(screen.getByTestId("error-message").textContent).toBe("没有连上面板：Failed to fetch");
    expect(screen.getByTestId("error-status").textContent).toBe("面板没有回应");
    expect(screen.getByRole("heading").textContent).toBe("orca 面板加载失败");
    cleanup();
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe("revision-conflict · HTTP 409 · 服务端版本 7 · 版本冲突：别的标签页或会话先提交了，请重新读取。");
  });

  it("shows the message as sent for a code with no Chinese entry, and never an Object.prototype member (Review Focus 4)", async () => {
    await i18n.changeLanguage("zh");
    for (const code of ["a-code-nobody-listed", "toString", "constructor", "__proto__"]) expect(refusalText({ code, message: SENT, status: 409 }), code).toBe(SENT);
    render(<Refusal refusal={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    expect(screen.getByTestId("refusal-code").textContent).toBe("a-code-nobody-listed");
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
  });

  it("builds the web's own refusal messages in the reader's language", async () => {
    expect(refusalFrom("GET /api/x", 409, undefined).message).toBe("GET /api/x answered 409");
    expect(refusalFromAnswer({ kind: "answered", status: 422, body: {} as never }).message).toBe("The panel answered without a command outcome.");
    await i18n.changeLanguage("zh");
    expect(refusalFrom("GET /api/x", 409, undefined).message).toBe("GET /api/x 返回了 409");
    expect(refusalFromAnswer({ kind: "answered", status: 422, body: {} as never }).message).toBe("面板的回答里没有命令结果。");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > "$SCRATCH/t10-red-root.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx) > "$SCRATCH/t10-red-web.txt" 2>&1; echo rc=$?
```
Expected both `rc=1` (`zhErrors` empty; `refusalText` not exported).

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`, in `en` after `agents`:
```ts
  panelErrors: {
    title: "orca panel could not load",
    noAnswerFromPanel: "no answer from the panel",
    answered: "answered {{status}}",
    recordAnother: "Record another",
    httpStatus: " · HTTP {{status}}",
    serverRevision: " · server revision {{revision}}",
    whatAnswered: "{{what}} answered {{status}}",
    noAnswer: "no answer",
    neverAnswered: "never answered",
    mayNotHaveCommitted: "the panel may not have committed this command",
    noOutcome: "The panel answered without a command outcome.",
  },
```
`web/src/locales/zh.ts`, in `zh` after `agents`:
```ts
  panelErrors: {
    title: "orca 面板加载失败",
    noAnswerFromPanel: "面板没有回应",
    answered: "返回了 {{status}}",
    recordAnother: "再记录一条",
    httpStatus: " · HTTP {{status}}",
    serverRevision: " · 服务端版本 {{revision}}",
    whatAnswered: "{{what}} 返回了 {{status}}",
    noAnswer: "没有回应",
    neverAnswered: "一直没有回应",
    mayNotHaveCommitted: "面板可能没有提交这条命令",
    noOutcome: "面板的回答里没有命令结果。",
  },
```
and replace `export const zhErrors: Record<string, string> = {};` with (172 entries; `{{message}}` is the refusal's message as sent, `{{status}}` its HTTP status):
```ts
export const zhErrors: Record<string, string> = {
  // Spec §3.2, §6.4: every code of controlErrorCatalog() (src/panel/controlErrors.ts), 124 at ac969bb.
  "agent-context-unsupported": "agent 不支持这个上下文窗口：{{message}}",
  "agent-installation-missing": "安装表里没有这个 agent：{{message}}",
  "agent-selection-changed": "agent 选择在确认时已变化，请重新读取后再确认。",
  "agent-selection-invalid": "agent 选择不合法：{{message}}",
  "agent-selection-rejected": "ccloop 拒绝了这个 agent 选择：{{message}}",
  "agent-unselected": "有槽位没有选定 agent。",
  "agent-version-drift": "agent 版本与记录的不一致：{{message}}",
  "agents-table-invalid": "agent 安装表不合法：{{message}}",
  "artifact-id-conflict": "产物 id 冲突。",
  "artifact-not-found": "找不到这个产物。",
  "budget-overflow": "预算数值溢出：{{message}}",
  "budget-owned-by-loop-plan": "这个 loop 任务的工作预算只能在做法卡片里改。",
  "checkpoint-id-conflict": "检查点 id 冲突。",
  "checkpoint-identity-conflict": "检查点身份冲突。",
  "checkpoint-not-committed": "检查点尚未提交。",
  "checkpoint-run-settled": "这个运行已结算，不能再写检查点。",
  "checkpoint-usage-high-water": "检查点用量低于已记录的高水位。",
  "cleanup-not-recoverable": "清理无法恢复。",
  "command-result-not-found": "台账里没有这条命令的结果。",
  "continuation-budget-unavailable": "续跑所需的预算不够。",
  "continuation-identity-conflict": "续跑身份冲突。",
  "continuation-predecessor-unrecoverable": "前一个运行无法恢复，不能续跑。",
  "control-capability-unsupported": "所需能力不受支持：{{message}}",
  "control-estimator-unconfigured": "面板没有配置估算 profile。",
  "control-evidence-unavailable": "证据不可用。",
  "control-internal-error": "控制面内部出错：{{message}}",
  "control-invalid-stop": "停止请求不合法。",
  "control-non-canonical-json": "请求体不是规范 JSON：{{message}}",
  "control-non-json-payload": "请求体不是合法的 JSON 载荷：{{message}}",
  "control-operation-in-progress": "另一个控制操作正在进行，请稍后重试。",
  "control-owner-changed": "控制面的持有者已变化，请稍后重试。",
  "control-plan-rejected": "计划被拒绝：{{message}}",
  "control-port-unconfigured": "没有配置执行端口：面板只提供恢复和证据。",
  "control-protocol-unavailable": "控制协议不可用。",
  "control-recovery-busy": "恢复正在进行，请稍后重试。",
  "control-recovery-required": "需要先完成恢复。",
  "control-target-not-allowed": "不允许操作这个目标。",
  "control-terminal-pending": "还有未结束的终态处理。",
  "control-writer-active": "另一个写入者正在工作，请稍后重试。",
  "dependency-not-done": "依赖的任务还没完成。",
  "duplicate-proposal-target": "提案里有重复的目标：{{message}}",
  "duplicate-task-id": "任务 id 重复：{{message}}",
  "estimate-in-flight": "有一份估算正在进行。",
  "estimate-stale": "这份估算早于一次做法修改，它的建议不能再用。",
  "execution-identity-conflict": "执行身份冲突。",
  "execution-policy-unrepresentable": "执行策略无法表达：{{message}}",
  "grant-amendment-unsupported": "有任务已经开始，提案不能再改。",
  "graph-change-needs-handoff": "改任务图需要先交接。",
  "graph-cycle": "任务图有环：{{message}}",
  "graph-dangling-dependency": "任务图里有悬空的依赖：{{message}}",
  "graph-version-conflict": "任务图版本冲突。",
  "group-already-exists": "这个组已存在。",
  "group-budget-unavailable": "组预算不够。",
  "group-deadline-expired": "组的截止时间已过。",
  "group-graph-conflict": "组的任务图冲突。",
  "group-not-found": "找不到这个组。",
  "group-project-binding-required": "组必须绑定到一个项目。",
  "group-project-conflict": "组与项目的绑定冲突。",
  "group-reserve-insufficient": "组余量不够：{{message}}",
  "group-review-budget-unavailable": "组的评审预算不够。",
  "group-state-invalid": "组当前的状态不允许这个操作。",
  "group-stopped": "组已停止。",
  "handoff-budget-unavailable": "交接预算不够。",
  "handoff-grant-insufficient": "交接额度不够。",
  "handoff-identity-conflict": "交接身份冲突。",
  "handoff-parent-invalid": "交接的父运行不合法。",
  "handoff-request-conflict": "交接请求冲突。",
  "handoff-work-not-found": "找不到要交接的工作。",
  "identity-space-exhausted": "身份编号已用尽。",
  "labels-invalid": "标签不合法：{{message}}",
  "labels-version-conflict": "你开始草稿后标签已被改过，请重新读取后再保存。",
  "landing-branch-conflict": "合入分支冲突。",
  "landing-needs-review": "合入之前需要评审。",
  "landing-not-confirmed": "合入尚未确认。",
  "loop-plan-invalid": "做法的输入不合法：{{message}}",
  "no-op-command": "这条命令不会改变任何东西。",
  "numeric-overflow": "数值溢出：{{message}}",
  "panel-draining": "面板正在关闭，请稍后重试。",
  "panel-host-not-allowed": "不允许从这个主机访问面板。",
  "plan-version-conflict": "计划版本冲突。",
  "profile-changed": "profile 已变化。",
  "proposal-version-conflict": "提案版本冲突：提案在你看过之后被改过。",
  "query-invalid": "查询参数不合法：{{message}}",
  "reconcile-budget-unapproved": "协调预算尚未批准。",
  "reconcile-registration-invalid": "协调登记不合法。",
  "reconcile-version-conflict": "协调版本冲突。",
  "recovery-blocked": "恢复被阻塞：{{message}}",
  "recovery-validation-failed": "恢复校验失败：{{message}}",
  "report-commit-invalid": "报告提交不合法。",
  "report-identity-conflict": "报告身份冲突。",
  "report-path-conflict": "报告路径冲突。",
  "resume-artifact-conflict": "续跑产物冲突。",
  "resume-bundle-exists": "续跑包已存在。",
  "resume-handoff-invalid": "续跑的交接不合法。",
  "resume-predecessor-unrecoverable": "前一个运行无法恢复，不能续跑。",
  "resume-source-dir-not-absolute": "续跑的源目录不是绝对路径。",
  "revision-conflict": "版本冲突：别的标签页或会话先提交了，请重新读取。",
  "route-not-found": "没有这个接口：{{message}}",
  "run-already-settled": "这个运行已经结算。",
  "run-generation-conflict": "运行代次冲突。",
  "run-grant-conflict": "运行额度冲突。",
  "run-not-found": "找不到这个运行。",
  "run-owner-conflict": "运行持有者冲突。",
  "run-stop-unconfirmed": "运行的停止尚未确认。",
  "snapshot-invalid": "执行快照不合法：{{message}}",
  "snapshot-partial": "执行快照不完整。",
  "snapshot-required": "需要执行快照。",
  "start-contract-conflict": "启动契约冲突。",
  "start-envelope-conflict": "启动信封冲突。",
  "start-intent-missing": "找不到启动意图。",
  "start-state-conflict": "启动状态冲突。",
  "stop-already-active": "已经有一个停止在进行。",
  "stop-mode-conflict": "停止方式冲突。",
  "target-version-conflict": "目标版本冲突。",
  "task-already-started": "任务已经开始，做法不能再改。",
  "task-checkpoint-not-committed": "任务的检查点尚未提交。",
  "task-has-no-loop-plan": "这个任务没有 loop 做法。",
  "task-loop-version-conflict": "你开始草稿后做法已被改过，请重新读取后再提交。",
  "token-required": "这个面板需要它的一次性 token。",
  "usage-event-conflict": "用量事件冲突。",
  "usage-gap": "用量记录有缺口。",
  "work-already-active": "工作已经在进行。",
  "work-already-done": "工作已经完成。",
  "work-not-found": "找不到这项工作。",
  // Spec §3.2: the codes the web itself makes (api.ts, controlApi.ts); http-<n> is one entry.
  "http-status": "面板返回了 HTTP {{status}}，没有给出错误码。",
  "http-unreachable": "没有连上面板：{{message}}",
  "panel-unreachable": "没有连上面板：{{message}}",
  "command-result-invalid": "面板的回答里没有命令结果。",
  // Spec §3.2: inline server codes with no catalog, listed by hand (src/panel/api.ts, reviewsLock.ts, compactReviews.ts, src/corrections/*, src/metrics/*, src/panel/chains.ts and the ChainRejection codes its log line relays).
  "decision-not-found": "找不到这条决策。",
  "panel-bad-request": "面板读不懂这个请求：{{message}}",
  "panel-internal-error": "面板内部出错：{{message}}",
  "reviews-store-busy": "评审记录正被另一个写入者占用，请稍后重试。",
  "reviews-store-is-symlink": "评审记录文件是符号链接，面板拒绝写入。",
  "correction-row-invalid": "这不是一条合法的纠正：{{message}}",
  "correction-already-recorded": "你已经对这条决策记录过纠正。如果要再记一条独立的纠正，选「再记录一条」，它会和第一条并存，而不是替换它。",
  "duplicate-correction-id": "纠正 id 重复：{{message}}",
  "correction-not-found": "找不到这条纠正。",
  "corrections-store-busy": "纠正记录正被另一个写入者占用，请稍后重试。",
  "unresolved-project-keys": "纠正记录里有面板解析不了的 projectKey：{{message}}",
  "key-matches-multiple-paths": "一个 projectKey 对应了多个路径：{{message}}",
  "repo-path-missing": "--repo 指向的目录不存在：{{message}}",
  "archive-name-ambiguous": "修复运行的归档名有歧义：{{message}}",
  "future-rows-without-as-of": "有记录晚于当前时间，而且没给 --as-of：{{message}}",
  "as-of-not-a-timestamp": "--as-of 不是 ISO 8601 时间：{{message}}",
  "repo-not-found": "这个面板没有这个仓库：{{message}}",
  "chain-args-invalid": "启动链的参数不合法：{{message}}",
  "chain-start-failed": "orca chain start 没启动就退出了：{{message}}",
  "chain-start-timeout": "规定时间内没看到链启动：{{message}}",
  "chain-not-found": "找不到这条链。",
  "chain-not-running": "这条链没有在运行。",
  "chain-config-invalid": "链配置不合法：{{message}}",
  "chain-config-missing": "缺少链配置：{{message}}",
  "chain-id-exists": "链 id 已存在：{{message}}",
  "chain-id-invalid": "链 id 不合法：{{message}}",
  "chain-lock-stale": "链锁已过期：{{message}}",
  "chain-logs-not-ignored": "链日志目录没有被 git 忽略：{{message}}",
  "chain-record-invalid": "链记录不合法：{{message}}",
  "chain-running": "已经有一条链在运行：{{message}}",
  "claude-not-found": "找不到 claude：{{message}}",
  "detached-head": "仓库处于 detached HEAD：{{message}}",
  "gate-check-failed": "闸门检查失败：{{message}}",
  "level-config-invalid": "档位配置不合法：{{message}}",
  "model-window-unknown": "不知道模型的上下文窗口：{{message}}",
  "nested-chain": "不能在链里再启动链：{{message}}",
  "no-chain-lock": "没有链锁：{{message}}",
  "no-running-chain": "没有正在运行的链：{{message}}",
  "not-a-repository": "不是 git 仓库：{{message}}",
  "not-repository-top-level": "不是仓库顶层目录：{{message}}",
  "record-commit-refused": "提交链记录被拒：{{message}}",
  "repo-lock-held": "仓库锁被占用：{{message}}",
  "tsx-missing": "找不到 tsx：{{message}}",
  "worktree-dirty": "工作区有未提交的修改：{{message}}",
};
```

`web/src/i18n.ts`: `import { zh } from "./locales/zh.js";` → `import { zh, zhErrors } from "./locales/zh.js";`; append:
```ts
/**
 * Spec §3.2: what a refusal says. English shows the message as sent, byte for byte. Chinese shows the Chinese-only entry
 * for its code (http-<n> is the one entry http-status), with {{message}} and {{status}} filled from the refusal, else the
 * message as sent -- the code is on screen beside it, so the fallback is visible. hasOwnProperty, so a code such as
 * "toString" never finds an Object.prototype member.
 */
export function refusalText(refusal: { code: string; message: string; status: number | null }): string {
  if (currentLanguage() !== "zh") return refusal.message;
  const key = /^http-\d+$/.test(refusal.code) ? "http-status" : refusal.code;
  const entry = Object.prototype.hasOwnProperty.call(zhErrors, key) ? zhErrors[key] : undefined;
  if (entry === undefined) return refusal.message;
  return entry.replace(/\{\{(message|status)\}\}/g, (_match: string, name: string) => (name === "message" ? refusal.message : String(refusal.status ?? "")));
}
```

`web/src/ErrorPage.tsx` (keep the header comment):
```tsx
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { refusalText } from "./i18n.js";

export function ErrorPage({ failure }: { failure: PanelRefusal }): JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="error-page" role="alert">
      <h1>{t("panelErrors.title")}</h1>
      <p data-testid="error-status">
        {failure.status === null ? t("panelErrors.noAnswerFromPanel") : t("panelErrors.answered", { status: failure.status })}
      </p>
      <p>
        <code data-testid="error-code">{failure.code}</code>
      </p>
      <p data-testid="error-message">{refusalText(failure)}</p>
    </main>
  );
}
```

`web/src/Refusal.tsx`: imports `import { useTranslation } from "react-i18next";`, `import { refusalText } from "./i18n.js";`; first body line `const { t } = useTranslation();`; `<p data-testid="refusal-message">{refusal.message}</p>` → `<p data-testid="refusal-message">{refusalText(refusal)}</p>`; `Record another` → `{t("panelErrors.recordAnother")}`. Header comment: after "are shown as sent" append ` -- in English; in Chinese the message is the entry for its code when there is one (panel i18n spec §3.2)`.

`web/src/ControlPanel.tsx:167-173`: add `refusalText` to the `./i18n.js` import; the paragraph's content →
```tsx
          {refusal.code}
          {refusal.status !== null ? t("panelErrors.httpStatus", { status: refusal.status }) : ""}
          {refusal.commandRevision !== null ? t("panelErrors.serverRevision", { revision: refusal.commandRevision }) : ""} · {refusalText(refusal)}
```

`web/src/api.ts`: add `import i18n from "./i18n.js";`; line 47 `message: typeof fields.message === "string" ? fields.message : `${what} answered ${status}`,` → `message: typeof fields.message === "string" ? fields.message : i18n.t("panelErrors.whatAnswered", { what, status }),`

`web/src/controlApi.ts`: add `import i18n from "./i18n.js";`; lines 76 and 138: `err instanceof Error ? err.message : "no answer"` → `err instanceof Error ? err.message : i18n.t("panelErrors.noAnswer")`; lines 79 and 140: `` `answered ${res.status}` `` → `i18n.t("panelErrors.answered", { status: res.status })`; line 165: `"never answered"` → `i18n.t("panelErrors.neverAnswered")`; line 168: `"the panel may not have committed this command"` → `i18n.t("panelErrors.mayNotHaveCommitted")`; line 178: `error?.message ?? "The panel answered without a command outcome."` → `error?.message ?? i18n.t("panelErrors.noOutcome")`.

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > "$SCRATCH/t10-green-root.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx tests/outcome.test.tsx tests/controlCommandRecovery.test.tsx tests/controlPanel.test.tsx tests/controlState.test.ts) > "$SCRATCH/t10-green-web.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t10-web-check.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t10-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t10`)
  - MT10-1 Chinese never used: `refusalText` → `return refusal.message;` as its only line. Red: `refusalText … > shows the Chinese entry for a known code …`.
  - MT10-2 English not byte-identical: delete `if (currentLanguage() !== "zh") return refusal.message;`. Red: `… > renders an English refusal's message byte for byte …`.
  - MT10-3 no http-status mapping: `/^http-\d+$/.test(refusal.code) ? "http-status" : refusal.code` → `refusal.code`. Red: `… > shows the Chinese entry …` (`http-503`).
  - MT10-4 prototype lookup: `Object.prototype.hasOwnProperty.call(zhErrors, key) ? zhErrors[key] : undefined` → `zhErrors[key]`. Red: `… > shows the message as sent for a code with no Chinese entry …` (`toString` → a function; `entry.replace` throws or returns the function's text).
  - MT10-5 error page raw: `{refusalText(failure)}` → `{failure.message}`. Red: `… > shows the Chinese entry …` (`没有连上面板：Failed to fetch`).
  - MT10-6 entry missing: delete `"revision-conflict"` from `zhErrors`. Red: `refusalCoverage … > has a Chinese entry for every catalog code …` and `refusalText … > shows the Chinese entry …`.
  - MT10-7 web-made literal: `i18n.t("panelErrors.whatAnswered", { what, status })` → `` `${what} answered ${status}` ``. Red: `… > builds the web's own refusal messages …`.
  - MT10-8 stray placeholder: `zhErrors["group-stopped"]` → `"组已停止：{{detail}}"`. Red: `refusalCoverage … > interpolates nothing but …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/i18n.ts web/src/locales/en.ts web/src/locales/zh.ts web/src/ErrorPage.tsx web/src/Refusal.tsx web/src/ControlPanel.tsx web/src/api.ts web/src/controlApi.ts tests/panel/refusalCoverage.test.ts web/tests/refusalText.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(web): show refusals in the reader's language, the code always beside them

English refusals keep the server's message byte for byte. Chinese shows a
Chinese-only entry for the refusal code -- every control catalog code, every
code the web makes and the inline server codes listed by hand -- carrying the
server's detail where it matters, and the message as sent for a code with no
entry. The error page and the web's own messages read in the chosen language.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

