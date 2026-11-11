// Issue #149: an agent re-runs a write after a timeout with the same --command-id. The CLI re-reads the revision, so the
// raw request is not the booked one and the panel refuses command-id-conflict even though the first attempt succeeded.
// Now the CLI looks the id up first (only with --command-id and without --if-revision): booked with the same arguments
// (commandArgumentsHash: verb, target, payload) -> the booked outcome is printed as a fresh answer would be, stderr says
// it was replayed, and nothing is sent. Booked with other arguments, or not booked -> sent as before, so a real conflict is
// still the panel's command-id-conflict.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandArgumentsHash } from "../../src/control/commandArguments.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";
import { cli, useFakePanels, type Recorded, type Route } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();
useSocketPanels();

/**
 * The panel's ledger for one route, as commandLedger.ts keeps it: a known id with byte-identical bytes replays, other bytes
 * are command-id-conflict; the lookup answers the booked outcome with the argumentsHash of the booked verb, target and payload.
 */
function ledger(verb: string, target: unknown, answer: (commandId: string) => { status: number; body: unknown } = (commandId) => ({ status: 200, body: { commandId, commandRevision: 6, result: { kind: "ok" } } })) {
  const held = new Map<string, { text: string; status: number; body: unknown; argumentsHash: string }>();
  const post: Route = (request: Recorded) => {
    const { commandId, payload } = JSON.parse(request.text) as { commandId: string; payload: unknown };
    const prior = held.get(commandId);
    if (prior !== undefined) {
      return prior.text === request.text ? { status: prior.status, body: prior.body }
        : { status: 409, body: { error: { code: "command-id-conflict", message: "different bytes", commandRevision: 6, evidenceIds: [], retryable: false } } };
    }
    const outcome = answer(commandId);
    held.set(commandId, { text: request.text, ...outcome, argumentsHash: commandArgumentsHash({ verb, target, payload }) });
    return outcome;
  };
  const lookup: Route = (request) => {
    const found = held.get(request.path.split("/").at(-1)!);
    return found === undefined
      ? { status: 404, body: { error: { code: "command-result-not-found", message: "No retained command result was found.", commandRevision: 6, evidenceIds: [], retryable: false } } }
      : { status: 200, body: { schema: "orca-command-lookup-v1", originalStatus: found.status, body: found.body, argumentsHash: found.argumentsHash } };
  };
  return { held, post, lookup };
}

type World = Awaited<ReturnType<typeof world>>;
const posts = (w: World) => w.requests.filter((r) => r.method === "POST");
const lookups = (w: World) => w.requests.filter((r) => r.method === "GET" && /\/commands\//.test(r.path)).map((r) => r.path);
const REPLAYED = (id: string) => `replayed: command ${id} was already applied`;
const G_ALPHA = { kind: "group", groupId: "g-alpha" };

describe("same id, same arguments, after the revision moved: the booked outcome, nothing sent (criterion 1)", () => {
  it("a success: --json stdout equals the first answer, the body equals the booked one, exit 0, stderr says replayed", async () => {
    const l = ledger("start", G_ALPHA);
    const w = await world({}, { "POST groups/g-alpha/start": l.post, "GET *": l.lookup });
    const first = await cli(["group", "start", "g-alpha", "--command-id", "r-1", "--json"], w.dir);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.stderr).not.toContain("replayed");
    w.state.view = groupView({ revision: 6 });
    const again = await cli(["group", "start", "g-alpha", "--command-id", "r-1", "--json"], w.dir);
    // mutation: skip the lookup in runWrite -> a second POST (re-read revision 6), command-id-conflict, exit 2 -> red
    expect(posts(w)).toHaveLength(1);
    expect(l.held.size).toBe(1);
    expect(again.stdout).toBe(first.stdout);
    expect(again.json().body).toEqual(l.held.get("r-1")!.body);
    expect(again.code).toBe(first.code);
    // mutation: drop the stderr note -> red
    expect(again.stderr).toContain(REPLAYED("r-1"));
  });

  it("the human output is the one a fresh success prints", async () => {
    const l = ledger("start", G_ALPHA);
    const w = await world({}, { "POST groups/g-alpha/start": l.post, "GET *": l.lookup });
    const first = await cli(["group", "start", "g-alpha", "--command-id", "r-h"], w.dir);
    w.state.view = groupView({ revision: 6 });
    const again = await cli(["group", "start", "g-alpha", "--command-id", "r-h"], w.dir);
    expect(posts(w)).toHaveLength(1);
    expect([again.code, again.stdout]).toEqual([first.code, first.stdout]);
    expect(again.stderr).toContain(REPLAYED("r-h"));
  });

  it("a booked refusal: the same refusal, the same exit code (2), nothing sent", async () => {
    const refusal = { status: 409, body: { error: { code: "no-op-command", message: "The command changes nothing.", commandRevision: 5, evidenceIds: [], retryable: false } } };
    const l = ledger("start", G_ALPHA, () => refusal);
    const w = await world({}, { "POST groups/g-alpha/start": l.post, "GET *": l.lookup });
    const first = await cli(["group", "start", "g-alpha", "--command-id", "r-no", "--json"], w.dir);
    expect(first.code).toBe(2);
    w.state.view = groupView({ revision: 6 });
    const again = await cli(["group", "start", "g-alpha", "--command-id", "r-no", "--json"], w.dir);
    expect(posts(w)).toHaveLength(1);
    expect([again.code, again.stdout]).toEqual([2, first.stdout]);
    expect(again.stderr).toContain(REPLAYED("r-no"));
  });

  it("a task route: the target the CLI hashes names the task, as the panel's does", async () => {
    const l = ledger("set-task-labels", { kind: "task", groupId: "g-alpha", taskId: "t1" });
    const w = await world({}, { "POST groups/g-alpha/tasks/t1/labels": l.post, "GET *": l.lookup });
    const argv = ["task", "set-labels", "g-alpha", "t1", "--label", "area:cli", "--command-id", "r-t", "--json"];
    const first = await cli(argv, w.dir);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    w.state.view = groupView({ revision: 6 });
    const again = await cli(argv, w.dir);
    // mutation: the CLI's target for a task route is the group's -> the hashes differ, sent, command-id-conflict -> red
    expect(posts(w)).toHaveLength(1);
    expect([again.code, again.stdout]).toEqual([0, first.stdout]);
  });
});

