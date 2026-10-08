// @vitest-environment jsdom
/**
 * Integration spec §3.1, §3.2, §6.5, §9.1: the integration UI. The repository's default is chosen in Task control and
 * sent with exactly the fields its delivery has; a member reads it and cannot save. The confirm step names the group's
 * scheme in plain words, lets an owner change it before confirming, and binds the confirm to the scheme the owner saw
 * (`integrationHash` = the view's `schemeHash`; a keep group's confirm carries no such key, so its request hash is
 * unchanged). The Git area shows where the integration stands and offers an owner Retry and Resolve; a keep group keeps
 * the "merging into main is the person's" line and gets no button.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { controlCommandPath, sendIntegrationScheme } from "../src/controlApi.js";
import type { ControlAction } from "../src/controlApi.js";
import type {
  ControlSummaryV1, GroupIntegrationViewV1, GroupViewV1, IntegrationSchemeV1, RecoveryViewV1, RepositoryIntegrationV1,
} from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import { RepositoryIntegration, integrationReasonText, integrationSentence } from "../src/IntegrationScheme.js";
import { config, view, workItem } from "./fixtures/board.js";
import { ALPHA, installFakePanel } from "./fixtures/twoProjects.js";

afterEach(cleanup);

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;

const PR_TASK: IntegrationSchemeV1 = { delivery: "github-pr", trigger: "task", target: "main", remote: "origin" };
const HASH = "7".repeat(64);
const repository = (integration: IntegrationSchemeV1, suggestedTarget: string | null = "develop"): RepositoryIntegrationV1 =>
  ({ schema: "orca-repository-integration-v1", repoId: "orca", integration, revision: 4, suggestedTarget });
const record = (over: Partial<GroupIntegrationViewV1> = {}): GroupIntegrationViewV1 => ({
  scheme: PR_TASK, schemeHash: HASH, frozen: false, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null, ...over,
});
/** A group on the confirm step: proposal editable, so the scheme is still the owner's to change. */
const draftGroup = (integration?: GroupIntegrationViewV1): GroupViewV1 => {
  const base = view([workItem({ status: "draft" })]);
  return { ...base, proposal: { ...base.proposal, state: "editable" }, ...(integration === undefined ? {} : { integration }) };
};
const confirmedGroup = (integration?: GroupIntegrationViewV1): GroupViewV1 => ({ ...view([workItem({})]), ...(integration === undefined ? {} : { integration }) });

