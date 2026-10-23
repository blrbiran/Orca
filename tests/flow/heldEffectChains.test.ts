/**
 * Gaps spec §6.3, Task 9 fix round 2 (controller's ruling N1): a held external effect is a property of the effect step
 * that only a person lifts. After the person defers an upstream step, no chain of open mark commands from a non-person
 * (an agent, a run Orca dispatched, a member) -- skip, defer without proceed, fill, on any step -- may get the effect step
 * running or to its effect gate, under `rerunReview: auto` (a plan an agent's fill makes runs at once). The re-reviewer's
 * chain (skip the effect step, skip the holding defer, fill the effect step) is named; the property enumerates every
 * sequence of length 3 over the template's two steps (6 commands: 216 sequences, each its own run; every prefix -- so
 * every shorter sequence -- is checked on the way). Length 4 is the same test with ORCA_PROPERTY_LENGTH=4 (too slow for
 * every `npm test`; run once for fix round 2, its log is in the report).
 */
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { marksOf } from "../../src/flow/marks.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { listEffects, listExecutions, listMessages } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { yaml: "format: orca-flow-v1\nid: e\nworkspace: {kind: dir}\neffects:\n  wechat-draft: {class: external}\nsteps:\n  - {id: write, kind: draft, prompt: write.md}\n  - {id: push, kind: work, prompt: push.md, effect: wechat-draft}\n",
  assets: { "write.md": "Write.\n", "push.md": "Push it.\n" } };
const STEPS = ["write", "push"] as const;
const COMMANDS = ["skip", "defer", "fill"] as const;
type Cmd = { step: (typeof STEPS)[number]; command: (typeof COMMANDS)[number] };
const ALL: Cmd[] = STEPS.flatMap((step) => COMMANDS.map((command) => ({ step, command })));

async function world() {
  const children = fakeChildPort();
  const w = await flowWorld({ e: TPL }, { children: children.port });
  w.deps.rerunReview = () => "auto";
  let answered = 0;
  /** Answer every call made so far: a proposal skips nothing, a draft writes its text. */
  const drain = async (): Promise<void> => {
    while (answered < w.calls.length) {
      const n = answered++;
      await w.answer(n, w.calls[n]!.purpose === "rerun-proposal" ? { skips: [] } : { content: `${w.calls[n]!.key.stepKey} ${n}` });
    }
  };
  let requests = 0;
  const mark = (flowRunId: string, { step, command }: Cmd, person: boolean) =>
    acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "step", stepKey: step }, body: { command }, by: person ? "ann" : "agent", via: "cli:test", requestId: `m${++requests}`, personAuthority: person });
  /** A run whose `write` the person deferred (wait): `push` is parked, held by it. */
  const heldRun = async (): Promise<string> => {
    const { flowRunId } = await w.start({ templateRef: "builtin/e" });
    await w.advance();
    await mark(flowRunId, { step: "write", command: "defer" }, true);
    await drain();
    expect(listExecutions(w.store, flowRunId).filter((e) => e.stepKey === "push").map((e) => e.state)).toEqual(["parked"]);
    return flowRunId;
  };
  /** The invariant: push never ran, never reached its gate, has no effect record, and no child was opened for it. */
  const pushNeverReleased = (flowRunId: string): { states: string[]; effects: number; opened: string[] } => ({
    states: listExecutions(w.store, flowRunId).filter((e) => e.stepKey === "push" && !["parked", "skipped", "queued"].includes(e.state)).map((e) => `${e.seq}:${e.state}`),
    effects: listEffects(w.store, flowRunId).filter((r) => r.stepKey === "push").length,
    opened: [...children.opened.keys()].filter((id) => id.startsWith(childGroupIdOf(flowRunId, "push", 1).replace(/-1$/, ""))),
  });
  return { w, children, drain, mark, heldRun, pushNeverReleased };
}

describe("a held effect stays held through any chain of marks without the person (gaps §6.3, fix round 2 N1)", () => {
  it("the re-review chain: skip push, skip write (replacing the person's defer), fill push -- the second is refused; push re-run by the fill plan parks again", { timeout: 60_000 }, async () => {
    const t = await world(); try {
      const id = await t.heldRun();
      expect(await t.mark(id, { step: "push", command: "skip" }, false)).toMatchObject({ state: "applied" });
      await t.drain();
      expect(await t.mark(id, { step: "write", command: "skip" }, false)).toMatchObject({ state: "rejected", reason: "flow-effect-needs-person" });
      await t.drain();
      expect(await t.mark(id, { step: "push", command: "fill" }, false)).toMatchObject({ state: "applied" });
      await t.drain();
      expect(marksOf(listMessages(t.w.store, id)).get("write")).toMatchObject({ kind: "defer" });
      expect(marksOf(listMessages(t.w.store, id)).has("push")).toBe(false);
      // The fill's plan re-ran push: it parked again, held by the person's defer.
      expect(t.w.latest(id, "push")).toMatchObject({ state: "parked", body: expect.objectContaining({ needsYou: { kind: "deferred-upstream", deferred: ["write"] } }) });
      expect(t.pushNeverReleased(id)).toEqual({ states: [], effects: 0, opened: [] });
      // The person still lifts it with their own skip of write.
      expect(await t.mark(id, { step: "write", command: "skip" }, true)).toMatchObject({ state: "applied" });
      await t.drain();
      expect(t.pushNeverReleased(id).states).toEqual([expect.stringMatching(/:running$/)]);
    } finally { await t.w.dispose(); }
  });

  // The criterion is length 3 (6^3 = 216 sequences, every shorter one checked as a prefix). Length 4 (1296) takes about
  // half an hour on one worker and is run on demand with ORCA_PROPERTY_LENGTH=4 (fix round 2 report: its log). Each world
  // holds at most CHUNK runs (every kernel pass walks a world's running runs); WORKERS worlds run side by side.
  const LENGTH = Number(process.env.ORCA_PROPERTY_LENGTH ?? 3);
  const CHUNK = 18, WORKERS = 4;
  it(`every sequence of up to ${LENGTH} open marks from a non-person (skip, defer without proceed, fill over each step) leaves push held`, { timeout: 3_600_000 }, async () => {
    const sequences: Cmd[][] = [];
    const grow = (prefix: Cmd[]): void => { if (prefix.length === LENGTH) { sequences.push(prefix); return; } for (const c of ALL) grow([...prefix, c]); };
    grow([]);
    expect(sequences).toHaveLength(ALL.length ** LENGTH);
    const chunks: Cmd[][][] = [];
    for (let at = 0; at < sequences.length; at += CHUNK) chunks.push(sequences.slice(at, at + CHUNK));
    const broken: string[] = [];
    let checked = 0;
    const worker = async (): Promise<void> => {
      for (let chunk = chunks.shift(); chunk !== undefined; chunk = chunks.shift()) {
        const t = await world(); try {
          for (const sequence of chunk) {
            const id = await t.heldRun();
            for (const [i, c] of sequence.entries()) {
              await t.mark(id, c, false);
              await t.drain();
              const seen = t.pushNeverReleased(id);
              if (seen.states.length > 0 || seen.effects > 0 || seen.opened.length > 0) {
                broken.push(`${sequence.slice(0, i + 1).map((x) => `${x.command}(${x.step})`).join(" ")}: ${JSON.stringify(seen)}`);
                break;
              }
            }
            checked += 1;
          }
        } finally { await t.w.dispose(); }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    expect(checked).toBe(sequences.length);
    expect(broken).toEqual([]);
  });
});
