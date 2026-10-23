import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import type { ControlStore } from "../../src/control/store.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { attachmentPath, attachmentsDir } from "../../src/flow/feedback/attachments.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { IMAGE_PARAM_MAX_BYTES } from "../../src/flow/params.js";
import { readFlowSettings } from "../../src/flow/settings.js";
import { applySetFlowSettings } from "../../src/flow/settingsCommands.js";
import { FLOW_LOCKABLE_PATHS } from "../../src/flow/settingsSchema.js";
import { getFlowRun, listEffects, listPlans } from "../../src/flow/store.js";
import type { PlanCandidates } from "../../src/flow/rerun.js";
import { flowWorld } from "./fixtures/flowWorld.js";
import { SLUG, TITLES, WECHAT, wechatFile, wechatWorld, zeroRound } from "./fixtures/wechatWorld.js";

/**
 * Gaps spec §8 (G8): the `image` param, preset defaults and a mid-run `params` change, on a small template and on the
 * built-in `wechat-article` (version 3) over fake agents. An image is checked by its extension, size, existence and --
 * what a name cannot fake -- its bytes; it is stored content-addressed (the §4.7 store) and the params identity takes the
 * bytes' hash, so other bytes at the same path make dependants candidates and the same bytes under a new path do not.
 * Only a settings preset may name an absolute image; as built (spec §21 entry 3) such a path cannot reach a step's
 * workspace, so the step that would use it is refused by name before it starts.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const mode = (path: string): number => statSync(path).mode & 0o777;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const tempRoot = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), "orca-g8-"))); cleanups.push(() => rmSync(d, { recursive: true, force: true })); return d; };

const TPL = {
  yaml: "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nparams:\n  pic: {type: image, required: false}\n  tone: {type: text, default: plain}\nsteps:\n  - {id: use, kind: draft, prompt: u.md}\n",
  assets: { "u.md": "Use '{{param.pic}}' in a {{param.tone}} tone.\n" },
};
async function smallWorld() {
  const w = await flowWorld({ t: TPL });
  cleanups.push(() => w.dispose());
  w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
  return w;
}
const refusalOf = async (p: Promise<unknown>): Promise<string> => p.then(() => "started", (error: { code?: string; message: string }) => error.code ?? error.message);
const global = (store: ControlStore, flows: Record<string, unknown>) => store.transaction(() => writeOrchestrationSettings(store, { maxRunningGroups: 3, flows }, orchestrationRevision(store) + 1));
const project = (store: ControlStore, flows: Record<string, unknown>) => store.transaction(() => writeRepositorySettingsBody(store, "repo", { workspaceMode: "worktree", revision: (readRepositorySettingsBody(store, "repo")?.revision ?? 0) + 1, flows } as never));
const bodyOf = (store: ControlStore, id: string) => getFlowRun(store, id)!.body as { params: Record<string, unknown>; images?: Record<string, { source: string; sha256: string; ext: string }> };

describe("the image param type (§8.1)", () => {
  it("is checked at start by extension, size, existence, kind of file and its bytes; a gif is accepted", async () => {
    const w = await smallWorld();
    const put = (rel: string, bytes: Buffer) => { mkdirSync(join(w.folder, rel, ".."), { recursive: true }); writeFileSync(join(w.folder, rel), bytes); };
    put("cover.bmp", PNG);
    put("text.png", Buffer.from("just text, named .png\n"));
    put("big.png", Buffer.concat([PNG, Buffer.alloc(IMAGE_PARAM_MAX_BYTES + 1 - PNG.length)]));
    put("edge.png", Buffer.concat([PNG, Buffer.alloc(IMAGE_PARAM_MAX_BYTES - PNG.length)]));
    put("a.gif", GIF);
    mkdirSync(join(w.folder, "dir.png"));
    symlinkSync(join(w.folder, "a.gif"), join(w.folder, "link.gif"));
    const start = (pic: string) => refusalOf(w.start({ templateRef: "builtin/t", params: { pic } }));
    expect(await start("cover.bmp")).toBe("flow-param-invalid:pic");
    expect(await start("missing.png")).toBe("flow-param-invalid:pic");
    // Review Focus 5's rule at start: the name says png, the bytes say text.
    expect(await start("text.png")).toBe("flow-param-invalid:pic");
    expect(await start("big.png")).toBe("flow-param-invalid:pic");
    expect(await start("dir.png")).toBe("flow-param-invalid:pic");
    expect(await start("link.gif")).toBe("flow-param-invalid:pic");
    expect(await start("../outside.png")).toBe("flow-param-invalid:pic");
    expect(await start("edge.png")).toBe("started");
    expect(await start("a.gif")).toBe("started");
    // Only refusals so far wrote nothing but the two accepted images to the store.
    expect(readFileSync(attachmentPath(w.deps.env, `${sha(GIF)}.gif`))).toEqual(GIF);
  });

  it("an absolute value at start is refused; the same value from a settings preset is accepted", async () => {
    const w = await smallWorld();
    const outside = join(tempRoot(), "preset.png");
    writeFileSync(outside, PNG);
    expect(await refusalOf(w.start({ templateRef: "builtin/t", params: { pic: outside } }))).toBe("flow-param-invalid:pic");
    global(w.store, { paramDefaults: { t: { pic: outside } } });
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    expect(bodyOf(w.store, flowRunId).images).toEqual({ pic: { source: outside, sha256: sha(PNG), ext: "png" } });
  });

  it("stores the bytes under $ORCA_CONTROL_DIR (0700/0600) and records {source, sha256, ext}; the original is only read", async () => {
    const w = await smallWorld();
    writeFileSync(join(w.folder, "cover.jpeg"), JPG);
    const original = join(w.folder, "cover.jpeg");
    const before = { bytes: readFileSync(original), mode: mode(original), mtime: statSync(original).mtimeMs };
    const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { pic: "cover.jpeg" } });
    expect(bodyOf(w.store, flowRunId).images).toEqual({ pic: { source: "cover.jpeg", sha256: sha(JPG), ext: "jpg" } });
    expect(bodyOf(w.store, flowRunId).params.pic).toBe("cover.jpeg");
    const stored = attachmentPath(w.deps.env, `${sha(JPG)}.jpg`);
    expect(readFileSync(stored)).toEqual(JPG);
    expect([mode(stored), mode(attachmentsDir(w.deps.env))]).toEqual([0o600, 0o700]);
    expect({ bytes: readFileSync(original), mode: mode(original), mtime: statSync(original).mtimeMs }).toEqual(before);
  });

  it("the params identity is the image's bytes: the same bytes under another path give the same identity, other bytes another", async () => {
    const w = await smallWorld();
    writeFileSync(join(w.folder, "a.png"), PNG);
    writeFileSync(join(w.folder, "b.png"), PNG);
    writeFileSync(join(w.folder, "c.png"), Buffer.concat([PNG, Buffer.from("other")]));
    const identity = async (pic: string) => getFlowRun(w.store, (await w.start({ templateRef: "builtin/t", params: { pic } })).flowRunId)!.paramsSha256;
    const a = await identity("a.png");
    expect(await identity("b.png")).toBe(a);
    expect(await identity("c.png")).not.toBe(a);
  });
});

describe("preset defaults (§8.2)", () => {
  it("given > project > global > template, for every param type", async () => {
    const w = await smallWorld();
    const tone = async (input: { projectId?: string; params?: Record<string, string> }) =>
      bodyOf(w.store, (await w.start({ templateRef: "builtin/t", ...input })).flowRunId).params.tone;
    expect(await tone({})).toBe("plain");
    global(w.store, { paramDefaults: { t: { tone: "global" } } });
    expect(await tone({ projectId: "repo" })).toBe("global");
    project(w.store, { paramDefaults: { t: { tone: "project" } } });
    expect(await tone({ projectId: "repo" })).toBe("project");
    expect(await tone({})).toBe("global");
    expect(await tone({ projectId: "repo", params: { tone: "given" } })).toBe("given");
  });

  it("a preset for a built-in is checked against its param's type at write time; read per entry with its source; not lockable", async () => {
    const w = await smallWorld();
    let n = 0;
    const set = (target: { kind: "orchestration" } | { kind: "repository"; repoId: string }, paramDefaults: unknown) => {
      const body = applySetFlowSettings({ store: w.store, knownRepository: (id) => id === "repo", builtinRoot: w.builtinRoot }, {
        schema: "orca-raw-command-v1", commandId: `g8-${++n}`, actorId: "owner", verb: "set-flow-settings", target, payload: { set: { paramDefaults }, clear: [] },
        expectedRevision: target.kind === "orchestration" ? orchestrationRevision(w.store) : readRepositorySettingsBody(w.store, "repo")?.revision ?? 0,
      } as never) as { error?: { code: string; message: string } };
      return body.error === undefined ? "accepted" : `${body.error.code}: ${body.error.message}`;
    };
    const GLOBAL = { kind: "orchestration" } as const, REPO = { kind: "repository", repoId: "repo" } as const;
    expect(set(GLOBAL, { t: { nope: "x" } })).toMatch(/^flow-param-invalid: .*t\.nope: not a parameter of the template/);
    expect(set(GLOBAL, { t: { pic: "/covers/cover.svg" } })).toMatch(/^flow-param-invalid: .*t\.pic: must name a png, jpg, jpeg, gif or webp file/);
    expect(set(GLOBAL, { t: { tone: 3 } })).toMatch(/^flow-param-invalid: .*t\.tone: must be text/);
    // An absolute image is the shape a preset may have; the file is read only at start (§16).
    expect(set(GLOBAL, { t: { pic: "/covers/default-cover.png", tone: "warm" } })).toBe("accepted");
    expect(set(REPO, { t: { tone: "project" } })).toBe("accepted");
    // A template that is not a built-in is checked at start instead.
    expect(set(GLOBAL, { other: { anything: 1 } })).toBe("accepted");
    expect(readFlowSettings(w.store, "repo").paramDefaults).toEqual({
      other: { anything: { value: 1, source: "global", lockedBy: null } },
      t: { pic: { value: "/covers/default-cover.png", source: "global", lockedBy: null }, tone: { value: "project", source: "project", lockedBy: null } },
    });
    expect(FLOW_LOCKABLE_PATHS.some((path) => path.startsWith("paramDefaults"))).toBe(false);
  });
});

/** The built-in run with a cover image given (or preset): `cover` is skipped by its `when`; returns the run id. */
async function wechatRun(world: Awaited<ReturnType<typeof wechatWorld>>, params: Record<string, string>): Promise<string> {
  const { w, children } = world;
  const { flowRunId } = await w.start({ templateRef: "builtin/wechat-article", params: { idea: "Tea for engineers", ...params } });
  await w.advance();
  await w.answer(0, zeroRound);
  const land = async (stepKey: string, files: Record<string, string>, extra = {}) => { children.land(childGroupIdOf(flowRunId, stepKey, 1), files, extra); await w.advance(); };
  await land("outline", { [`${SLUG}.outline.md`]: "# Tea\n## Why\n" });
  await w.answer(1, { candidates: {} });
  await land("draft", { [`${SLUG}.md`]: "# Tea\n\nTea slows you down.\n" });
  await land("deslop", { [`${SLUG}.md`]: "# Tea\n\nTea slows you.\n" });
  await land("voice", { [`${SLUG}.md`]: "# Tea\n\nTea slows you down a bit.\n" });
  await land("finetune", { [WECHAT]: wechatFile("Draft title", "Drink it.") }, { flow: { candidates: { title: TITLES } } });
  if (children.opened.has(childGroupIdOf(flowRunId, "cover", 1))) {
    await land("cover", { "assets/wechat/00-cover.jpg": "jpg\n", "assets/wechat/00-cover.final.txt": "assets/wechat/00-cover.jpg\n" }, { flow: { effect: { remoteId: "assets/wechat/00-cover.jpg" } } });
  }
  await land("article", { [`${SLUG}.wechat.html`]: "<p>Tea</p>\n" });
  return flowRunId;
}
const goalOf = (world: Awaited<ReturnType<typeof wechatWorld>>, id: string): string =>
  JSON.parse(world.children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
async function wechat() {
  const world = await wechatWorld();
  cleanups.push(() => world.w.dispose());
  world.w.deps.env.ORCA_CONTROL_DIR = join(world.w.root, "control");
  return world;
}

describe("the cover image on wechat-article v3 (§8.1, §8.5)", { timeout: 60_000 }, () => {
  it("a folder cover skips `cover` by its when; the draft box's prompt names the folder-relative path, and the file is in the base the attempt opens from", async () => {
    const world = await wechat();
    const { w } = world;
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const flowRunId = await wechatRun(world, { coverImage: "cover.png" });
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped", seq: 1 });
    expect(world.children.opened.has(childGroupIdOf(flowRunId, "cover", 1))).toBe(false);
    const box = childGroupIdOf(flowRunId, "to-draft-box", 1);
    expect(goalOf(world, box)).toContain("the person's cover 'cover.png'");
    // ccloop builds the attempt from the run workspace's HEAD, which is this base: the cover reaches the agent as a file
    // of the person's folder, as a `path` param's file did in version 2.
    const base = world.children.opened.get(box)!.baseCommit;
    const vault = (getFlowRun(w.store, flowRunId)!.body as { vaultPath: string }).vaultPath;
    expect(execFileSync("/usr/bin/git", ["--git-dir", vault, "cat-file", "blob", `${base}:cover.png`])).toEqual(PNG);
  });

  it("an absolute preset cover is refused at the draft box by name: no effect record, no child, the path never in a prompt", async () => {
    const world = await wechat();
    const { w } = world;
    const preset = join(tempRoot(), "default-cover.png");
    writeFileSync(preset, PNG);
    global(w.store, { paramDefaults: { "wechat-article": { coverImage: preset } } });
    const flowRunId = await wechatRun(world, {});
    expect(bodyOf(w.store, flowRunId).images).toEqual({ coverImage: { source: preset, sha256: sha(PNG), ext: "png" } });
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped" });
    expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ state: "failed", body: expect.objectContaining({ failure: "flow-param-unreachable:coverImage" }) });
    expect(world.children.opened.has(childGroupIdOf(flowRunId, "to-draft-box", 1))).toBe(false);
    expect(listEffects(w.store, flowRunId).filter((e) => e.stepKey === "to-draft-box")).toEqual([]);
    expect([...world.children.opened.values()].map((o) => JSON.stringify(o.plan)).some((plan) => plan.includes(preset))).toBe(false);
  });

  it.todo("an image param is copied into the attempt workspace at .orca/params/<id>.<ext>, absent from the attempt commit and the folder -- OPEN for the human (spec §21 entries 2-3): ccloop opens attempts from the run workspace's HEAD, so Orca cannot place an untracked copy there; decide (a) an absolute path outside the workspace, which needs ccloop read access for the agent, or (b) a ccloop change that seeds files into each attempt (Rule 16). Evidence: logs/gaps/t5-g14-premise.{sh,log}");
  it.todo("{{param.coverImage}} expands to the workspace copy .orca/params/coverImage.<ext> in prompts and check commands -- OPEN for the human, same question (spec §21 entry 3)");
  it.todo("an absolute preset cover reaches md2publish-draft at the draft box (today refused flow-param-unreachable:coverImage) -- OPEN for the human, same question (spec §21 entry 3)");
});