const field = (region: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement => within(region).getByLabelText(name);
const choose = (region: HTMLElement, name: string, value: string): void => { fireEvent.change(field(region, name), { target: { value } }); };

describe("the repository's integration section (spec §9.1)", () => {
  const show = (integration: RepositoryIntegrationV1, onSave = vi.fn()) => {
    render(<RepositoryIntegration integration={integration} onSave={onSave} />);
    return { onSave, region: screen.getByRole("region", { name: "Integration" }) };
  };

  it("names the current default and, for a repository with none, pre-fills origin and the suggested target", () => {
    const { onSave, region } = show(repository({ delivery: "keep" }));
    expect(region.textContent).toContain("Orca does not merge or push this work; merging into main is the person's.");
    expect(field(region, "Delivery").value).toBe("keep");
    expect(within(region).queryByLabelText("Target branch")).toBeNull();
    choose(region, "Delivery", "push-branch");
    expect(within(region).queryByLabelText("Method")).toBeNull();
    expect(field(region, "Remote").value).toBe("origin");
    expect(field(region, "Target branch").value).toBe("develop");
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(onSave.mock.calls).toEqual([[{ delivery: "push-branch", trigger: "task", target: "develop", remote: "origin" }, 4]]);
  });

  it("sends a local scheme without a remote, and with the method chosen", () => {
    const { onSave, region } = show(repository({ delivery: "keep" }));
    choose(region, "Delivery", "local");
    expect(within(region).queryByLabelText("Remote")).toBeNull();
    choose(region, "Method", "squash");
    choose(region, "When", "group");
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(onSave.mock.calls).toEqual([[{ delivery: "local", trigger: "group", method: "squash", target: "develop" }, 4]]);
  });

  it("sends a github-pr scheme without a method, and push-target with both method and remote", () => {
    const { onSave, region } = show(repository({ delivery: "keep" }));
    choose(region, "Delivery", "github-pr");
    expect(within(region).queryByLabelText("Method")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    choose(region, "Delivery", "push-target");
    fireEvent.change(field(region, "Remote"), { target: { value: "upstream" } });
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(onSave.mock.calls).toEqual([
      [{ delivery: "github-pr", trigger: "task", target: "develop", remote: "origin" }, 4],
      [{ delivery: "push-target", trigger: "task", method: "merge", target: "develop", remote: "upstream" }, 4],
    ]);
  });

  it("starts from the stored scheme, not the suggestion, and sends keep as the delivery alone", () => {
    const { onSave, region } = show(repository({ delivery: "push-target", trigger: "group", method: "squash", target: "release", remote: "upstream" }));
    expect([field(region, "Delivery").value, field(region, "When").value, field(region, "Method").value, field(region, "Target branch").value, field(region, "Remote").value])
      .toEqual(["push-target", "group", "squash", "release", "upstream"]);
    choose(region, "Delivery", "keep");
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(onSave.mock.calls).toEqual([[{ delivery: "keep" }, 4]]);
  });

  it("offers no Save while a delivery other than keep has no target (no suggestion and none typed)", () => {
    const { onSave, region } = show(repository({ delivery: "keep" }, null));
    choose(region, "Delivery", "local");
    expect(field(region, "Target branch").value).toBe("");
    const save = within(region).getByRole("button", { name: "Save integration" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field(region, "Target branch"), { target: { value: "main" } });
    expect(save.disabled).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("is read-only for a member: the default in words, no field and no Save", () => {
    render(as(member, <RepositoryIntegration integration={repository(PR_TASK)} onSave={vi.fn()} />));
    const region = screen.getByRole("region", { name: "Integration" });
    expect(region.textContent).toContain("After each task: push orca/[group] to origin and keep one draft GitHub PR into main up to date");
    expect(region.textContent).toContain("Only an owner can change the integration.");
    expect(within(region).queryAllByRole("button")).toEqual([]);
    expect(within(region).queryAllByRole("combobox")).toEqual([]);
  });

  it("is placed in Task control beside the workspace mode, and its Save reaches the panel's handler", () => {
    const groupView = confirmedGroup();
    const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [groupView.summary] };
    const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
    const onIntegrationScheme = vi.fn();
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null}
      refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} integration={repository({ delivery: "keep" })} onIntegrationScheme={onIntegrationScheme} />);
    const region = screen.getByRole("region", { name: "Integration" });
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(onIntegrationScheme.mock.calls).toEqual([[{ delivery: "keep" }, 4]]);
  });
});

describe("the scheme on the confirm step (spec §3.2, §9.1)", () => {
  const confirm = (groupView: GroupViewV1, me: Me = owner) => {
    const onCommand = vi.fn();
    render(as(me, <BudgetEditor view={groupView} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} selectionsHash={"9".repeat(64)} suggestedTarget="develop" />));
    return onCommand;
  };
  const sent = (onCommand: ReturnType<typeof vi.fn>): ControlAction[] => onCommand.mock.calls.map((call) => call[0] as ControlAction);

  it("says the group's scheme in plain words and confirms with the view's schemeHash as integrationHash", () => {
    const onCommand = confirm(draftGroup(record()));
    const region = screen.getByRole("region", { name: "Integration of this group" });
    expect(region.textContent).toContain("After each task: push orca/g to origin and keep one draft GitHub PR into main up to date");
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    const [action] = sent(onCommand);
    expect(action).toMatchObject({ verb: "confirm", payload: { integrationHash: HASH, selectionsHash: "9".repeat(64) } });
  });

  it("confirms a keep group with no integrationHash key at all", () => {
    const onCommand = confirm(draftGroup());
    expect(screen.getByRole("region", { name: "Integration of this group" }).textContent).toContain("merging into main is the person's");
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    const [action] = sent(onCommand);
    expect(action?.verb).toBe("confirm");
    expect(Object.hasOwn(action!.payload, "integrationHash")).toBe(false);
  });

  it("lets an owner change the scheme before confirming, under the group's revision", () => {
    const onCommand = confirm(draftGroup());
    const region = screen.getByRole("region", { name: "Integration of this group" });
    choose(region, "Delivery", "local");
    expect(field(region, "Target branch").value).toBe("develop");
    fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
    expect(sent(onCommand)).toEqual([{ verb: "set-group-integration", groupId: "g", expectedRevision: 6, payload: { integration: { delivery: "local", trigger: "task", method: "merge", target: "develop" } } }]);
  });

  it("offers no change once the proposal is confirmed", () => {
    confirm(confirmedGroup(record({ frozen: true })));
    expect(screen.queryByRole("region", { name: "Integration of this group" })).toBeNull();
  });

  it("tells a member why they cannot confirm a group Orca merges or pushes, and sends nothing", () => {
    const onCommand = confirm(draftGroup(record()), member);
    const region = screen.getByRole("region", { name: "Integration of this group" });
    expect(within(region).queryAllByRole("button")).toEqual([]);
    expect(screen.getByText("Only an owner can confirm a group whose work Orca merges or pushes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("lets a member confirm a keep group as before", () => {
    const onCommand = confirm(draftGroup(), member);
    expect(screen.queryByText("Only an owner can confirm a group whose work Orca merges or pushes.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(sent(onCommand).map((action) => action.verb)).toEqual(["confirm"]);
  });
});

describe("the page around the integration UI (spec §9.1)", () => {
  it("suggests the open group's own repository target on its confirm step", () => {
    render(<ControlGroupView view={draftGroup()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}
      integrationFor={(repoId) => (repoId === "orca" ? repository({ delivery: "keep" }, "trunk-z") : null)} />);
    const region = screen.getByRole("region", { name: "Integration of this group" });
    choose(region, "Delivery", "local");
    expect(field(region, "Target branch").value).toBe("trunk-z");
  });

  it("reads the chosen project's default, saves an owner's change under its revision, and reads it back", async () => {
    const realFetch = globalThis.fetch;
    const panel = installFakePanel();
    const fake = globalThis.fetch;
    const route = `/api/control/repositories/${ALPHA}/integration`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) === route && (init?.method ?? "GET") === "GET") {
        panel.requests.push(`GET ${route}`);
        return new Response(JSON.stringify({ ...repository({ delivery: "keep" }, "trunk-a"), repoId: ALPHA, revision: 2 }), { status: 200 });
      }
      return fake(input, init);
    }) as typeof fetch;
    try {
      render(<App />);
      const region = await screen.findByRole("region", { name: "Integration" });
      choose(region, "Delivery", "push-branch");
      fireEvent.click(within(region).getByRole("button", { name: "Save integration" }));
      await waitFor(() => expect(panel.posts.map((post) => post.url)).toEqual([route]));
      expect(panel.posts[0]!.body).toEqual({ commandId: expect.any(String), expectedRevision: 2, payload: { integration: { delivery: "push-branch", trigger: "task", target: "trunk-a", remote: "origin" } } });
      await waitFor(() => expect(panel.requests.filter((request) => request === `GET ${route}`)).toHaveLength(2));
    } finally {
      cleanup();
      window.localStorage.clear();
      globalThis.fetch = realFetch;
    }
  });
});

