import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRegistered } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import { DISPATCHED_RUN_ENV } from "../../src/control/commandClient.js";
import { WebControlService } from "../../src/control/webService.js";
import { getFlowRun, listEffects, listPlans } from "../../src/flow/store.js";
import { bindControlSocket, buildControlSocketApp } from "../../src/panel/controlSocket.js";
import { HUMAN_ONLY_FIELDS, VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { quietPanelAuth, seedUser, TEST_PASSWORD } from "../panel/fixtures/auth.js";
import { overSocket } from "../panel/fixtures/socketPanel.js";
import { articleToDraftBox, SLUG, untilArticleAsks, WECHAT, wechatWorld } from "../flow/fixtures/wechatWorld.js";

/**
 * Flow engine spec §14.2, §21 C19 (BC-B5, IR-C1; plan Task 15): every flow verb's access is the spec's table. Starting a
 * run, sending feedback, edits and commands, and asking for a plan are any principal's -- an agent drives a flow; running
 * a plan, answering an ask, an effect's confirm/enact/discard, raising the pool and the settings are the person's: on the
 * control socket they need a person token, and a run Orca dispatched is refused them even with one (it must never approve
 * its own work). A scripted agent walk on `orca flow` commands only (`--json`) drives the built-in article flow (fake
 * agents) until its first human-only act, which is refused without a token; the person's token then carries it on, and
 * `orca flow effect enact` completes C13's CLI half (a stage-only draft box enacted once, a second enact refused).
 */
const TABLE = {
  "flow-start": "any", "flow-message": "any", "flow-plan": "any",
  "flow-rerun": "human-only", "flow-answer": "human-only", "flow-effect": "human-only", "flow-pool": "human-only",
  "set-flow-settings": "human-only", "set-flow-locks": "human-only", "requirement-revise": "any", "correction-record": "human-only",
} as const;
const HUMAN_ONLY = ["flow-effect", "flow-answer", "flow-rerun", "flow-pool", "set-flow-settings", "set-flow-locks"] as const;
const OWNER = { userId: "u", name: "tester", roles: ["owner"] as const };
const SOCKET: Principal = { kind: "agent", client: "cli" };
const WITH_TOKEN: Principal = { kind: "agent", client: "cli", person: OWNER };
const DISPATCHED: Principal = { kind: "agent", client: "cli", dispatchedRun: "run-1", person: OWNER };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

describe("flow verb access (C19)", () => {
  it("every §14.2 verb's VERB_ACCESS is the table; a start's pool is a human-only field", () => {
    for (const [verb, access] of Object.entries(TABLE)) expect(VERB_ACCESS[verb as keyof typeof VERB_ACCESS], verb).toBe(access);
    expect(HUMAN_ONLY_FIELDS["flow-start"]).toEqual(["pool"]);
  });

  it("the six human-only verbs: refused on the socket without a token, accepted with one, refused to a dispatched run either way", () => {
    for (const verb of HUMAN_ONLY) {
      expect(permissionRefusal(SOCKET, verb, {})?.code, verb).toBe("control-person-token-required");
      expect(permissionRefusal(WITH_TOKEN, verb, {}), verb).toBe(null);
      expect(permissionRefusal(DISPATCHED, verb, {})?.code, verb).toBe("control-dispatched-run-refused");
    }
    for (const verb of ["flow-start", "flow-message", "flow-plan"] as const) expect(permissionRefusal(SOCKET, verb, {}), verb).toBe(null);
    expect(permissionRefusal(SOCKET, "flow-start", { pool: 1 })?.code).toBe("control-person-token-required");
  });

  it("an agent's walk on orca flow commands drives the article flow to its first human-only act; the person's token carries it on", { timeout: 120_000 }, async () => {
    const world = await wechatWorld();
    cleanups.push(() => world.w.dispose());
    const { w, children, child } = world;
    // A short root: the socket path is capped at ~104 bytes.
    const root = realpathSync(mkdtempSync("/tmp/fva-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const auth = quietPanelAuth(root);
    seedUser(root, "tester");
    const login = auth.personLogin("tester", TEST_PASSWORD, auth.nowMs());
    if (!login.ok) throw new Error("person login failed");
    const personDir = join(root, "person");
    mkdirSync(personDir, { mode: 0o700 });
    writeFileSync(join(personDir, "token.json"), JSON.stringify({ schema: "orca-person-token-v1", token: login.token, sid: login.sid, user: "tester", expiresAt: login.expiresAt }), { mode: 0o600 });
    const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, knownRepository: () => false, flowDeps: () => w.deps,
      // Review finding I4 (Ruling: 这次批准改写所有必要的判据 (b37f7ce9)): a flow starts only on a registered dir project.
      flowProjects: () => [{ repoId: "articles-00000000", path: w.folder }] } as never);
    const bound = await bindControlSocket(buildControlSocketApp({ store: w.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service }, undefined, auth), join(root, "control.sock"));
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}`);
    cleanups.push(() => bound.close());

    type Answer = { code: number | null; body: { result?: Record<string, unknown>; error?: { code: string } } & Record<string, unknown> };
    const orca = async (argv: string[], env: NodeJS.ProcessEnv = {}): Promise<Answer> => {
      const out: string[] = [], err: string[] = [];
      const io: CommandIo = { stdout: (t) => out.push(t), stderr: (t) => err.push(t), env: { ...process.env, ORCA_PERSON_DIR: personDir, ...env }, cwd: root, stdinIsTTY: false };
      const code = await runRegistered([...argv, "--json", "--control-state-dir", root], io);
      const text = out.join("").trim();
      if (text === "") throw new Error(`orca ${argv.join(" ")}: no output; stderr ${err.join("")}`);
      return { code, body: (JSON.parse(text) as { body: Answer["body"] }).body };
    };
    const ok = async (argv: string[]): Promise<Answer["body"]> => {
      const answer = await orca(argv);
      expect(answer.code, `orca ${argv.join(" ")} answered ${JSON.stringify(answer.body)}`).toBe(0);
      return answer.body;
    };
    const refused = async (argv: string[], code: string): Promise<void> => {
      const answer = await orca(argv);
      expect(answer.code, `orca ${argv.join(" ")}`).not.toBe(0);
      expect(answer.body.error?.code ?? (answer.body as { code?: string }).code).toBe(code);
    };

    // The agent starts the run on the folder and reads it.
    const started = await ok(["flow", "start", "wechat-article", "--dir", w.folder, "--param", "idea=Tea for engineers"]);
    expect(started.result).toMatchObject({ kind: "flow-started" });
    const flowRunId = String(started.result!.flowRunId);
    expect(await ok(["flow", "show", flowRunId.slice(0, 10)])).toMatchObject({ flowRunId, state: "running", templateRef: "builtin/wechat-article" });
    // The fake agents work until the article step asks the person a question.
    await untilArticleAsks(world, flowRunId);
    expect((await ok(["flow", "show", flowRunId])).openAsks).toEqual([expect.objectContaining({ stepKey: "article" })]);

    // The first human-only act: the agent cannot answer for the person; the person (token) can.
    await refused(["flow", "answer", flowRunId, "article", "--text", "plain"], "control-person-token-required");
    expect(await ok(["flow", "answer", flowRunId, "article", "--text", "plain", "--as-person"])).toMatchObject({ result: { kind: "flow-answered", answer: "needs" } });
    await articleToDraftBox(world, flowRunId);
    expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");

    // Feedback and a plan are the agent's to send; running the plan is the person's.
    expect(await ok(["flow", "feedback", flowRunId, "--step", "voice", "--text", "Warmer, please."])).toMatchObject({ result: { kind: "flow-message-stored", state: "applied" } });
    expect(await ok(["flow", "plan", flowRunId])).toMatchObject({ result: { kind: "flow-plan-made", planNo: 2 } });
    await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [{ stepKey: "cover", reason: "Same subject and title." }] });
    expect(listPlans(w.store, flowRunId).at(-1)).toMatchObject({ planNo: 2, state: "proposed" });
    await refused(["flow", "rerun", flowRunId, "--skip", "cover,pick-title"], "control-person-token-required");
    // A dispatched run is refused before anything is sent, token or not.
    const marked = await orca(["flow", "rerun", flowRunId, "--skip", "cover,pick-title", "--as-person"], { [DISPATCHED_RUN_ENV]: "run-1" });
    expect(marked.code).not.toBe(0);
    // The person makes the draft box stage-only, then runs the plan.
    await ok(["flow", "settings", "set", "effects.external", "stage-only", "--global", "--as-person"]);
    expect(await ok(["flow", "rerun", flowRunId, "--skip", "cover,pick-title", "--as-person"])).toMatchObject({ result: { kind: "flow-plan-run", planNo: 2 } });
    children.land(child(flowRunId, "voice", 2), { [`${SLUG}.md`]: "# Tea\n\nTea slows you down, gently.\n" });
    await w.advance();
    children.land(child(flowRunId, "finetune", 2), { [WECHAT]: "---\ntitle: Draft title\nauthor: Ann\ndigest: d\n---\n\nWarm.\n" });
    await w.advance();
    children.land(child(flowRunId, "article", 3), { [`${SLUG}.wechat.html`]: "<p>Tea, gently</p>\n" });
    await w.advance();
    const staged = listEffects(w.store, flowRunId).filter((r) => r.stepKey === "to-draft-box").at(-1)!;
    expect(staged).toMatchObject({ state: "staged", level: "stage-only" });
    expect(children.opened.has(child(flowRunId, "to-draft-box", 2))).toBe(false);

    // C13's CLI half: the agent may not enact; a dispatched run may not even with the token; the person enacts once.
    await refused(["flow", "effect", "enact", staged.id], "control-person-token-required");
    const raw = await overSocket(join(root, "control.sock"), "POST", "/api/control/flows/effect",
      { "x-orca-client": "cli", "x-orca-dispatched-run": "run-1", "x-orca-person-token": login.token },
      { commandId: "fva-dispatched-enact", expectedRevision: 0, payload: { recordId: staged.id, action: "enact" } });
    expect([raw.status, JSON.parse(raw.text).error.code]).toEqual([403, "control-dispatched-run-refused"]);
    expect(await ok(["flow", "effect", "enact", staged.id, "--as-person"])).toMatchObject({ result: { kind: "flow-effect-done", state: "running" } });
    children.land(child(flowRunId, "to-draft-box", 2), {}, { flow: { effect: { remoteId: "media-2" } } });
    await w.advance();
    expect(listEffects(w.store, flowRunId).find((r) => r.id === staged.id)).toMatchObject({ state: "applied", remoteRef: "media-2" });
    await refused(["flow", "effect", "enact", staged.id, "--as-person"], "flow-effect-closed");
    expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
  });
});