describe("a params change mid-run (§8.3)", { timeout: 60_000 }, () => {
  const params = (world: Awaited<ReturnType<typeof wechatWorld>>, flowRunId: string, set: Record<string, unknown>, requestId: string) =>
    acceptMessage(world.w.deps, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "params", set }, by: "ann", via: "cli:test", requestId });
  const lastPlan = (world: Awaited<ReturnType<typeof wechatWorld>>, flowRunId: string) => listPlans(world.w.store, flowRunId).at(-1)!;
  const reasonsOf = (plan: ReturnType<typeof lastPlan>, stepKey: string) => (plan.candidates as PlanCandidates).list.find((c) => c.stepKey === stepKey)?.reasons ?? [];

  it("other bytes at the same path make to-draft-box a candidate (upstream-changed:params); the same bytes under a new path do not", async () => {
    const world = await wechat();
    const { w } = world;
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const flowRunId = await wechatRun(world, { coverImage: "cover.png" });
    world.children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
    const first = getFlowRun(w.store, flowRunId)!.paramsSha256;

    mkdirSync(join(w.folder, "covers"));
    copyFileSync(join(w.folder, "cover.png"), join(w.folder, "covers/same.png"));
    expect(await params(world, flowRunId, { coverImage: "covers/same.png" }, "p1")).toMatchObject({ state: "applied" });
    expect(bodyOf(w.store, flowRunId).params.coverImage).toBe("covers/same.png");
    expect(getFlowRun(w.store, flowRunId)!.paramsSha256).toBe(first);
    expect(lastPlan(world, flowRunId).candidates).toMatchObject({ trigger: "params" });
    expect(reasonsOf(lastPlan(world, flowRunId), "to-draft-box")).not.toContain("upstream-changed:params");

    const other = Buffer.concat([PNG, Buffer.from("a new cover")]);
    writeFileSync(join(w.folder, "covers/same.png"), other);
    expect(await params(world, flowRunId, { coverImage: "covers/same.png" }, "p2")).toMatchObject({ state: "applied" });
    expect(getFlowRun(w.store, flowRunId)!.paramsSha256).not.toBe(first);
    expect(bodyOf(w.store, flowRunId).images).toEqual({ coverImage: { source: "covers/same.png", sha256: sha(other), ext: "png" } });
    expect(reasonsOf(lastPlan(world, flowRunId), "to-draft-box")).toContain("upstream-changed:params");
    // `cover` is when-false with a cover image: never a candidate (F §7.2).
    expect(reasonsOf(lastPlan(world, flowRunId), "cover")).toEqual([]);
  });

  it("setting coverImage after the cover was generated: cover is not a candidate and is recorded skipped; the draft box runs again with the person's cover", async () => {
    const world = await wechat();
    const { w } = world;
    const flowRunId = await wechatRun(world, {});
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "done" });
    world.children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    writeFileSync(join(w.folder, "mine.webp"), Buffer.concat([Buffer.from("RIFF\x10\x00\x00\x00WEBP", "latin1"), Buffer.from("VP8 ")]));
    expect(await params(world, flowRunId, { coverImage: "mine.webp" }, "p1")).toMatchObject({ state: "applied" });
    const plan = lastPlan(world, flowRunId);
    expect(reasonsOf(plan, "cover")).toEqual([]);
    expect(reasonsOf(plan, "to-draft-box")).toContain("upstream-changed:params");
    // The proposal skips every candidate but the draft box. The new file in the folder is drift, taken before the draft
    // box starts, which makes a newer plan (same answer).
    for (let open = lastPlan(world, flowRunId); open.state === "proposed"; open = lastPlan(world, flowRunId)) {
      const others = (open.candidates as PlanCandidates).list.map((c) => c.stepKey).filter((k) => k !== "to-draft-box");
      await w.answer(w.calls.length - 1, { skips: others.map((stepKey) => ({ stepKey, reason: "unchanged by a cover" })) });
    }
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped" });
    expect(goalOf(world, childGroupIdOf(flowRunId, "to-draft-box", 2))).toContain("the person's cover 'mine.webp'");
  });

  it("refuses a params change whose image file is not an image by its bytes", async () => {
    const world = await wechat();
    const { w } = world;
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const flowRunId = await wechatRun(world, { coverImage: "cover.png" });
    const before = getFlowRun(w.store, flowRunId)!;
    writeFileSync(join(w.folder, "cover.png"), "same name, the bytes are text now\n");
    expect(await params(world, flowRunId, { coverImage: "cover.png" }, "bad")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:coverImage" });
    const after = getFlowRun(w.store, flowRunId)!;
    expect([after.paramsSha256, after.body]).toEqual([before.paramsSha256, before.body]);
    expect(listPlans(w.store, flowRunId).filter((p) => (p.candidates as PlanCandidates).trigger === "params")).toEqual([]);
  });

  it("is checked as at start: folder-relative only, declared params, null unsets a param that is not required", async () => {
    const world = await wechat();
    const { w } = world;
    const flowRunId = await wechatRun(world, {});
    const outside = join(tempRoot(), "abs.png");
    writeFileSync(outside, PNG);
    expect(await params(world, flowRunId, { coverImage: outside }, "abs")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:coverImage" });
    expect(await params(world, flowRunId, { nope: 1 }, "nope")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:nope" });
    expect(await params(world, flowRunId, { idea: null }, "idea")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:idea" });
    expect(await params(world, flowRunId, {}, "empty")).toMatchObject({ state: "rejected", reason: "flow-message-invalid:set" });
    expect((await acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "params", set: { language: "en" }, resolved: { set: {}, unset: [], images: {} } }, by: "ann", via: "cli:test", requestId: "forged" }))).toMatchObject({ state: "rejected", reason: "flow-message-invalid:set" });
    // Taken at a boundary: once the draft box (still running) has settled.
    expect(await params(world, flowRunId, { language: "en", illustrations: true, coverImage: null }, "ok")).toMatchObject({ state: "accepted" });
    world.children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    await acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "pause" }, by: "ann", via: "cli:test", requestId: "boundary" });
    expect(w.store.db.prepare("SELECT state FROM flow_messages WHERE flow_run_id=? AND request_id='ok'").get(flowRunId)).toEqual({ state: "applied" });
    expect(bodyOf(w.store, flowRunId).params).toMatchObject({ language: "en", illustrations: true });
    expect(bodyOf(w.store, flowRunId).params).not.toHaveProperty("coverImage");
  });
});
