/**
 * Multi-directory projects spec §4.3, criterion M3: the control plane knows a multi-dir project's repo id without giving
 * it a path. `knownRepository(multi)` is true (a requirement may open on it), `resolveRepository(multi)` throws
 * `multi-dir-no-single-path` before the config is touched, and the repository settings are refused on it
 * `multi-dir-project-setting-unsupported` -- booked, so the person sees a named outcome, and no settings row is written.
 *
 * Rule 17: every path, HOME included, is under a temporary root.
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { createMultiDirProjects } from "../../src/control/multiGroup.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { parsePanelArgs } from "../../src/panel/server.js";

const UNSUPPORTED = "multi-dir-project-setting-unsupported";

interface SetterCase { name: string; verb: string; payload: Record<string, unknown> }

const SETTERS: readonly SetterCase[] = [
  { name: "set-workspace-mode", verb: "set-workspace-mode", payload: { workspaceMode: "clone" } },
  { name: "set-criteria-review", verb: "set-criteria-review", payload: { enabled: true } },
  { name: "set-integration-scheme", verb: "set-integration-scheme", payload: { integration: { delivery: "keep" } } },
  { name: "set-check-settings", verb: "set-check-settings", payload: { kind: "integration-check", set: { command: "true" }, clear: [] } },
  { name: "set-scheduled-check", verb: "set-scheduled-check", payload: { id: "s1", kind: "integration-check", cron: "0 * * * *", enabled: true } },
  { name: "set-flow-settings", verb: "set-flow-settings", payload: { set: {}, clear: [] } },
];

async function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "multi-dir-config-")));
  const one = join(root, "one"), two = join(root, "two"), folder = join(root, "folder");
  for (const dir of [one, two, folder]) mkdirSync(dir);
  mkdirSync(join(root, "home"), { mode: 0o700 });
  const file = join(root, "projects.json");
  writeFileSync(file, JSON.stringify({ version: 1,
    projects: [{ id: "one", name: "one", path: one }, { id: "two", name: "two", path: two }, { id: "folder", name: "Folder", path: folder, kind: "dir" }],
    multiDirProjects: [{ id: "all", name: "All", dirs: ["one", "two", "folder"] }] }));
  const binary = join(root, "ccloop");
  copyFileSync(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
  chmodSync(binary, 0o700);
  writeFileSync(join(root, "agents.json"), "{}", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_PROJECTS_FILE: file, ORCA_VAULT_DIR: join(root, "vaults"),
    ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: join(root, "agents.json"), HOME: join(root, "home") };
  const opts = parsePanelArgs(["--by", "tester", "--projects-file", file], env);
  // The registry's runtime shape (§4.3): the multi id and each member's control repo id, in registered order.
  const multiKey = controlRepoKey("all");
  const multi = createMultiDirProjects();
  multi.add({ repoId: multiKey, dirs: [
    { key: "one", repoId: controlRepoKey("one"), kind: "repo", path: one },
    { key: "two", repoId: controlRepoKey("two"), kind: "repo", path: two },
    { key: "folder", repoId: controlRepoKey("folder"), kind: "dir", path: folder },
  ] });
  const runtime = (await assembleControlRuntime({ control: opts.control, repos: opts.repos, epoch: "epoch-multi-config", env, multiDirProjects: multi }))!;
  return { root, one, folder, multiKey, runtime, close: () => { runtime.close(); rmSync(root, { recursive: true, force: true }); } };
}

const thrownCode = (fn: () => unknown): unknown => {
  try { fn(); return null; } catch (error) { return (error as { code?: unknown }).code; }
};

describe("a multi-dir project's control repo id (M3, §4.3)", () => {
  it("is known without a config repository, resolves no path, and a single member resolves its own", async () => {
    const w = await world(); try {
      const known = w.runtime.service.deps.knownRepository!;
      expect(w.runtime.config.hasRepository(w.multiKey)).toBe(false);
      expect(known(w.multiKey)).toBe(true);
      expect(known(controlRepoKey("one"))).toBe(true);
      expect(thrownCode(() => w.runtime.service.deps.resolveRepository!(w.multiKey))).toBe("multi-dir-no-single-path");
      expect(w.runtime.service.deps.resolveRepository!(controlRepoKey("one"))).toBe(realpathSync(w.one));
    } finally { w.close(); }
  });

  it("refuses the repository settings by name, books each, and writes no settings row", async () => {
    const w = await world(); try {
      for (const setter of SETTERS) {
        const commandId = `set-${setter.name}`;
        const command = { schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb: setter.verb,
          target: { kind: "repository", repoId: w.multiKey }, payload: setter.payload } as never;
        const answer = setter.verb === "set-workspace-mode" ? await w.runtime.service.setWorkspaceMode(command)
          : setter.verb === "set-criteria-review" ? w.runtime.service.setCriteriaReview(command)
          : setter.verb === "set-integration-scheme" ? await w.runtime.service.setIntegrationScheme(command)
          : setter.verb === "set-check-settings" ? w.runtime.service.setCheckSettings(command)
          : setter.verb === "set-scheduled-check" ? w.runtime.service.setScheduledCheck(command)
          : w.runtime.service.setFlowSettings(command);
        expect((answer as { error?: { code?: string } }).error?.code, setter.name).toBe(UNSUPPORTED);
        expect(lookupCommandResult(w.runtime.store, `@repository:${w.multiKey}`, commandId)!.body, setter.name).toMatchObject({ error: { code: UNSUPPORTED } });
      }
      expect(w.runtime.store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(w.multiKey)).toBeUndefined();
    } finally { w.close(); }
  });

  it("a member's settings still write its own row", async () => {
    const w = await world(); try {
      const answer = await w.runtime.service.setWorkspaceMode({ schema: "orca-raw-command-v1", commandId: "member-mode", actorId: "human",
        expectedRevision: 0, verb: "set-workspace-mode", target: { kind: "repository", repoId: controlRepoKey("one") }, payload: { workspaceMode: "clone" } } as never);
      expect((answer as { error?: unknown }).error).toBeUndefined();
      expect(w.runtime.store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(controlRepoKey("one"))).toBeDefined();
    } finally { w.close(); }
  });
});
