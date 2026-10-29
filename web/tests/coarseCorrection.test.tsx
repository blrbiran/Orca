// @vitest-environment jsdom
/**
 * Flow engine spec §13.2–§13.3 (W-COR): "Correct…" records a correction from a repository and one sentence, and
 * "Correct" beside a finished run records one on that run. Why: the person usually cannot say which decision was wrong
 * (H30), so the form asks for nothing else; `kind` starts as `wrong`, and `not_my_taste` still needs the alternative
 * (the corrections schema refuses it without one, so the form must not send it).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoarseCorrectionForm, CorrectRunButton, coarseRecordAction } from "../src/CoarseCorrection.js";
import type { CorrectionListItemV1 } from "../src/controlTypes.js";
import { CorrectionsView } from "../src/CorrectionsView.js";
import "../src/i18n.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { run, view, workItem } from "./fixtures/board.js";
import { optionsOf, pickOption } from "./selectControl.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubFetch(): Array<{ url: string; body: any }> {
  const sent: Array<{ url: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ result: { kind: "correction-recorded", correctionId: "c_0123456789abcdef" } }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return sent;
}

describe("coarse corrections in the Web (flow spec §13.2, §13.3)", () => {
  it("C1: the action names the repository, the run only when given, and leaves an empty alternative out", () => {
    expect(coarseRecordAction({ repoId: "r", because: " totals lost ", kind: "wrong", choseInstead: " " })).toEqual({
      verb: "correction-record", groupId: "@corrections", expectedRevision: 0, payload: { repoId: "r", kind: "wrong", because: "totals lost" },
    });
    expect(coarseRecordAction({ repoId: "r", runId: "run-1", because: "x", kind: "not_my_taste", choseInstead: "y" }).payload)
      .toEqual({ repoId: "r", runId: "run-1", kind: "not_my_taste", because: "x", chose_instead: "y" });
  });

  it("C2: Correct… sends the sentence for the chosen repository, kind preset to wrong", async () => {
    const sent = stubFetch();
    render(<CoarseCorrectionForm repositories={[{ repoId: "a-1", name: "A" }, { repoId: "b-2", name: "B" }]} onCancel={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "Record correction" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the repository picked is the repoId the correction is sent for
    await pickOption(screen.getByLabelText("Project"), "B");
    fireEvent.change(screen.getByLabelText("One sentence: what is wrong"), { target: { value: "the totals are gone" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("c_0123456789abcdef"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/control/corrections");
    expect(sent[0]!.body.payload).toEqual({ repoId: "b-2", kind: "wrong", because: "the totals are gone" });
  });

  it("C3: not_my_taste keeps the form closed until the alternative is given", async () => {
    stubFetch();
    render(<CoarseCorrectionForm repositories={[{ repoId: "a-1", name: "A" }]} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("One sentence: what is wrong"), { target: { value: "x" } });
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): picking not_my_taste asks for the alternative before the form can be sent
    await pickOption(screen.getByLabelText("Kind"), "not_my_taste");
    const submit = screen.getByRole("button", { name: "Record correction" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What should have been done instead"), { target: { value: "y" } });
    expect(submit.disabled).toBe(false);
  });

  it("C4: Correct beside a run sends that run of the group's repository", async () => {
    const sent = stubFetch();
    render(<CorrectRunButton repoId="repo-1" runId="run-7" />);
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    expect(screen.queryByLabelText("Project")).toBeNull();
    fireEvent.change(screen.getByLabelText("One sentence: what is wrong"), { target: { value: "it skipped the dates" } });
    fireEvent.click(screen.getByRole("button", { name: "Record correction" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body.payload).toEqual({ repoId: "repo-1", runId: "run-7", kind: "wrong", because: "it skipped the dates" });
  });

  it("C5: the corrections list names a bare-run and a repository-only target, and Correct… offers the held projects", async () => {
    const item = (id: string, over: Record<string, unknown>): CorrectionListItemV1 => ({
      correction: { id, projectKey: "github.com/o/r", kind: "wrong", because: `because ${id}`, at: "2026-10-22T00:00:00.000Z", by: "amy", ...over } as CorrectionListItemV1["correction"],
      repoId: "repo", debugGroups: [], closed: { state: "open" }, closing: null, withdrawn: null,
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url === "/api/projects"
        ? { projects: [{ projectKey: "o", name: "O", controlRepoId: "o-1" }, { projectKey: "loose", controlRepoId: null }] }
        : { schema: "orca-correction-list-v1", corrections: [item("c_00000000000000a1", { runId: "run-9" }), item("c_00000000000000b2", {})] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(<CorrectionsView active />);
    await waitFor(() => expect(document.querySelector('[data-correction-id="c_00000000000000b2"]')).not.toBeNull());
    expect(document.querySelector('[data-correction-id="c_00000000000000a1"]')!.textContent).toContain("On run run-9 as a whole");
    expect(document.querySelector('[data-correction-id="c_00000000000000b2"]')!.textContent).toContain("On repository github.com/o/r (no decision named)");
    fireEvent.click(screen.getByRole("button", { name: "Correct…" }));
    await waitFor(() => expect(screen.getByLabelText("Project")).toBeTruthy());
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): only the project with a control repository is offered
    expect(await optionsOf(screen.getByLabelText("Project"))).toEqual([["O", false]]);
  });

  it("C6: Correct is offered beside a run that finished, and not beside one that failed", () => {
    const item = workItem({});
    const runs = [run({ runId: "run-ok", taskId: item.taskId, state: "landed", outcome: "succeeded" } as never), run({ runId: "run-bad", taskId: item.taskId, state: "settled-failed", outcome: "failed" } as never)];
    render(<TaskDetail view={view([item], runs)} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const correct = screen.getAllByRole("button", { name: "Correct" });
    expect(correct).toHaveLength(1);
    expect(correct[0]!.closest("li")!.textContent).toContain("run-ok");
  });
});
