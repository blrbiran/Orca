// CLI v2 spec §15.4, §15.5 (plan Task 8): a socket request carrying the dispatched-run marker is refused every verb of the
// §15.1 table -- today's human-only verbs and fields -- by name, before anything is booked; every other verb is not.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";
import { runRegistered } from "../../src/commands/run.js";
import { childEnv } from "../../src/chain/launch/claudeCode.js";
import { runIntegrationCheck } from "../../src/control/integrationCheck.js";
import { AgentsRunRefused, runTask } from "../../src/scheduler/ccloopRunner.js";
import { controlCommandRoutes } from "../../src/panel/controlApi.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { HUMAN_ONLY_FIELDS, HUMAN_ONLY_VERBS, humanOnlyRefusal } from "../../src/panel/humanOnly.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { boot, overSocket, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useSocketPanels();

const MARKER = { "x-orca-client": "cli:claude", "x-orca-dispatched-run": "run-0123" };
const ledgerIds = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};
const fill = (path: string): string => path
  .replace(":groupId", "g1").replace(":taskId", "t1").replace(":repoId", controlRepoKey("proj")).replace(/:[A-Za-z]+/g, "x1").replace(/^\/api\/control\//, "");
const codeOf = (text: string): string | undefined => (JSON.parse(text) as { error?: { code?: string } }).error?.code;

/** One request per §15.1 entry: a human-only verb with an empty payload, or a verb with its human-only field. */
function cases(): Array<{ verb: string; route: string; payload: Record<string, unknown> }> {
  const out: Array<{ verb: string; route: string; payload: Record<string, unknown> }> = [];
  for (const route of controlCommandRoutes("op")) {
    if (HUMAN_ONLY_VERBS.includes(route.verb)) out.push({ verb: route.verb, route: fill(route.path), payload: {} });
    for (const field of HUMAN_ONLY_FIELDS[route.verb] ?? []) out.push({ verb: `${route.verb}.${field}`, route: fill(route.path), payload: { [field]: {} } });
  }
  return out;
}

describe("the dispatched-run marker on the control socket (CLI v2 spec §15.4)", () => {
  it("covers every human-only verb and field of today's table", () => {
    const covered = new Set(cases().map((c) => c.verb));
    const wanted = [...HUMAN_ONLY_VERBS, ...Object.entries(HUMAN_ONLY_FIELDS).flatMap(([verb, fields]) => fields!.map((f) => `${verb}.${f}`))];
    expect(wanted.filter((verb) => !covered.has(verb))).toEqual([]);
  });

  it("refuses each §15.1 verb and field 403 control-dispatched-run-refused and books nothing", async () => {
    const w = await workspace(); const panel = await boot(w);
    const answers: Record<string, [number, string | undefined]> = {};
    for (const [i, c] of cases().entries()) {
      expect(humanOnlyRefusal(c.verb.split(".")[0] as never, c.payload)).not.toBeNull();
      const res = await overSocket(panel.socketPath!, "POST", `/api/control/${c.route}`, MARKER, { commandId: `marked-${i}`, expectedRevision: 0, payload: c.payload });
      answers[c.verb] = [res.status, codeOf(res.text)];
    }
    for (const [verb, answer] of Object.entries(answers)) expect(answer, verb).toEqual([403, "control-dispatched-run-refused"]);
    expect(ledgerIds(w.state).filter((id) => id.startsWith("marked-"))).toEqual([]);
  });

  it("does not refuse a verb outside §15.1 because of the marker (start; confirm without integrationHash)", async () => {
    const w = await workspace(); const panel = await boot(w);
    for (const [route, payload] of [["groups/g1/start", {}], ["groups/g1/confirm", {}]] as const) {
      const res = await overSocket(panel.socketPath!, "POST", `/api/control/${route}`, MARKER, { commandId: `open-${route.split("/")[2]}`, expectedRevision: 0, payload });
      expect(codeOf(res.text), route).not.toBe("control-dispatched-run-refused");
    }
  });

  it("the CLI sends the marker from ORCA_DISPATCHED_RUN: orca control send and a registry write are both refused by it", async () => {
    const w = await workspace(); const panel = await boot(w);
    const env = { ...w.env, ORCA_DISPATCHED_RUN: "run-0456" };
    const out: string[] = [];
    const sent = await runControlCommand(["send", "groups/g1/integration/retry", "--expected-revision", "0", "--payload", "{}", "--control-state-dir", w.state], env, { write: (t) => out.push(t), readFile: () => "" });
    expect([sent, JSON.parse(out.join("")).body.error.code]).toEqual([2, "control-dispatched-run-refused"]);
    const lines: string[] = [];
    const io = { stdout: (t: string) => lines.push(t), stderr: () => undefined, env, cwd: w.root, stdinIsTTY: false };
    const code = await runRegistered(["usage", "clear-cap", "--scope", "all", "--period", "total", "--control-state-dir", w.state, "--json"], io);
    expect([code, JSON.parse(lines.join("")).body.error.code]).toEqual([2, "control-dispatched-run-refused"]);
    // The control: without the variable the same write is not refused by the marker.
    lines.length = 0;
    await runRegistered(["usage", "clear-cap", "--scope", "all", "--period", "total", "--control-state-dir", w.state, "--json"], { ...io, env: w.env });
    expect(JSON.parse(lines.join("")).body.error?.code).not.toBe("control-dispatched-run-refused");
    void (panel satisfies StartedPanel);
  });
});

// Spec §15.4: the other processes Orca starts for work, outside the ccloop control calls (those are measured end to end
// in dispatchedRunMarkerE2E.test.ts): a reconciliation/resolution `ccloop run`, a chain session, an integration check.
describe("the marker on Orca's other work processes (spec §15.4)", () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync("/usr/bin/git", args, { cwd, encoding: "utf8" }).trim();
  async function repoAt(root: string): Promise<{ repo: string; head: string }> {
    const repo = join(root, "repo");
    await mkdir(repo);
    git(repo, "init", "-q", "-b", "main");
    await writeFile(join(repo, "f.txt"), "x\n");
    git(repo, "add", "f.txt");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    return { repo, head: git(repo, "rev-parse", "HEAD") };
  }

  it("a `ccloop run` started by runTask carries ORCA_DISPATCHED_RUN=<runId> and the given ORCA_PERSON_DIR", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-marker-run-")));
    try {
      const { repo, head } = await repoAt(root);
      const log = join(root, "env.log");
      const bin = join(root, "fake-ccloop.mjs");
      await writeFile(bin, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, \`\${process.env.ORCA_DISPATCHED_RUN ?? "unset"} \${process.env.ORCA_PERSON_DIR ?? "unset"}\\n\`);\nprocess.exit(1);\n`);
      const contract = join(root, "contract.json");
      await writeFile(contract, "{}");
      const plan = { targetRepo: repo, ccloopBin: bin, runsDir: join(root, "runs"), workBranch: "orca/g", policy: "local-merge" as const, ledgerMode: "out-of-repo" as const, tasks: [] };
      const person = join(root, "dispatched-person");
      await expect(runTask(plan, { taskId: "rec-1", contract, dependsOn: [] }, head, "rec-1", { agentsTable: join(root, "agents.json"), agentSelection: { selection: {} as never, configHash: "h" }, dispatchedPersonDir: person })).rejects.toBeInstanceOf(AgentsRunRefused);
      expect(readFileSync(log, "utf8")).toBe(`rec-1 ${person}\n`);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("a chain session's environment names the chain as the dispatched run, and its person dir, over any inherited value", () => {
    const env = childEnv({ ORCA_DISPATCHED_RUN: "inherited", ORCA_PERSON_DIR: "/inherited" }, "chain-7", "s-1", "/chain/person");
    expect([env.ORCA_DISPATCHED_RUN, env.ORCA_PERSON_DIR]).toEqual(["chain-7", "/chain/person"]);
  });

  it("an integration check command carries ORCA_DISPATCHED_RUN naming the check and the given ORCA_PERSON_DIR", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-marker-check-")));
    try {
      const { repo } = await repoAt(root);
      const out = join(root, "marker.txt");
      const roots = { runsRoot: join(root, "runs"), workspacesRoot: join(root, "ws") };
      await mkdir(roots.runsRoot); await mkdir(roots.workspacesRoot);
      const person = join(root, "dispatched-person");
      const run = await runIntegrationCheck(repo, roots, "repo-1", "main", [`printf '%s %s' "\${ORCA_DISPATCHED_RUN-unset}" "\${ORCA_PERSON_DIR-unset}" > '${out}'`], 123, person);
      expect(run.failures).toEqual([]);
      // Review M1 (session b37f7ce9): and the panel's empty person directory -- `unset` here is red.
      expect(readFileSync(out, "utf8")).toMatch(new RegExp(`^integration-check-[0-9a-f]{12}-123 ${person}$`));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