describe("same id, different arguments: still command-id-conflict (criterion 2)", () => {
  it("sent as before after the lookup, and the panel's command-id-conflict is the answer", async () => {
    const l = ledger("handoff-stop", G_ALPHA);
    const w = await world({}, { "POST groups/g-alpha/handoff-stop": l.post, "GET *": l.lookup });
    const first = await cli(["group", "stop-handoff", "g-alpha", "--deadline", "2026-12-01T10:00:00.000Z", "--command-id", "r-2", "--json"], w.dir);
    expect(first.code).toBe(0);
    const again = await cli(["group", "stop-handoff", "g-alpha", "--deadline", "2026-12-02T10:00:00.000Z", "--command-id", "r-2", "--json"], w.dir);
    // The id was looked up (so the hash comparison, not a missing lookup, decided to send).
    expect(lookups(w)).toEqual(["groups/g-alpha/commands/r-2", "groups/g-alpha/commands/r-2"]);
    // mutation: replay any found id without comparing the hash -> no second POST, exit 0 -> red
    expect(posts(w)).toHaveLength(2);
    expect([again.code, again.json().body.error.code]).toEqual([2, "command-id-conflict"]);
    expect(again.stderr).not.toContain("replayed");
  });
});

describe("an id the panel has not booked is sent normally (criterion 3)", () => {
  it("looked up, a confirmed miss, one POST with that id", async () => {
    const l = ledger("start", G_ALPHA);
    const w = await world({}, { "POST groups/g-alpha/start": l.post, "GET *": l.lookup });
    const out = await cli(["group", "start", "g-alpha", "--command-id", "r-new", "--json"], w.dir);
    expect(lookups(w)).toEqual(["groups/g-alpha/commands/r-new"]);
    expect(posts(w)).toHaveLength(1);
    expect(JSON.parse(posts(w)[0]!.text)).toMatchObject({ commandId: "r-new", expectedRevision: 5 });
    expect([out.code, out.json().status]).toEqual([0, 200]);
    expect(out.stderr).not.toContain("replayed");
  });
});

describe("--if-revision given: no lookup, sent as today (criterion 4)", () => {
  it("the booked id with --if-revision is sent at that revision, never looked up", async () => {
    const l = ledger("start", G_ALPHA);
    const w = await world({}, { "POST groups/g-alpha/start": l.post, "GET *": l.lookup });
    expect((await cli(["group", "start", "g-alpha", "--command-id", "r-4", "--if-revision", "5", "--json"], w.dir)).code).toBe(0);
    const again = await cli(["group", "start", "g-alpha", "--command-id", "r-4", "--if-revision", "5", "--json"], w.dir);
    // mutation: look up whenever --command-id is given -> a lookup is recorded -> red
    expect(lookups(w)).toEqual([]);
    expect(posts(w)).toHaveLength(2);
    expect(again.stderr).not.toContain("replayed");
  });
});

describe("against a real panel (criteria 1 and 5 end to end: the CLI's hash is the panel's)", () => {
  it("a re-run after another write moved the revision replays: no second ledger row, the same output, exit 0", async () => {
    const w = await workspace();
    await boot(w, [], { port: true });
    const argv = ["project", "set-workspace-mode", "--mode", "clone", "--command-id", "replay-1", "--json"];
    const first = await cli(argv, w.state, { cwd: w.repo });
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect((await cli(["project", "set-workspace-mode", "--mode", "worktree", "--json"], w.state, { cwd: w.repo })).code).toBe(0);
    const db = new DatabaseSync(join(w.state, "control.sqlite"), { readOnly: true });
    const rows = () => (db.prepare("SELECT count(*) AS n FROM commands").get() as { n: number }).n;
    try {
      const before = rows();
      const again = await cli(argv, w.state, { cwd: w.repo });
      expect(again.stderr).toContain(REPLAYED("replay-1"));
      expect([again.code, again.stdout]).toEqual([0, first.stdout]);
      expect(rows()).toBe(before);
      // The second write's mode stands: the replay applied nothing.
      const read = await cli(["control", "get", `repositories/${controlRepoKey("proj")}/workspace`], w.state);
      expect(read.json().body).toMatchObject({ workspaceMode: "worktree", revision: 2 });
      // Criterion 5 over the wire: the lookup answers the hash and the outcome, never the raw request.
      const lookup = await cli(["control", "get", `groups/@repository:${controlRepoKey("proj")}/commands/replay-1`], w.state);
      expect(Object.keys(lookup.json().body).sort()).toEqual(["argumentsHash", "body", "originalStatus", "schema"]);
      expect(JSON.stringify(lookup.json().body)).not.toContain("expectedRevision");
    } finally {
      db.close();
    }
  }, 60_000);
});
