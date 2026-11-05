import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const UNTIL = Date.UTC(2026, 10, 5, 16, 12);
const local = (at: number): string => new Date(at).toLocaleString();
const quotaRun = (source: "vendor" | "default") => run({ runId: "run-q", state: "blocked", outcome: "failed", stopReason: "Error: codex-quota",
  failureCause: { cause: "quota", phase: "plan", retries: 0, detail: null }, quotaRest: { installation: "codex", until: UNTIL, source } });
const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

/**
 * Quota failover spec 2026-11-03 §3 (session 3cfc2e73, batch FB): a task stopped on quota that Orca could not move says
 * which installation is out and until when -- the vendor's named reset, or the default rest's end ("retry around").
 */
describe("a quota-stopped run names its installation's rest (§3)", () => {
  it("says until when, in English and Chinese, after the quota line", async () => {
    const vendor = text(renderToStaticMarkup(<RunReason run={quotaRun("vendor")} />));
    expect(vendor).toContain(`codex is out of quota until ${local(UNTIL)}.`);
    expect(vendor.indexOf("quota or credits are used up")).toBeLessThan(vendor.indexOf("codex is out of quota"));
    expect(text(renderToStaticMarkup(<RunReason run={quotaRun("default")} />))).toContain(`codex is resting, retry around ${local(UNTIL)}.`);
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={quotaRun("vendor")} />))).toContain(`codex 的额度已用尽，${local(UNTIL)} 恢复。`);
    expect(text(renderToStaticMarkup(<RunReason run={quotaRun("default")} />))).toContain(`codex 正在休息，约 ${local(UNTIL)} 后可重试。`);
  });

  it("says nothing of a rest when the view carries none", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-q", state: "blocked", outcome: "failed", stopReason: "Error: codex-quota", failureCause: { cause: "quota", phase: "plan", retries: 0, detail: null } })} />);
    expect(html).not.toContain("run-quota-rest");
    expect(html).not.toContain("out of quota until");
  });
});
