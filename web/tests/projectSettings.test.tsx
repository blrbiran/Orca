// @vitest-environment jsdom
/**
 * Gaps spec §11 (G11; plan Task 10-B): the project settings page names the project it sets. Measured before the fix
 * (ledger "gaps T10-B: §11 reproduce"): the heading read the bare "Project settings" for a repository project and for a
 * `dir` project alike, and the name was only in a body sentence -- so a person with several projects could not tell
 * which one the page changed from its title. Now the h2 (its accessible name) carries the project's name, the
 * project's path sits muted under it, and the embedded flow settings say whose they are. A `dir` project's label is
 * its name, never the raw control id the panel keys it by.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ProjectSettings } from "../src/ProjectSettings.js";
import { repoLabelOf, repoPathOf, type ProjectV1 } from "../src/project.js";

const projects: ProjectV1[] = [
  { projectKey: "articles", name: "Articles", path: "/f/articles", kind: "dir", controlRepoId: "articles-11111111" },
  { projectKey: "orca", name: "Orca", path: "/r/orca", controlRepoId: "orca-22222222" },
];

beforeEach(() => {
  // The embedded settings read their own state; nothing here needs an answer, so every read is refused.
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "not-found", message: "" } }), { status: 404 })) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

function show(repoId: string, dir: boolean): void {
  render(<ProjectSettings repoId={repoId} repoLabel={repoLabelOf(projects, [], repoId)} repoPath={repoPathOf(projects, repoId)} dir={dir}
    workspace={null} integration={null} onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />);
}

describe("project settings name their project (§11, G11)", () => {
  it("a repository project: the heading names it, its path is under it, and the flow settings say whose they are", () => {
    show("orca-22222222", false);
    // mutation: heading without the name -> no heading of this name, red
    expect(screen.getByRole("heading", { level: 2, name: "Project settings — Orca" })).toBeTruthy();
    expect(screen.getByTestId("project-settings-path").textContent).toBe("/r/orca");
    expect(screen.getByRole("region", { name: "Flow settings for Orca" })).toBeTruthy();
  });

  it("a dir project: the heading names it by its name, never by the control id", () => {
    show("articles-11111111", true);
    expect(screen.getByRole("heading", { level: 2, name: "Project settings — Articles" })).toBeTruthy();
    expect(screen.getByTestId("project-settings-path").textContent).toBe("/f/articles");
    expect(screen.getByRole("region", { name: "Flow settings for Articles" })).toBeTruthy();
    expect(screen.queryByText(/articles-11111111/)).toBeNull();
  });

  it("the label App gives a dir project is its name; an unlisted repository falls back to the config's name, then the id", () => {
    // mutation: dir label falls back to the id -> "articles-11111111", red
    expect(repoLabelOf(projects, [{ repoId: "articles-11111111", displayName: "articles-11111111" }], "articles-11111111")).toBe("Articles");
    expect(repoLabelOf(projects, [], "orca-22222222")).toBe("Orca");
    expect(repoLabelOf(null, [{ repoId: "x-1", displayName: "X" }], "x-1")).toBe("X");
    expect(repoLabelOf(null, [], "x-1")).toBe("x-1");
    expect(repoPathOf(projects, "nope")).toBeNull();
  });

  it("reads 「项目设置 — <项目名>」 in Chinese", async () => {
    await i18n.changeLanguage("zh");
    show("articles-11111111", true);
    expect(screen.getByRole("heading", { level: 2, name: "项目设置 — Articles" })).toBeTruthy();
  });

  it("with no project chosen, the heading is the plain title and no path is shown", () => {
    render(<ProjectSettings repoId={null} repoLabel={null} repoPath={null} workspace={null} integration={null} onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Project settings" })).toBeTruthy();
    expect(screen.queryByTestId("project-settings-path")).toBeNull();
  });
});
