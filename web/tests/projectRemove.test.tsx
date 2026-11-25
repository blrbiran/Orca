// @vitest-environment jsdom
/**
 * Project remove spec 2026-11-25 §6.3 (tester #470, session 5d3d0c09): the project control's Remove action. Human rulings:
 * a project with groups that are not archived is not removed until a person says to archive them. So the first
 * confirmation sends no archive; a `project-has-groups` answer shows the counts by state, and only the second, which
 * names them, archives and removes. Owner only, file mode only, as add and rename are.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/auth.js";
import { AccountContext } from "../src/AuthGate.js";
import type { RemoveProjectResult } from "../src/api.js";
import { ProjectControl } from "../src/ProjectControl.js";
import type { ProjectsAnswerV1 } from "../src/project.js";
import "../src/i18n.js";

afterEach(cleanup);

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const answer: ProjectsAnswerV1 = {
  source: "file", editable: true, pendingRestart: [], fileError: null, missingPaths: ["git-merge-lab: /tmp/gone"],
  projects: [
    { projectKey: "git-merge-lab", name: "git-merge-lab", path: "/tmp/gone", controlRepoId: null },
    { projectKey: "web", name: "Web", path: "/r/web", controlRepoId: "web-22222222" },
  ],
};
const control = (me: Me, onRemove: (id: string, archiveGroups: boolean) => Promise<RemoveProjectResult>, shown: ProjectsAnswerV1 = answer): void => {
  render(<AccountContext.Provider value={me}>{(<ProjectControl answer={shown} project="git-merge-lab" onProject={vi.fn()} onAdd={vi.fn()} onRename={vi.fn()}
    onAddMulti={vi.fn()} onSetDirs={vi.fn()} onRemove={onRemove} />) as JSX.Element}</AccountContext.Provider>);
};
const hasGroups: RemoveProjectResult = { ok: false, status: 409, code: "project-has-groups", message: "git-merge-lab has 13 groups not archived",
  groups: { notArchived: 11, byStatus: { done: 10, ready: 1 }, groupIds: [] } };
const removed: RemoveProjectResult = { ok: true, body: { removed: { projectKey: "git-merge-lab" }, archivedGroups: [], archivedBefore: 0, restartNeeded: false, next: [] } };

describe("the project control's Remove (tester #470)", () => {
  it("asks first, sends no archive, then names the groups by state and archives only on the second confirmation", async () => {
    const onRemove = vi.fn<(id: string, archiveGroups: boolean) => Promise<RemoveProjectResult>>()
      .mockResolvedValueOnce(hasGroups).mockResolvedValueOnce(removed);
    control(owner, onRemove);
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    // mutation: send the DELETE from the Remove button itself -> called before any confirmation, red
    expect(onRemove).not.toHaveBeenCalled();
    const form = screen.getByRole("form", { name: "Remove project" });
    expect(form.textContent).toContain("Remove git-merge-lab from Orca: its entry leaves the projects file. Nothing on disk is deleted, and its archived groups stay readable.");
    fireEvent.click(screen.getByRole("button", { name: "Remove git-merge-lab" }));
    // mutation: send archiveGroups true on the first confirmation -> ["git-merge-lab", true], red
    await waitFor(() => expect(onRemove).toHaveBeenNthCalledWith(1, "git-merge-lab", false));
    const second = await screen.findByRole("button", { name: "Archive these 11 groups and remove" });
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toContain("11 groups of this project are not archived (10 done, 1 ready). Archiving sets them aside: they keep every record and take no new work. A group archive refuses (one still running, say) stops the removal, and the project stays registered.");
    fireEvent.click(second);
    await waitFor(() => expect(onRemove).toHaveBeenNthCalledWith(2, "git-merge-lab", true));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Remove project" })).toBeNull());
  });

  it("shows another refusal by its code and stays open", async () => {
    const onRemove = vi.fn<(id: string, archiveGroups: boolean) => Promise<RemoveProjectResult>>()
      .mockResolvedValueOnce({ ok: false, status: 409, code: "project-in-multi", message: "git-merge-lab is a member of the multi-directory project shop" });
    control(owner, onRemove);
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove git-merge-lab" }));
    expect((await screen.findByRole("alert")).textContent).toContain("project-in-multi");
    expect(screen.getByRole("form", { name: "Remove project" })).toBeTruthy();
  });

  it("is not offered to a member, and is disabled when the projects come from the command line", () => {
    // mutation: render the Remove button outside the owner's actions -> a member sees it, red
    control(member, vi.fn());
    expect(screen.queryByRole("button", { name: "Remove project" })).toBeNull();
    cleanup();
    control(owner, vi.fn(), { ...answer, source: "command-line", editable: false });
    expect((screen.getByRole("button", { name: "Remove project" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the missing-folder note points at Remove, not at a hand edit of the projects file", () => {
    control(owner, vi.fn());
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toContain("Folder not found, so not mounted: git-merge-lab: /tmp/gone. Restore the folder, or choose the project and Remove project.");
  });
});
