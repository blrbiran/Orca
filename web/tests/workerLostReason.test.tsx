import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");
const lost = run({ runId: "run-l", state: "blocked", outcome: "failed", stopReason: "worker-lost: owner pid 123 does not exist",
  failureCause: { cause: "worker-lost", phase: "execute", retries: 0, detail: "owner pid 123 does not exist" } });

// Worker-lost recovery spec 2026-11-12 §5.6 (#273): the Web run reason says the worker was lost and why that can happen,
// and that Orca starts the task again by itself.
describe("a run whose worker was lost (#273)", () => {
  it("says worker lost (the machine restarted or the process was killed), in English and Chinese", async () => {
    // mutation: worker-lost missing from KNOWN_FAILURE_CAUSES -> "the cause is unknown", red
    expect(text(renderToStaticMarkup(<RunReason run={lost} />))).toContain("Why it stopped: worker lost (the machine restarted or the process was killed). Orca starts the task again by itself");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={lost} />))).toContain("执行进程丢失（机器重启或进程被杀）");
  });
});
