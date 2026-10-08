// @vitest-environment jsdom
/**
 * Panel i18n spec §3.2, §3.3, §6.4; spec 2026-10-08 §2.2(a): a refusal shows the current language's entry for its code
 * (English and Chinese alike), with the server's detail where the entry carries it, and the message as sent, byte for
 * byte, for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own messages are
 * built in the reader's language.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refusalFrom } from "../src/api.js";
import { ControlRequestError, downloadEvidenceArtifact, fetchControlConfig, refusalFromAnswer, sendControlCommand } from "../src/controlApi.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { ErrorPage } from "../src/ErrorPage.js";
import i18n, { fillEntry, refusalText } from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { Refusal } from "../src/Refusal.js";
import type { CommandEnvelopeV1, ControlConfigV1, ControlSummaryV1, EvidenceManifestV1, RecoveryViewV1 } from "../src/controlTypes.js";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The message a control read refused with, or the thrown value when it was not a ControlRequestError. */
const refusedWith = async (read: () => Promise<unknown>): Promise<unknown> => {
  try {
    await read();
  } catch (err) {
    return err instanceof ControlRequestError ? err.refusal.message : err;
  }
  return "resolved";
};

describe("refusals in the reader's language (spec §3.2, §6.4)", () => {
  // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows its own entry for a known code -- it used to show
  // the server's message, e.g. `control-plan-rejected:task-control-metadata:a`. The message as sent, byte for byte, is
  // still the fallback for a code with no entry, in every place a refusal is shown.
  it("renders an English refusal's entry for a known code, and the message byte for byte for a code with none, in the refusal, the error page and the control line", () => {
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(enErrors["revision-conflict"]);
    cleanup();
    render(<Refusal refusal={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    // Review Focus 5 (controller amendment): an English viewer of a code with no entry sees the server's message beside the raw code.
    expect(screen.getByTestId("refusal-code").textContent).toBe("a-code-nobody-listed");
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
    // A3 review finding 4: a bare code drops the colon before its empty detail and ends the sentence.
    expect(refusalText({ code: "labels-invalid", message: "labels-invalid", status: 422 })).toBe("The labels are not valid.");
    expect(refusalText({ code: "http-502", message: "POST /x: the panel may not have committed this command", status: 502 }))
      .toBe("The panel answered HTTP 502 without an error code: POST /x: the panel may not have committed this command");
  });

  // A3 review finding 4: recovery-blocked is thrown bare (src/panel/controlApi.ts ensurePanelOperatorId); an empty value
  // takes its separator with it -- a parenthesis around it, a colon before it mid-sentence or at the end, in both scripts.
  it("drops the separator around an empty detail instead of leaving a dangling colon or empty parentheses", () => {
    expect(refusalText({ code: "recovery-blocked", message: "recovery-blocked", status: 423 })).toBe("Recovery is blocked. Clear what the Recovery section names, then retry.");
    expect(refusalText({ code: "control-internal-error", message: "control-internal-error", status: 500 })).toBe("The control plane failed internally. Retry; if it repeats, read the panel's log.");
    expect(refusalText({ code: "control-internal-error", message: "control-internal-error:disk full.", status: 500 })).toBe("The control plane failed internally (disk full.). Retry; if it repeats, read the panel's log.");
    const empty = { message: "", status: "", detail: "" };
    expect(fillEntry("ccloop finished this run without success (outcome {{detail}}).", empty)).toBe("ccloop finished this run without success.");
    expect(fillEntry("给运行注入技能失败（{{detail}}）；修好 syncskill 后重试运行。", empty)).toBe("给运行注入技能失败；修好 syncskill 后重试运行。");
    expect(fillEntry("标签不合法：{{message}}", empty)).toBe("标签不合法。");
  });

  it("shows the Chinese entry for a known code, with the server's detail where the entry carries it, and keeps the code", async () => {
    await i18n.changeLanguage("zh");
    expect(refusalText({ code: "revision-conflict", message: SENT, status: 409 })).toBe("版本冲突：别的标签页或会话先提交了，请重新读取。");
    expect(refusalText({ code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape", status: 422 })).toBe("做法的输入不合法：loop-plan-invalid:path-shape");
    expect(refusalText({ code: "http-503", message: "GET /api/x answered 503", status: 503 })).toBe("面板返回了 HTTP 503，没有给出错误码：GET /api/x answered 503");
    // Spec §4.3.1: a failed reviewed mark relays reviews-store-* with the only sentence saying the correction landed.
    const landed = "the correction was recorded (id c-1), but the reviewed mark could not be written: busy";
    expect(refusalText({ code: "reviews-store-busy", message: landed, status: 409 })).toBe(`评审记录正被另一个写入者占用：${landed}`);
    expect(refusalText({ code: "reviews-store-is-symlink", message: landed, status: 409 })).toBe(`评审记录文件是符号链接，面板拒绝写入：${landed}`);
    render(<Refusal refusal={{ status: 409, code: "correction-already-recorded", message: SENT, retry_field: "again" }} />);
    expect(screen.getByTestId("refusal-code").textContent).toBe("correction-already-recorded");
    expect(screen.getByTestId("refusal-message").textContent).toContain("你已经对这条决策记录过纠正。");
    expect(screen.getByTestId("record-another").textContent).toBe("再记录一条");
    cleanup();
    render(<ErrorPage failure={{ status: null, code: "panel-unreachable", message: "Failed to fetch" }} />);
    expect(screen.getByTestId("error-message").textContent).toBe("没有连上面板：Failed to fetch");
    expect(screen.getByTestId("error-status").textContent).toBe("面板没有回应");
    cleanup();
    render(<ErrorPage failure={{ status: 409, code: "unresolved-project-keys", message: SENT }} />);
    expect(screen.getByTestId("error-status").textContent).toBe("返回了 409");
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

  it("builds the control requests' own fallback messages in the reader's language", async () => {
    await i18n.changeLanguage("zh");
    const entry = { evidenceId: "ev-1", downloadUrl: "/api/control/runs/r1/evidence/ev-1" } as EvidenceManifestV1["entries"][number];
    const envelope = {} as CommandEnvelopeV1;
    // A fetch that rejects with something other than an Error: no answer at all.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("gone")));
    expect(await refusedWith(fetchControlConfig)).toBe("GET /api/control/config: 没有回应");
    expect(await refusedWith(() => downloadEvidenceArtifact(entry))).toBe(`GET ${entry.downloadUrl}: 没有回应`);
    expect(await sendControlCommand("/api/control/x", envelope)).toMatchObject({ kind: "uncertain", refusal: { message: "POST /api/control/x: 一直没有回应" } });
    // An answer with no body the page can read.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("not json", { status: 409 }))));
    expect(await refusedWith(fetchControlConfig)).toBe("GET /api/control/config: 返回了 409");
    expect(await refusedWith(() => downloadEvidenceArtifact(entry))).toBe(`GET ${entry.downloadUrl}: 返回了 409`);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("not json", { status: 503 }))));
    expect(await sendControlCommand("/api/control/x", envelope)).toMatchObject({ kind: "uncertain", refusal: { message: "POST /api/control/x: 面板可能没有提交这条命令" } });
    // Task 10 review Important 1: an unparsable 5xx is http-<n>, and the control line must still say the command may not
    // have committed -- for a workspace-mode or agent-preferences POST it is the only notice.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("Bad Gateway", { status: 502 }))));
    const answer = await sendControlCommand("/api/control/x", envelope);
    if (answer.kind !== "uncertain") throw new Error(`expected an uncertain answer, got ${answer.kind}`);
    expect(controlLine(answer.refusal)).toBe("http-502 · HTTP 502 · 面板返回了 HTTP 502，没有给出错误码：POST /api/control/x: 面板可能没有提交这条命令");
  });
});