describe("the group's Git area (spec §6.5, §9.1)", () => {
  const show = (groupView: GroupViewV1, me: Me = owner) => {
    const onCommand = vi.fn();
    render(as(me, <ControlGroupView view={groupView} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />));
    return { onCommand, section: screen.getByRole("region", { name: "Git" }) };
  };

  it("shows the state, the reason in words with git's own after the colon, the commits and the PR link", () => {
    const { section } = show(confirmedGroup(record({
      frozen: true, state: "blocked", reason: "integration-push-refused:! [remote rejected] main (protected branch)",
      lastIntegrated: "1".repeat(40), integratedCommit: "2".repeat(40), pr: { url: "https://github.com/o/r/pull/12", number: 12, ready: false },
    })));
    const text = section.textContent ?? "";
    expect(text).toContain("After each task: push orca/g to origin and keep one draft GitHub PR into main up to date");
    expect(text).toContain("Integration: blocked");
    expect(text).toContain("Why: the push was refused: ! [remote rejected] main (protected branch)");
    expect(text).toContain("Last integrated work commit: 111111111111");
    expect(text).toContain("Target set to: 222222222222");
    expect(text).toContain("Approved when the group was confirmed");
    const link = within(section).getByRole("link", { name: "Pull request #12 (draft)" }) as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/o/r/pull/12");
    expect(text).not.toContain("Merge into main: waiting on a person");
    expect(text).not.toContain("Push: waiting on a person");
  });

  it("sends retry-integration for a blocked integration, and offers no Resolve there", () => {
    const { onCommand, section } = show(confirmedGroup(record({ frozen: true, state: "blocked", reason: "integration-target-missing" })));
    expect(within(section).queryByRole("button", { name: "Resolve with an agent" })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Retry integration" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "retry-integration", groupId: "g", expectedRevision: 6, payload: {} }]]);
  });

  it("sends resolve-integration-conflict for a conflict", () => {
    const { onCommand, section } = show(confirmedGroup(record({ frozen: true, state: "conflict", reason: "integration-conflict" })));
    expect(section.textContent).toContain("merging the work into the target conflicts");
    fireEvent.click(within(section).getByRole("button", { name: "Resolve with an agent" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "resolve-integration-conflict", groupId: "g", expectedRevision: 6, payload: {} }]]);
  });

  it("offers neither button while the integration is idle or an agent is resolving", () => {
    show(confirmedGroup(record({ frozen: true, state: "idle" })));
    expect(within(screen.getByRole("region", { name: "Git" })).queryAllByRole("button")).toEqual([]);
    cleanup();
    show(confirmedGroup(record({ frozen: true, state: "resolving" })));
    expect(within(screen.getByRole("region", { name: "Git" })).queryAllByRole("button")).toEqual([]);
  });

  it("gives a member the facts but neither button", () => {
    const { section } = show(confirmedGroup(record({ frozen: true, state: "conflict", reason: "integration-conflict" })), member);
    expect(section.textContent).toContain("Integration: merge conflict");
    expect(within(section).queryAllByRole("button")).toEqual([]);
  });

  it("keeps the person's merge and push lines for a keep group, with no button", () => {
    const { section } = show(confirmedGroup());
    expect(section.textContent).toContain("Merge into main: waiting on a person");
    expect(section.textContent).toContain("Push: waiting on a person");
    expect(within(section).queryAllByRole("button")).toEqual([]);
  });
});

