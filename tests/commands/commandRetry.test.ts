// CLI v2 spec §14 R1(c), §15.6 criterion 7: `orca command retry --request <file|->` looks the command up first; a found
// result is printed (nothing is sent twice); only a confirmed miss resends -- exactly the stored bytes, which the panel
// replays for a command id it already holds (commandLedger.ts:155-159) and refuses as command-id-conflict otherwise.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, useFakePanels, type Recorded, type Route } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();

/**
 * The panel's ledger for one route: a known id replays byte-identical bytes, else command-id-conflict. The first `drops`
 * POSTs lose their answer (the CLI's own transport retry included); `commitFirst` books the first one before dropping it.
 */
function ledger(options: { commitFirst: boolean; drops: number }) {
  const held = new Map<string, { text: string; body: unknown }>();
  let drops = options.drops;
  const post: Route = (request: Recorded) => {
    const { commandId } = JSON.parse(request.text) as { commandId: string };
    let answer: { status: number; body: unknown };
    const prior = held.get(commandId);
    if (prior !== undefined) {
      answer = prior.text === request.text ? { status: 200, body: prior.body }
        : { status: 409, body: { error: { code: "command-id-conflict", message: "different bytes", commandRevision: 5, evidenceIds: [], retryable: false } } };
    } else {
      const body = { commandId, commandRevision: 6, result: { kind: "task-retried" } };
      if (options.commitFirst || drops === 0) held.set(commandId, { text: request.text, body });
      answer = { status: 200, body };
    }
    if (drops > 0) { drops -= 1; return "drop"; }
    return answer;
  };
  const lookup = (hidden: boolean): Route => (request) => {
    const commandId = request.path.split("/").at(-1)!;
    const found = held.get(commandId);
    return found === undefined || hidden
      ? { status: 404, body: { error: { code: "command-result-not-found", message: "No retained command result was found.", commandRevision: 5, evidenceIds: [], retryable: false } } }
      : { status: 200, body: { schema: "orca-command-lookup-v1", originalStatus: 200, body: found.body } };
  };
  return { held, post, lookup };
}

async function uncertainRetry(w: Awaited<ReturnType<typeof world>>) {
  const first = await cli(["task", "retry", "g-alpha", "t1", "--json"], w.dir);
  expect(first.code).toBe(1);
  const request = first.json().request;
  expect(request).toBeDefined();
  const file = join(mkdtempSync(join(tmpdir(), "req-")), "request.json");
  writeFileSync(file, JSON.stringify(request));
  return { request, file };
}
const posts = (w: Awaited<ReturnType<typeof world>>) => w.requests.filter((r) => r.method === "POST");

describe("orca command retry (spec §14 R1)", () => {
  it("committed: the lookup finds it; the retained result is printed and nothing is sent again", async () => {
    const l = ledger({ commitFirst: true, drops: 2 });
    const w = await world({}, { "POST groups/g-alpha/retry-task": l.post, [`GET *`]: l.lookup(false) });
    const { request, file } = await uncertainRetry(w);
    const sentBefore = posts(w).length;
    const out = await cli(["command", "retry", "--request", file, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(posts(w)).toHaveLength(sentBefore);
    expect(out.json()).toMatchObject({ status: 200, commandId: request.commandId, body: { commandId: request.commandId, result: { kind: "task-retried" } } });
    expect(w.requests.filter((r) => r.method === "GET").at(-1)!.path).toBe(`groups/g-alpha/commands/${request.commandId}`);
  });

  it("a confirmed miss: exactly one send, byte-identical to the stored request", async () => {
    const l = ledger({ commitFirst: false, drops: 2 });
    const w = await world({}, { "POST groups/g-alpha/retry-task": l.post, [`GET *`]: l.lookup(false) });
    const { request, file } = await uncertainRetry(w);
    const original = posts(w)[0]!.text;
    const sentBefore = posts(w).length;
    const out = await cli(["command", "retry", "--request", file, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(posts(w)).toHaveLength(sentBefore + 1);
    expect(posts(w).at(-1)!.text).toBe(original);
    expect(out.json().commandId).toBe(request.commandId);
  });

  it("the resend is the stored bytes, not a re-read: after the state moved, the panel still replays it (no command-id-conflict)", async () => {
    // The lookup misses (as when the commit lands after the lookup) while the panel's ledger already holds the id.
    const l = ledger({ commitFirst: true, drops: 2 });
    const w = await world({}, { "POST groups/g-alpha/retry-task": l.post, [`GET *`]: l.lookup(true) });
    const { file } = await uncertainRetry(w);
    w.state.view = groupView({ revision: 6, currentRunId: "run-2" });
    const out = await cli(["command", "retry", "--request", file, "--json"], w.dir);
    expect(out.json().body.error?.code).toBeUndefined();
    expect([out.code, out.json().status]).toEqual([0, 200]);
  });

  it("reads the request from stdin with --request -", async () => {
    const l = ledger({ commitFirst: true, drops: 2 });
    const w = await world({}, { "POST groups/g-alpha/retry-task": l.post, [`GET *`]: l.lookup(false) });
    const { request } = await uncertainRetry(w);
    const out = await cli(["command", "retry", "--request", "-", "--json"], w.dir, { stdinText: JSON.stringify(request) });
    expect(out.code).toBe(0);
  });

  it("a request that is not {route, expectedRevision, payload, commandId} is refused here", async () => {
    const w = await world();
    const out = await cli(["command", "retry", "--request", "-", "--json"], w.dir, { stdinText: "{\"route\":\"groups/g-alpha/start\"}" });
    expect([out.code, out.json().body.error.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(posts(w)).toEqual([]);
  });
});
