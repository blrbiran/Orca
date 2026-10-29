// @vitest-environment jsdom
/**
 * Flow engine spec §5.1 and §22 (plan Task 2): a `dir` project is a plain folder worked on through a vault. The project
 * list shows it with a folder badge, and Project settings hides what only a repository has -- the integration scheme
 * (delivery, PR) and the checks settings -- because a dir group's delivery is fixed to keep (§5.1, IR-I7).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectControl } from "../src/ProjectControl.js";
import { ProjectSettings } from "../src/ProjectSettings.js";
import { projectKindForRepo, type ProjectsAnswerV1 } from "../src/project.js";
import type { RepositoryIntegrationV1 } from "../src/controlTypes.js";
import "../src/i18n.js";
import { optionsOf } from "./selectControl.js";

afterEach(cleanup);

const answer: ProjectsAnswerV1 = {
  source: "file", editable: true, pendingRestart: [], fileError: null,
  projects: [
    { projectKey: "articles", name: "Articles", path: "/f/articles", kind: "dir", controlRepoId: "articles-11111111" },
    { projectKey: "orca", name: "Orca", path: "/r/orca", controlRepoId: "orca-22222222" },
  ],
};
const integration: RepositoryIntegrationV1 = { schema: "orca-repository-integration-v1", repoId: "articles-11111111", integration: { delivery: "keep" }, revision: 1, suggestedTarget: null };

describe("dir projects in the panel (flow spec §5.1)", () => {
  it("D1: the project select badges a dir project and leaves a repository's label as it was", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the sidebar picker offers a dir project with its folder badge and a repository as named
    render(<ProjectControl answer={answer} project="articles" onProject={vi.fn()} onAdd={vi.fn()} onRename={vi.fn()} onAddMulti={vi.fn()} onSetDirs={vi.fn()} />);
    expect(await optionsOf(screen.getByRole("combobox", { name: "Project" }))).toEqual([["Articles (folder)", false], ["Orca", false]]);
  });

  it("D2: the kind of the project a control repository belongs to; repo when absent or unknown", () => {
    expect(projectKindForRepo(answer.projects, "articles-11111111")).toBe("dir");
    expect(projectKindForRepo(answer.projects, "orca-22222222")).toBe("repo");
    expect(projectKindForRepo(answer.projects, "nope")).toBe("repo");
    expect(projectKindForRepo(answer.projects, null)).toBe("repo");
  });

  it("D3: Project settings of a dir project hides the integration scheme and says why", () => {
    render(<ProjectSettings repoId="articles-11111111" repoLabel="Articles" dir workspace={null} integration={integration}
      onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Integration" })).toBeNull();
    // The checks settings (checks spec §7) check what lands on a target branch; a folder has no target branch.
    expect(screen.queryByRole("region", { name: "Checks" })).toBeNull();
    expect(screen.getByRole("note").textContent).toBe("A folder project's runs never integrate: their results reach the folder itself.");
  });

  it("D4: Project settings of a repository still shows the integration scheme", () => {
    render(<ProjectSettings repoId="orca-22222222" repoLabel="Orca" workspace={null} integration={{ ...integration, repoId: "orca-22222222" }}
      onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Integration" })).toBeTruthy();
  });
});