describe("plain words for every delivery and trigger, in both languages (spec §9.1)", () => {
  const schemes: IntegrationSchemeV1[] = [
    { delivery: "keep" },
    ...(["task", "group"] as const).flatMap((trigger): IntegrationSchemeV1[] => [
      { delivery: "local", trigger, method: "merge", target: "main" },
      { delivery: "local", trigger, method: "squash", target: "main" },
      { delivery: "push-target", trigger, method: "merge", target: "main", remote: "origin" },
      { delivery: "push-target", trigger, method: "squash", target: "main", remote: "origin" },
      { delivery: "push-branch", trigger, target: "main", remote: "origin" },
      { delivery: "github-pr", trigger, target: "main", remote: "origin" },
    ]),
  ];

  it("says each one differently, naming the branch, the target and the remote", async () => {
    for (const lang of ["en", "zh"]) {
      await i18n.changeLanguage(lang);
      const said = schemes.map((scheme) => integrationSentence(scheme, "g"));
      expect(new Set(said).size, lang).toBe(schemes.length);
      for (const [index, scheme] of schemes.entries()) {
        if (scheme.delivery === "keep") continue;
        expect(said[index], `${lang} ${JSON.stringify(scheme)}`).toContain("orca/g");
        expect(said[index]).toContain("main");
        if ("remote" in scheme) expect(said[index]).toContain("origin");
      }
    }
  });

  it("matches the spec's own example in English and says it in Chinese", async () => {
    expect(integrationSentence(PR_TASK, "g")).toBe("After each task: push orca/g to origin and keep one draft GitHub PR into main up to date; it is marked ready when the group completes.");
    expect(integrationSentence({ ...PR_TASK, trigger: "group" }, "g")).toBe("When the group completes: push orca/g to origin and open one GitHub PR into main.");
    await i18n.changeLanguage("zh");
    expect(integrationSentence(PR_TASK, "g")).toBe("每个任务完成后：把 orca/g 推送到 origin，并维护一个合并进 main 的 GitHub 草稿 PR；整组完成时标为可审阅。");
  });
});

