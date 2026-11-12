// @vitest-environment jsdom
/**
 * Handoff §4.0 item 5 (seat G1, 2026-11-12): "every action can be done in the Web UI". Two first-use dead ends:
 * with no agent installed the only way out was `orca agent init`, and a panel started with --repo cannot add a project.
 * The first is now an owner's detection on the Agents page (the server seeds the table; tests/panel/agentsFirstUse.test.ts);
 * the second stays fixed at launch by ruling (registry spec §4, P1), so the Web says how to get a panel that adds projects.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings } from "../src/AgentSettings.js";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { ProjectControl } from "../src/ProjectControl.js";
import type { AgentInstallationStateV1, AgentPreferencesViewV1, AgentsViewV1 } from "../src/controlTypes.js";
import type { ProjectsAnswerV1 } from "../src/project.js";
import "../src/i18n.js";

afterEach(cleanup);

describe("no agent installed: the owner installs one on the Agents page", () => {
  const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { perAgent: {} } };
  const owned: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, observation: null, failureCode: null, preview: null };
  const empty: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [] };
  const one: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
    { id: "codex", kind: "codex", version: "1.0", defaults: { model: "gpt-x", contextWindow: "agent-default" }, contextOptions: ["agent-default"] },
  ] };
  const settings = (agents: AgentsViewV1, installationState?: AgentInstallationStateV1): void => {
    render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} onDetectUpdates={vi.fn()}
      {...(installationState === undefined ? {} : { installationState })} />);
  };

  // mutation: drop the first-use note -> the owner is not told to detect here -> red
  it("tells the owner to detect and apply here, and shows the Detect button", () => {
    settings(empty, owned);
    expect(screen.getByTestId("agents-first-use").textContent).toBe("No agent is installed yet. Detect again finds the agents on this machine; select one new installation per agent and apply. No restart is needed.");
    expect(screen.getByRole("button", { name: "Detect again" })).toBeTruthy();
  });

  // mutation: show the note whenever the detection section is there -> the owner with an agent sees it -> red
  it("says nothing of it once an agent is installed, nor to a member (who has no detection section)", () => {
    settings(one, owned);
    expect(screen.queryByTestId("agents-first-use")).toBeNull();
    cleanup();
    settings(empty);
    expect(screen.queryByTestId("agents-first-use")).toBeNull();
    expect(screen.queryByRole("button", { name: "Detect again" })).toBeNull();
  });
});

describe("a --repo panel says how to get one that adds projects", () => {
  const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
  const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
  const commandLine: ProjectsAnswerV1 = { source: "command-line", editable: false, pendingRestart: [], fileError: null,
    projects: [{ projectKey: "orca", name: "orca", path: "/r/orca", controlRepoId: "orca-22222222" }] };
  const control = (me: Me, answer: ProjectsAnswerV1): void => {
    render(<AccountContext.Provider value={me}>{(<ProjectControl answer={answer} project="orca" onProject={vi.fn()} onAdd={vi.fn()} onRename={vi.fn()} onAddMulti={vi.fn()} onSetDirs={vi.fn()} />) as JSX.Element}</AccountContext.Provider>);
  };

  // mutation: drop the how-to -> the owner is only told to restart, not how to keep the store -> red
  it("gives the owner the steps and a projects.json that keeps these projects and this panel's store", () => {
    control(owner, commandLine);
    const howTo = screen.getByTestId("project-file-mode-howto");
    expect(howTo.querySelector("summary")!.textContent).toBe("How to get a panel that adds projects here");
    expect(howTo.textContent).toContain("by default ~/.orca/control/orca-22222222");
    expect(howTo.textContent).toContain("orca panel install again without --repo");
    expect(JSON.parse(howTo.querySelector("pre")!.textContent!)).toEqual({ version: 1, controlStateDir: "<absolute path of this panel's control store>",
      projects: [{ id: "orca", name: "orca", path: "/r/orca" }] });
  });

  // mutation: show it in file mode too -> a panel that already adds projects is told to change -> red
  it("is not shown in file mode, nor to a member", () => {
    control(owner, { ...commandLine, source: "file", editable: true });
    expect(screen.queryByTestId("project-file-mode-howto")).toBeNull();
    cleanup();
    control(member, commandLine);
    expect(screen.queryByTestId("project-file-mode-howto")).toBeNull();
  });
});
