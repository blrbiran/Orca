// @vitest-environment jsdom
/**
 * Tester #302: in Chinese the agent's run record was called 「转录」, which reads as a speech transcription. It is
 * 「执行记录」 now, the same word wherever the record shows (Live, the Runs pane, the task detail all render
 * RunTranscript). English keeps "Transcript".
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunTranscript } from "../src/AgentTranscript.js";
import { zh } from "../src/locales/zh.js";

afterEach(cleanup);
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value !== null && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("tester #302: 执行记录, not 转录", () => {
  it("names the disclosure and its region 执行记录 in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      render(<RunTranscript runId="run-a" active={false} />);
      // mutation: restore disclosure 「转录」 -> no button named 执行记录, red
      expect(screen.getByRole("button", { name: "执行记录" })).toBeTruthy();
      // mutation: restore region 「{{runId}} 的转录」 -> red
      expect(screen.getByRole("region", { name: "run-a 的执行记录" })).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("leaves no 转录 in any Chinese string", () => {
    // mutation: leave runDetail 「转录与证据」 -> red
    expect(strings(zh).filter((text) => text.includes("转录"))).toEqual([]);
  });

  it("keeps Transcript in English", () => {
    render(<RunTranscript runId="run-a" active={false} />);
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();
  });
});
