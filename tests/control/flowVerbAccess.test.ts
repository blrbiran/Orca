import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRegistered } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import { DISPATCHED_RUN_ENV, withCommandContext } from "../../src/control/commandClient.js";
import { WebControlService } from "../../src/control/webService.js";
import { getFlowRun, listEffects, listMessages, listPlans } from "../../src/flow/store.js";
import { bindControlSocket, buildControlSocketApp } from "../../src/panel/controlSocket.js";
import { HUMAN_ONLY_FIELDS, SOCKET_TIER, VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { REGISTRY } from "../../src/commands/registry.js";
import { commandPath } from "../../src/commands/parse.js";
import { flowAnswerPayloadSchema, flowMessagePayloadSchema, flowPlanStepPayloadSchema, setFlowSettingsPayloadSchema } from "../../src/control/webProtocol.js";
import { hasPersonAuthority, permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { marksOf } from "../../src/flow/marks.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { fakeChildPort } from "../flow/fixtures/childPort.js";
import { flowWorld } from "../flow/fixtures/flowWorld.js";
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
  // Gaps spec §13 (G10).
  "flow-plan-step": "human-only",
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

  it("G10: flow-plan-step is human-only, token for run and open for accept-unchanged; a dispatched run is refused it either way", () => {
    const step = (choice: string) => ({ runId: "fr-x", planNo: 1, stepKey: "visuals", choice });
    expect(VERB_ACCESS["flow-plan-step"]).toBe("human-only");
    expect(permissionRefusal(SOCKET, "flow-plan-step", step("run"))?.code).toBe("control-person-token-required");
    expect(permissionRefusal(SOCKET, "flow-plan-step", step("accept-unchanged"))).toBe(null);
    for (const choice of ["run", "accept-unchanged"]) {
      expect(permissionRefusal(WITH_TOKEN, "flow-plan-step", step(choice)), choice).toBe(null);
      expect(permissionRefusal(DISPATCHED, "flow-plan-step", step(choice))?.code, choice).toBe("control-dispatched-run-refused");
      expect(permissionRefusal({ kind: "agent", client: "cli", dispatchedRun: "run-1" }, "flow-plan-step", step(choice))?.code, choice).toBe("control-dispatched-run-refused");
    }
  });

  it("G10: flow-message stays any with a predicate -- a defer releasing an effect (proceed) wants the person token and is refused to a dispatched run; wait is open", () => {
    const defer = (effects: Record<string, string>) => ({ runId: "fr-x", kind: "command", target: { kind: "step", stepKey: "visuals" }, body: { command: "defer", effects } });
    expect(VERB_ACCESS["flow-message"]).toBe("any");
    expect(HUMAN_ONLY_FIELDS["flow-message"]).toBeUndefined();
    expect(typeof SOCKET_TIER["flow-message"]).toBe("function");
    expect(permissionRefusal(SOCKET, "flow-message", defer({ "to-draft-box": "proceed" }))?.code).toBe("control-person-token-required");
    expect(permissionRefusal(WITH_TOKEN, "flow-message", defer({ "to-draft-box": "proceed" }))).toBe(null);
    expect(permissionRefusal(DISPATCHED, "flow-message", defer({ "to-draft-box": "proceed" }))?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal({ kind: "agent", client: "cli", dispatchedRun: "run-1" }, "flow-message", defer({ "to-draft-box": "proceed" }))?.code).toBe("control-dispatched-run-refused");
    for (const p of [SOCKET, WITH_TOKEN, DISPATCHED]) expect(permissionRefusal(p, "flow-message", defer({ "to-draft-box": "wait" }))).toBe(null);
  });

  it("G10: every §13 command has its registry row, verb and access; its payload is one the verb's schema accepts", () => {
    const row = (path: string) => REGISTRY.find((def) => commandPath(def) === path);
    const RUN = "fr-00000000-0000-4000-8000-000000000001";
    const rows: Array<[string, string, "open" | "token", string[]]> = [
      ["flow feedback", "flow-message", "open", ["step", "quote", "heading", "paragraph", "attach", "replaces", "hit", "as-is", "text"]],
      ["flow answer", "flow-answer", "token", ["feedback", "file", "consensus"]],
      ["flow include", "flow-plan-step", "token", ["step", "plan"]],
      ["flow accept", "flow-plan-step", "open", ["step", "plan"]],
      ["flow skip", "flow-message", "open", ["step"]],
      ["flow defer", "flow-message", "open", ["step", "effects"]],
      ["flow fill", "flow-message", "open", ["step"]],
      ["flow params", "flow-message", "open", ["set"]],
      ["flow revise", "flow-message", "open", ["step", "round", "file"]],
      ["flow settings set", "set-flow-settings", "token", []],
    ];
    for (const [path, verb, access, flags] of rows) {
      const def = row(path);
      expect(def, path).toBeDefined();
      expect(def!.mapsTo.kind === "verb" ? def!.mapsTo.verb : null, path).toBe(verb);
      expect(def!.access, path).toBe(access);
      expect(def!.flags.map((f) => f.name), path).toEqual(expect.arrayContaining(flags));
    }
    expect(row("flow settings set")!.positionals[0]!.summary).toContain("rerunAskTimeoutSeconds");
    expect(row("flow settings set")!.positionals[0]!.summary).toContain("paramDefaults.<template>.<param>");
    expect(flowPlanStepPayloadSchema.safeParse({ runId: RUN, planNo: 2, stepKey: "visuals", choice: "run" }).success).toBe(true);
    expect(flowPlanStepPayloadSchema.safeParse({ runId: RUN, planNo: 2, stepKey: "visuals", choice: "accept-unchanged" }).success).toBe(true);
    expect(flowPlanStepPayloadSchema.safeParse({ runId: RUN, planNo: 2, stepKey: "visuals", choice: "skip" }).success).toBe(false);
    expect(flowAnswerPayloadSchema.safeParse({ runId: RUN, feedback: 3, consensus: true }).success).toBe(true);
    expect(flowAnswerPayloadSchema.safeParse({ runId: RUN, feedback: 3, clarify: { roundNo: 1, answers: [{ id: "R1.Q1", kind: "recommended" }], glossaryDecisions: [], adrDecisions: [] } }).success).toBe(true);
    expect(flowMessagePayloadSchema.safeParse({ runId: RUN, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 1 }, body: {} }).success).toBe(true);
    expect(setFlowSettingsPayloadSchema.safeParse({ set: { rerunAskTimeoutSeconds: 600, paramDefaults: { "wechat-article": { coverImage: "/c.png" } } }, clear: ["paramDefaults.wechat-article.coverImage"] }).success).toBe(true);
  });

  it("an agent's walk on orca flow commands drives the article flow to its first human-only act; the person's token carries it on", { timeout: 120_000 }, async () => {
    const world = await wechatWorld();
    cleanups.push(() => world.w.dispose());
    const { w, children, child } = world;
    // The person's checklist (`rerunReview: review`); the built-in default is `auto` since gaps spec §5.2.
    w.deps.rerunReview = () => "review";
    // A short root: the socket path is capped at ~104 bytes.
    const root = realpathSync(mkdtempSync("/tmp/fva-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    // Rule 17: the attachment store (gaps §4.7) is under the flow env's ORCA_CONTROL_DIR; never the real ~/.orca.
    w.deps.env.ORCA_CONTROL_DIR = join(root, "control");
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

    // Gaps spec §4.7, §13: the agent's feedback with a screenshot -- the CLI uploads it over the socket first, then sends
    // the message naming it; a file that is not an image is refused before any message is sent.
    writeFileSync(join(root, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
    writeFileSync(join(root, "notes.txt"), "not an image\n");
    const messages = () => listMessages(w.store, flowRunId).length;
    const before = messages();
    await refused(["flow", "feedback", flowRunId, "--attach", join(root, "notes.txt"), "--text", "this bit"], "flow-attachment-invalid");
    expect(messages()).toBe(before);
    const sent = await ok(["flow", "feedback", flowRunId, "--attach", join(root, "shot.png"), "--quote", "Tea, gently", "--text", "this bit"]);
    expect(sent.result).toMatchObject({ kind: "flow-message-stored", state: "accepted" });
    const stored = listMessages(w.store, flowRunId).at(-1)!;
    expect(stored.body).toMatchObject({ text: "this bit", anchors: [{ quote: "Tea, gently" }], attachments: [expect.stringMatching(/^[0-9a-f]{64}\.png$/)] });
    expect(readdirSync(join(root, "control", "flow-attachments"))).toEqual([(stored.body as { attachments: string[] }).attachments[0]]);
  });

  it("person authority (Task 9 fix round): an owner on the Web or an owner's token on the socket; never a member, an agent without a token, or a dispatched run", () => {
    const MEMBER = { userId: "m", name: "mia", roles: ["member"] as const };
    expect({
      webOwner: hasPersonAuthority({ kind: "user", ...OWNER }), webMember: hasPersonAuthority({ kind: "user", ...MEMBER }),
      socket: hasPersonAuthority(SOCKET), ownerToken: hasPersonAuthority(WITH_TOKEN), memberToken: hasPersonAuthority({ kind: "agent", client: "cli", person: MEMBER }),
      dispatchedWithToken: hasPersonAuthority(DISPATCHED), dispatched: hasPersonAuthority({ kind: "agent", client: "cli", dispatchedRun: "run-1" }),
    }).toEqual({ webOwner: true, webMember: false, socket: false, ownerToken: true, memberToken: false, dispatchedWithToken: false, dispatched: false });
  });

  /**
   * Task 9 fix round (controller's ruling; review C1, I1, M2, M3): a held external effect is released only by the person,
   * on every path -- a skip replacing the holding defer, a fill of it, a defer saying proceed. Over the real socket an
   * agent without a token, a dispatched run (token or not) and a member's token are each rejected
   * `flow-effect-needs-person` and the effect stays parked; the owner's token releases it (`defer --effects push=proceed`).
   * The Web: an owner's command succeeds, a member's is rejected (the routes record hasPersonAuthority).
   */
  it("releasing a held effect over the socket: skip and fill refused to an agent, a dispatched run and a member; the owner's proceed releases it", { timeout: 120_000 }, async () => {
    const TPL = { yaml: "format: orca-flow-v1\nid: e\nworkspace: {kind: dir}\neffects:\n  wechat-draft: {class: external}\nsteps:\n  - {id: write, kind: draft, prompt: write.md}\n  - {id: push, kind: work, prompt: push.md, effect: wechat-draft}\n",
      assets: { "write.md": "Write.\n", "push.md": "Push it.\n" } };
    const children = fakeChildPort();
    const w = await flowWorld({ e: TPL }, { children: children.port });
    cleanups.push(() => w.dispose());
    const root = realpathSync(mkdtempSync("/tmp/fvr-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const auth = quietPanelAuth(root);
    const personDir = (name: string, role: "owner" | "member") => {
      seedUser(root, name, role);
      const login = auth.personLogin(name, TEST_PASSWORD, auth.nowMs());
      if (!login.ok) throw new Error("person login failed");
      const dir = join(root, `person-${name}`);
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, "token.json"), JSON.stringify({ schema: "orca-person-token-v1", token: login.token, sid: login.sid, user: name, expiresAt: login.expiresAt }), { mode: 0o600 });
      return dir;
    };
    const owner = personDir("tester", "owner"), member = personDir("mia", "member");
    const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, knownRepository: () => false, flowDeps: () => w.deps } as never);
    const bound = await bindControlSocket(buildControlSocketApp({ store: w.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service }, undefined, auth), join(root, "control.sock"));
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}`);
    cleanups.push(() => bound.close());
    const orca = async (argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; body: { result?: Record<string, unknown>; error?: { code: string } } }> => {
      const out: string[] = [];
      const io: CommandIo = { stdout: (t) => out.push(t), stderr: () => undefined, env: { ...process.env, ORCA_PERSON_DIR: owner, ...env }, cwd: root, stdinIsTTY: false };
      const code = await runRegistered([...argv, "--json", "--control-state-dir", root], io);
      return { code, body: (JSON.parse(out.join("").trim()) as { body: { result?: Record<string, unknown>; error?: { code: string } } }).body };
    };
    const { flowRunId } = await w.start({ templateRef: "builtin/e" });
    await w.advance();
    // The agent defers `write` (wait: open) while its call is out; at the boundary the push is held, parked when reached.
    expect((await orca(["flow", "defer", flowRunId, "--step", "write"])).body.result).toMatchObject({ kind: "flow-message-stored", held: ["push"] });
    await w.answer(0, { content: "w 1" });
    const push = () => w.execs(flowRunId, "push").map((e) => e.state);
    expect(push()).toEqual(["parked"]);
    const rejected = async (argv: string[], env: NodeJS.ProcessEnv = {}) => {
      const answer = await orca(argv, env);
      expect(answer.body.result, argv.join(" ")).toMatchObject({ kind: "flow-message-stored", state: "rejected", reason: "flow-effect-needs-person" });
      expect(push()).toEqual(["parked"]);
      expect(marksOf(listMessages(w.store, flowRunId)).get("write")).toMatchObject({ kind: "defer" });
    };
    const DISPATCHED_ENV = { [DISPATCHED_RUN_ENV]: "run-1" };
    for (const action of ["skip", "fill"]) {
      await rejected(["flow", action, flowRunId, "--step", "write"]);
      await rejected(["flow", action, flowRunId, "--step", "write"], DISPATCHED_ENV);
      await rejected(["flow", action, flowRunId, "--step", "write", "--as-person"], { ORCA_PERSON_DIR: member });
    }
    // A member's token passes the socket gate for proceed (an `any` verb) but the kernel rejects it; a dispatched run is refused at the gate.
    await rejected(["flow", "defer", flowRunId, "--step", "write", "--effects", "push=proceed", "--as-person"], { ORCA_PERSON_DIR: member });
    expect((await orca(["flow", "defer", flowRunId, "--step", "write", "--effects", "push=proceed", "--as-person"], DISPATCHED_ENV)).code).not.toBe(0);
    // The Web: a member's skip is rejected, as on the socket (the route records hasPersonAuthority).
    const web = async (p: Principal, id: string, body: Record<string, unknown>) => withCommandContext(id, { client: "web", principal: "web", attribution: { by: "x", via: "web" }, personAuthority: hasPersonAuthority(p) },
      () => service.flowCommand({ schema: "orca-raw-command-v1", commandId: id, actorId: "owner", expectedRevision: 0, verb: "flow-message", target: { kind: "flows" },
        payload: { runId: flowRunId, kind: "command", target: { kind: "step", stepKey: "write" }, body } } as never)) as Promise<{ result?: Record<string, unknown> }>;
    expect((await web({ kind: "user", userId: "m", name: "mia", roles: ["member"] }, "web-member-skip", { command: "skip" })).result).toMatchObject({ state: "rejected", reason: "flow-effect-needs-person" });
    expect(push()).toEqual(["parked"]);
    // M3: the person's token over the socket releases it -- it starts afresh and its own level gate applies (apply-flag).
    expect((await orca(["flow", "defer", flowRunId, "--step", "write", "--effects", "push=proceed", "--as-person"])).body.result).toMatchObject({ state: "applied" });
    expect(push()).toEqual(["skipped", "running"]);
    expect(children.opened.has(childGroupIdOf(flowRunId, "push", 2))).toBe(true);
  });

  it("a Web owner releases a held effect with a skip (person authority recorded by the route)", { timeout: 60_000 }, async () => {
    const TPL = { yaml: "format: orca-flow-v1\nid: e\nworkspace: {kind: dir}\neffects:\n  wechat-draft: {class: external}\nsteps:\n  - {id: write, kind: draft, prompt: write.md}\n  - {id: push, kind: work, prompt: push.md, effect: wechat-draft}\n",
      assets: { "write.md": "Write.\n", "push.md": "Push it.\n" } };
    const w = await flowWorld({ e: TPL }, { children: fakeChildPort().port });
    cleanups.push(() => w.dispose());
    const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps } as never);
    const { flowRunId } = await w.start({ templateRef: "builtin/e" });
    await w.advance();
    const send = (id: string, body: Record<string, unknown>) => withCommandContext(id, { client: "web", principal: "web", attribution: { by: "tester", via: "web" }, personAuthority: hasPersonAuthority({ kind: "user", ...OWNER }) },
      () => service.flowCommand({ schema: "orca-raw-command-v1", commandId: id, actorId: "owner", expectedRevision: 0, verb: "flow-message", target: { kind: "flows" },
        payload: { runId: flowRunId, kind: "command", target: { kind: "step", stepKey: "write" }, body } } as never)) as Promise<{ result?: Record<string, unknown> }>;
    await send("o-defer", { command: "defer" });
    await w.answer(0, { content: "w 1" });
    expect(w.execs(flowRunId, "push").map((e) => e.state)).toEqual(["parked"]);
    expect((await send("o-skip", { command: "skip" })).result).toMatchObject({ state: "applied" });
    expect(w.execs(flowRunId, "push").map((e) => e.state)).toEqual(["skipped", "running"]);
  });
});
