// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentSettings } from "../src/AgentSettings.js";
import { defaultAgentField } from "./agentFieldControl.js";
import { optionsOf } from "./selectControl.js";
import type { AgentInstallationStateV1, AgentsViewV1, AgentPreferencesViewV1 } from "../src/controlTypes.js";

afterEach(cleanup);

it("shows OMP as a selectable installation and explains an unavailable OMP update", async () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the OMP installation is offered (enabled) by the default-agent picker
  const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
    { id: "omp-local", kind: "omp", version: "1.0", defaults: { model: "local-proxy/machine-specific", contextWindow: "agent-default" }, contextOptions: ["agent-default"] },
  ] };
  const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { perAgent: {} } };
  const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, observation: null, failureCode: null,
    preview: { schema: "orca-agent-detection-preview-v1", previewId: "preview-omp", baseTableHash: "a".repeat(64), observedAt: "2026-10-12T00:00:00.000Z", installed: [], changes: [
      { changeId: "omp-add", kind: "addition", installationId: "omp", command: ["/tmp/omp"], realpath: "/tmp/omp", version: "1.0", unavailableReason: "omp-default-model-unresolved" },
    ] } };
  const onSave = vi.fn();
  render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={onSave} installationState={state} />);
  expect(await optionsOf(defaultAgentField(document.body))).toContainEqual(["omp-local", false]);
  expect((screen.getByLabelText(/New installation: omp/) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("omp-default-model-unresolved");
  fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("selects a reviewable OMP addition without substituting the machine's model", () => {
  const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [] };
  const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { perAgent: {} } };
  const installation = { kind: "omp", command: ["/tmp/omp"], version: "1.0", defaults: { model: "proxy/other-machine-model", contextWindow: "agent-default" } };
  const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, observation: null, failureCode: null,
    preview: { schema: "orca-agent-detection-preview-v1", previewId: "preview-omp", baseTableHash: "a".repeat(64), observedAt: "2026-10-12T00:00:00.000Z", installed: [], changes: [
      { changeId: "omp-add", kind: "addition", installationId: "omp", command: ["/tmp/omp"], realpath: "/tmp/omp", version: "1.0", installation },
    ] } };
  const onApplyUpdates = vi.fn();
  const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} onApplyUpdates={onApplyUpdates} />);
  expect(container.textContent).toContain("proxy/other-machine-model");
  const checkbox = screen.getByLabelText(/New installation: omp/) as HTMLInputElement;
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Apply selected changes" }));
  expect(onApplyUpdates).toHaveBeenCalledWith(["omp-add"]);
});

it("does not let an operator select an OMP version update that lost its frozen model", () => {
  const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
    { id: "omp", kind: "omp", version: "1.0", defaults: { model: "proxy/old-model", contextWindow: "agent-default" }, contextOptions: ["agent-default"] },
  ] };
  const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { defaultAgent: "omp", perAgent: {} } };
  const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, observation: null, failureCode: null,
    preview: { schema: "orca-agent-detection-preview-v1", previewId: "preview-version", baseTableHash: "a".repeat(64), observedAt: "2026-10-12T00:00:00.000Z", installed: [], changes: [
      { changeId: "omp-version", kind: "version", installationId: "omp", command: ["/tmp/omp"], realpath: "/tmp/omp", version: "2.0", unavailableReason: "omp-frozen-model-unavailable" },
    ] } };
  render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
  expect((screen.getByLabelText(/Version: omp/) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("This update cannot be selected");
  expect(screen.getByRole("alert").textContent).toContain("omp-frozen-model-unavailable");
  expect((screen.getByRole("button", { name: "Apply selected changes" }) as HTMLButtonElement).disabled).toBe(true);
});