describe("integration reasons in words (spec §6.5)", () => {
  it("names each blocking code, keeps git's words after the colon, and shows an unknown code as sent", async () => {
    expect(integrationReasonText("integration-target-missing")).toBe("the target branch does not exist");
    expect(integrationReasonText("integration-push-refused:remote: permission denied")).toBe("the push was refused: remote: permission denied");
    expect(integrationReasonText("integration-something-new:x")).toBe("integration-something-new:x");
    await i18n.changeLanguage("zh");
    expect(integrationReasonText("integration-push-refused:remote: permission denied")).toBe("推送被拒绝：remote: permission denied");
    expect(integrationReasonText("integration-target-missing")).toBe("目标分支不存在");
  });

  it("has words for every code the integration pass and the resolution write", () => {
    for (const code of [
      "integration-target-missing", "integration-remote-missing", "integration-gh-unavailable", "integration-target-moved", "integration-push-refused",
      "integration-work-branch-diverged", "integration-pr-closed", "integration-pr-refused", "integration-conflict", "integration-conflict-unreproducible",
      "integration-worktree-dirty", "integration-not-fast-forward", "integration-markers-remaining", "integration-resolution-terminal",
      "integration-resolution-spawn", "reconcile-budget", "reconcile-agent-unfrozen",
    ]) expect(integrationReasonText(code), code).not.toBe(code);
  });
});

describe("the integration routes (spec §3.4)", () => {
  it("serves the group verbs on their own routes", () => {
    expect(controlCommandPath({ verb: "set-group-integration", groupId: "g/1", expectedRevision: 1, payload: { integration: { delivery: "keep" } } })).toBe("/api/control/groups/g%2F1/integration");
    expect(controlCommandPath({ verb: "retry-integration", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/integration/retry");
    expect(controlCommandPath({ verb: "resolve-integration-conflict", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/integration/resolve");
  });

  it("posts the repository's scheme as { integration } under the read revision", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendIntegrationScheme("orca", { delivery: "keep" }, 4, "cmd-1");
      const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(path).toBe("/api/control/repositories/orca/integration");
      expect(JSON.parse(String(init.body))).toEqual({ commandId: "cmd-1", expectedRevision: 4, payload: { integration: { delivery: "keep" } } });
    } finally { vi.unstubAllGlobals(); }
  });
});
