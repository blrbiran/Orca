// @vitest-environment jsdom
/**
 * Working-tree delivery spec 2026-11-19 §4.2 item 1-2, §4.6, §10.1 (#365): a done group kept on its branch in a project
 * nobody chose a delivery for asks, on its Results, where finished files should go. "Put them in my working tree" sends
 * set-integration-scheme for the project, then set-group-integration for this group, in that order; the first answering
 * no-op-command (a second tab chose already) still sends the second; a failing second leaves one per-group button and
 * the error words. "Keep them on the branch" stores keep for the project only. The conclusion card says where a
 * working-tree group's files are (pending / waiting / written / not written yet / blocked), and Project settings read
 * "not chosen yet" for a never-chosen project.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RepositoryIntegration } from "../src/IntegrationScheme.js";
import i18n from "../src/i18n.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupIntegrationViewV1, GroupViewV1, IntegrationSchemeV1, RepositoryIntegrationV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(() => { cleanup(); void i18n.changeLanguage("en"); });

const TIP = "abcdef0123456789abcdef0123456789abcdef01";
const WT: IntegrationSchemeV1 = { delivery: "working-tree" };
const record = (over: Partial<GroupIntegrationViewV1> = {}): GroupIntegrationViewV1 => ({
  scheme: WT, schemeHash: "s".repeat(64), frozen: true, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null, ...over,
});
const done = (over: Partial<GroupViewV1> = {}): GroupViewV1 => {
  const value = { ...view([workItem({ taskId: "a", status: "completed" })]), ...over };
  value.summary.state = "done"; value.summary.completion = { done: 1, total: 1 };
  value.summary.acceptance = { tip: TIP, result: "passed", commands: [], at: 1 };
  return value;
};
const repository = (over: Partial<RepositoryIntegrationV1> = {}): RepositoryIntegrationV1 => ({
  schema: "orca-repository-integration-v1", repoId: "orca", integration: { delivery: "keep" }, revision: 3, suggestedTarget: "main", chosen: false, ...over,
});

type Sent = Array<{ kind: "project"; scheme: IntegrationSchemeV1; revision: number } | { kind: "group"; action: ControlAction }>;
function show(value: GroupViewV1, answers: { project?: Array<string | null>; group?: Array<number | null> } = {}, extra: { archived?: boolean } = {}) {
  const sent: Sent = [];
  const project = [...(answers.project ?? [null])], group = [...(answers.group ?? [9])];
  const onProjectDelivery = vi.fn(async (_repoId: string, scheme: IntegrationSchemeV1, revision: number) => { sent.push({ kind: "project", scheme, revision }); return project.shift() ?? null; });
  const onCommand = vi.fn(async (action: ControlAction) => { sent.push({ kind: "group", action }); return group.length === 0 ? 9 : group.shift()!; });
  if (extra.archived === true) value.summary.archived = true;
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={value} config={config} uncertain={[]} drafts={{}}
    onDraft={vi.fn()} onCommand={onCommand} integrationFor={() => repository()} onProjectDelivery={onProjectDelivery} />);
  return { sent, onProjectDelivery, onCommand };
}
const question = () => screen.queryByRole("region", { name: "Where should finished files go for this project?" });
const alertText = () => within(question()!).getByRole("alert").textContent;
const groupWorkingTree = { verb: "set-group-integration", groupId: "g", expectedRevision: 7, payload: { integration: WT } };

describe("the first-use question on Results (spec §4.2 item 1)", () => {
  it("is asked only for a done keep group whose view says the project's delivery was never chosen", () => {
    show(done({ projectDeliveryChosen: false }));
    // mutation: drop the question from the Results region -> red
    expect(question()).not.toBeNull();
    cleanup();
    // An older panel (absent field) or a chosen project: no question.
    show(done());
    expect(question()).toBeNull();
    cleanup();
    const running = done({ projectDeliveryChosen: false }); running.summary.state = "running";
    show(running);
    // mutation: drop the done condition -> red
    expect(question()).toBeNull();
    cleanup();
    show(done({ projectDeliveryChosen: false, integration: record() }));
    // mutation: drop the keep condition -> red
    expect(question()).toBeNull();
    cleanup();
    show(done({ projectDeliveryChosen: false }), {}, { archived: true });
    // An archived group sends nothing (archiveGroup.test.tsx): no question there either.
    expect(question()).toBeNull();
  });

  it("'Put them in my working tree' sends the project's scheme, then this group's, in that order", async () => {
    const value = done({ projectDeliveryChosen: false }); value.summary.commandRevision = 7;
    const { sent } = show(value);
    fireEvent.click(screen.getByRole("button", { name: "Put them in my working tree" }));
    // mutation: swap the two commands -> red
    await waitFor(() => expect(sent).toEqual([{ kind: "project", scheme: WT, revision: 3 }, { kind: "group", action: groupWorkingTree }]));
  });

  it("a no-op-command answer to the first still sends the second", async () => {
    const value = done({ projectDeliveryChosen: false }); value.summary.commandRevision = 7;
    const { sent } = show(value, { project: ["no-op-command"] });
    fireEvent.click(screen.getByRole("button", { name: "Put them in my working tree" }));
    // mutation: stop after a no-op first -> red
    await waitFor(() => expect(sent).toEqual([{ kind: "project", scheme: WT, revision: 3 }, { kind: "group", action: groupWorkingTree }]));
  });

  it("a refused first sends nothing more and says why", async () => {
    const { sent } = show(done({ projectDeliveryChosen: false }), { project: ["revision-conflict"] });
    fireEvent.click(screen.getByRole("button", { name: "Put them in my working tree" }));
    await waitFor(() => expect(alertText()).toContain("revision-conflict"));
    expect(sent).toHaveLength(1);
  });

  it("a failing second leaves the single per-group button and the error words; that button sends only this group's", async () => {
    const value = done({ projectDeliveryChosen: false }); value.summary.commandRevision = 7;
    const { sent } = show(value, { group: [null, 9] });
    fireEvent.click(screen.getByRole("button", { name: "Put them in my working tree" }));
    const retry = await screen.findByRole("button", { name: "Put this group's files in my working tree" });
    // mutation: treat a failed second as success -> no button, red
    expect(alertText()).toBe("The project now writes finished files into your working tree, but this group's delivery was not changed (the reason is shown at the top of this group).");
    expect(screen.queryByRole("button", { name: "Keep them on the branch" })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toEqual({ kind: "group", action: groupWorkingTree });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Put this group's files in my working tree" })).toBeNull());
  });

  it("'Keep them on the branch' stores keep for the project and sends nothing for the group", async () => {
    const { sent } = show(done({ projectDeliveryChosen: false }));
    fireEvent.click(screen.getByRole("button", { name: "Keep them on the branch" }));
    // mutation: send set-group-integration keep too -> red
    await waitFor(() => expect(sent).toEqual([{ kind: "project", scheme: { delivery: "keep" }, revision: 3 }]));
  });

  it("is in Chinese under zh", async () => {
    await i18n.changeLanguage("zh");
    show(done({ projectDeliveryChosen: false }));
    // mutation: put back an English literal -> red
    expect(screen.getByRole("region", { name: "这个项目完成的文件放到哪里？" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "放进我的工作区" })).not.toBeNull();
  });
});

describe("the conclusion card's working-tree row (spec §4.6)", () => {
  const row = () => screen.getByRole("region", { name: "Conclusion" }).querySelector('[data-conclusion="working-tree"]')?.textContent ?? null;
  it("says pending, waiting, written, not written yet and blocked from the record", () => {
    const running = done({ integration: record() }); running.summary.state = "running";
    show(running);
    expect(row()).toBe("Will be written into your working tree, uncommitted, once the group is accepted.");
    cleanup();
    show(done({ integration: record({ waitingFor: "g-pre" }) }));
    // mutation: drop the waitingFor branch -> red
    expect(row()).toBe("Waiting for g-pre to be written into your working tree first.");
    cleanup();
    show(done({ integration: record({ lastIntegrated: TIP }) }));
    expect(row()).toBe("Written into your working tree, not committed (tip abcdef012345), including Orca's decision records under .decisions/. Review: git status · the same files: git diff --name-only HEAD...orca/g");
    cleanup();
    show(done({ integration: record({ lastIntegrated: "b".repeat(40) }) }));
    // mutation: drop the lastIntegrated == tip comparison -> an older write reads as written, red
    expect(row()).toBe("Not written yet; a driver round writes it into your working tree.");
    cleanup();
    show(done({ integration: record({ state: "blocked", reason: "integration-working-tree-busy:merge" }) }));
    expect(row()).toBe("Not written into your working tree: a git operation is in progress in your working tree (merge); finish or abort it, then Retry");
    cleanup();
    show(done());
    expect(row()).toBeNull();
  });
});

describe("Project settings (spec §4.2 item 2)", () => {
  it("reads 'not chosen yet' for a never-chosen project, and not once chosen or from an older panel", () => {
    render(<RepositoryIntegration integration={repository()} onSave={vi.fn()} />);
    // mutation: ignore `chosen` -> red
    expect(screen.getByText(/^Not chosen yet/).textContent).toBe("Not chosen yet: groups keep their files on orca/<group> until a person chooses.");
    cleanup();
    render(<RepositoryIntegration integration={repository({ chosen: true })} onSave={vi.fn()} />);
    expect(screen.queryByText(/Not chosen yet/)).toBeNull();
    cleanup();
    const { chosen: _older, ...older } = repository();
    render(<RepositoryIntegration integration={older} onSave={vi.fn()} />);
    expect(screen.queryByText(/Not chosen yet/)).toBeNull();
  });
});
