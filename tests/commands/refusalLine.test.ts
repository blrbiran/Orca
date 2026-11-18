// Tester #373 (batch D C1): a refusal printed `orca: <code>: <code>` because the panel's message is `code` or `code:detail`
// (ControlError.message, persisted in command results, so it is not changed). The human line names the code once and keeps
// the whole detail; a common refusal with no verb hint says what to do next. #368a: a started group's agent-selection
// refusal names why. #374d: a pending start says it is queued.
import { describe, expect, it } from "vitest";
import { printResponse } from "../../src/commands/output.js";
import { nextForCode } from "../../src/commands/errorNext.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

function printed(code: string, message: string | undefined, hint?: string, extra: { next?: string[]; groupId?: string } = {}): string {
  let err = "";
  printResponse({ schema: "orca-cli-response-v1", status: 409, body: { error: { code, ...(message === undefined ? {} : { message }) } } },
    { json: false, quiet: false, format: () => "", ...(hint === undefined ? {} : { hint: () => hint }), ...extra },
    { stdout: () => {}, stderr: (text) => { err += text; } });
  return err;
}

describe("a refusal's code is printed once (#373)", () => {
  it("a message that is only the code prints the code alone", () => {
    // mutation: remove the dedupe (print `${code}: ${message}` again) -> red here.
    expect(printed("group-edge-dependent-started", "group-edge-dependent-started", "h").split("\n")[0]).toBe("orca: group-edge-dependent-started");
  });

  it("a code:detail message prints code: detail, keeping a detail that itself holds colons (review focus 3)", () => {
    expect(printed("group-state-invalid", "group-state-invalid:answers:missing=q1;extra=q2", "h").split("\n")[0])
      .toBe("orca: group-state-invalid: answers:missing=q1;extra=q2");
  });

  it("a message that is a sentence, not the code, prints as before", () => {
    expect(printed("codex-exit-error", "unexpected status 400: bad", "h").split("\n")[0]).toBe("orca: codex-exit-error: unexpected status 400: bad");
  });

  it("an empty or missing message prints the code alone (fix wave m-3)", () => {
    // mutation: drop the empty-message case -> "orca: no-op-command: ", red here.
    expect(printed("no-op-command", "", "h").split("\n")[0]).toBe("orca: no-op-command");
    expect(printed("no-op-command", undefined, "h").split("\n")[0]).toBe("orca: no-op-command");
  });

  it("a message that only starts with the code's letters (no colon) is not cut", () => {
    expect(printed("no-op", "no-op-command", "h").split("\n")[0]).toBe("orca: no-op: no-op-command");
  });
});

describe("a common refusal with no verb hint says the next step (#373)", () => {
  const CODES = ["group-execution-pending", "stop-mode-conflict", "grant-amendment-unsupported", "requirement-not-split", "group-state-invalid", "no-op-command", "group-archived"];

  it("each of the seven codes has a next line, and an unknown code has none", () => {
    for (const code of CODES) expect(nextForCode(code), code).toEqual(expect.any(String));
    expect(nextForCode("some-other-code")).toBeNull();
  });

  it("is printed after the error line when the verb gives no hint", () => {
    // mutation: drop the nextForCode fallback in printResponse -> red here.
    expect(printed("group-execution-pending", "group-execution-pending")).toBe(`orca: group-execution-pending\norca: ${nextForCode("group-execution-pending")}\n`);
  });

  it("a verb's own hint wins over the table", () => {
    const out = printed("group-state-invalid", "group-state-invalid:round-state", "the round is still drafting");
    expect(out).toBe("orca: group-state-invalid: round-state\norca: the round is still drafting\n");
  });

  // Fix wave I-2/I-3/I-4: facts true for every place that raises the code, not a guess at the one that did.
  it("each text is true for every source of its code (#374d, #368a)", () => {
    // group-execution-pending: a queued start wake, or an active run or task (executionPending.ts).
    expect(nextForCode("group-execution-pending")).toBe("the group's start is already queued or its work is under way; orca group brief <group> shows which");
    // stop-mode-conflict: a pause, a stop or a shutdown, from start, retry, reopen, accept-attempt, continue, settle.
    expect(nextForCode("stop-mode-conflict")).toBe("this command conflicts with the group's pause/stop state; orca group brief <group> shows it");
    // grant-amendment-unsupported: a proposal change after a start, or a funded-allowance policy after a task ran.
    expect(nextForCode("grant-amendment-unsupported")).toBe("the group has started, so its proposal no longer changes");
  });

  it("names the group when the CLI knows it (fix wave m-6)", () => {
    // mutation: ignore the group id -> "<group>" stays, red here.
    // Ruling (2026-11-19 #355 review): an archived group also takes close (a done one converts), so the text says so.
    expect(nextForCode("group-archived", "g-alpha")).toBe("the group is archived and refuses every command but unarchive and close (which converts a done one); orca group unarchive g-alpha first");
    expect(printed("group-archived", "group-archived", undefined, { groupId: "g-alpha" })).toContain("orca group unarchive g-alpha first");
  });

  it("is not printed when the response already names its next commands (fix wave I-4)", () => {
    // mutation: print the table line even with next lines -> red here.
    expect(printed("grant-amendment-unsupported", "grant-amendment-unsupported", undefined, { next: ["orca group set-limit g --limit x"] }))
      .toBe("orca: grant-amendment-unsupported\norca: next: orca group set-limit g --limit x\n");
  });

  it("end to end: orca group start refused as pending prints one code line and the next step, exit 2", async () => {
    const w = await world({}, { "POST groups/g-alpha/start": { status: 409, body: { error: { code: "group-execution-pending", message: "group-execution-pending", retryable: false } } } });
    const out = await cli(["group", "start", "g-alpha"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr.split("\n").slice(0, 2)).toEqual(["orca: group-execution-pending", `orca: ${nextForCode("group-execution-pending", "g-alpha")}`]);
    expect(out.stderr).toContain("orca group brief g-alpha shows which");
  });
});
