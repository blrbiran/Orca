import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
import { seedBuiltinTemplates } from "../../src/flow/builtins.js";
import { loadRun } from "../../src/flow/kernel.js";
import { readFlowSettings } from "../../src/flow/settings.js";
import { applySetFlowSettings } from "../../src/flow/settingsCommands.js";
import { FLOW_LOCKABLE_PATHS } from "../../src/flow/settingsSchema.js";
import { getFlowRun, listEffects, listPlans } from "../../src/flow/store.js";
import type { PlanCandidates } from "../../src/flow/rerun.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";
import { SLUG, TITLES, WECHAT, wechatFile, wechatWorld, zeroRound } from "./fixtures/wechatWorld.js";

/**
 * Gaps spec §8 (G8): the `image` param, preset defaults and a mid-run `params` change, on a small template and on the
 * built-in `wechat-article` (version 3) over fake agents. An image is checked by its extension, size, existence and --
 * what a name cannot fake -- its bytes; it is stored content-addressed (the §4.7 store) and the params identity takes the
 * bytes' hash, so other bytes at the same path make dependants candidates and the same bytes under a new path do not.
 * Only a settings preset may name an absolute image. Whatever the value, a step sees the stored copy's absolute path
 * (spec §21 entry 4, the human's choice (a)), never the path as given.
 */
/** Version 2 of the built-in as it shipped at 9170f9ed (a fixture copy: the repository now ships version 3). */
const V2_YAML = join(import.meta.dirname, "fixtures", "wechat-article-v2.template.yaml");
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
    // A parent directory that is a link reaches outside the folder (review fix 1, Important 1).
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "a.gif"), GIF);
    symlinkSync(elsewhere, join(w.folder, "linkdir"));
    const start = (pic: string) => refusalOf(w.start({ templateRef: "builtin/t", params: { pic } }));
    expect(await start("cover.bmp")).toBe("flow-param-invalid:pic");
    expect(await start("missing.png")).toBe("flow-param-invalid:pic");
    // Review Focus 5's rule at start: the name says png, the bytes say text.
    expect(await start("text.png")).toBe("flow-param-invalid:pic");
    expect(await start("big.png")).toBe("flow-param-invalid:pic");
    expect(await start("dir.png")).toBe("flow-param-invalid:pic");
    expect(await start("link.gif")).toBe("flow-param-invalid:pic");
    expect(await start("../outside.png")).toBe("flow-param-invalid:pic");
    expect(await start("linkdir/a.gif")).toBe("flow-param-invalid:pic");
    expect(await start("edge.png")).toBe("started");
    expect(await start("a.gif")).toBe("started");
    // The refusals stored nothing: the store holds exactly the two accepted images.
    const edge = readFileSync(join(w.folder, "edge.png"));
    expect(readdirSync(attachmentsDir(w.deps.env)).sort()).toEqual([`${sha(edge)}.png`, `${sha(GIF)}.gif`].sort());
    expect(readFileSync(attachmentPath(w.deps.env, `${sha(GIF)}.gif`))).toEqual(GIF);
  });

  it("a start refused after its image was read (here: no agent for its role) stores nothing", async () => {
    const w = await flowWorld({ t: { yaml: TPL.yaml.replace("steps:\n", "roles:\n  writer: {tier: high}\nsteps:\n").replace("{id: use, kind: draft, prompt: u.md}", "{id: use, kind: draft, role: writer, prompt: u.md}"), assets: TPL.assets } }, { agents: [] });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
    writeFileSync(join(w.folder, "pic.png"), PNG);
    expect(await refusalOf(w.start({ templateRef: "builtin/t", params: { pic: "pic.png" } }))).toBe("role-unresolved:writer");
    expect(existsSync(attachmentsDir(w.deps.env)) ? readdirSync(attachmentsDir(w.deps.env)) : []).toEqual([]);
  });

  // Re-review fix 2: open() runs before the regular-file check; a FIFO must not block the panel's thread there.
  it.skipIf(!existsSync("/usr/bin/mkfifo"))("a FIFO, in the folder or as a preset, is refused without blocking (needs /usr/bin/mkfifo)", async () => {
    const w = await smallWorld();
    execFileSync("/usr/bin/mkfifo", [join(w.folder, "pipe.png")]);
    expect(await refusalOf(w.start({ templateRef: "builtin/t", params: { pic: "pipe.png" } }))).toBe("flow-param-invalid:pic");
    const preset = join(tempRoot(), "preset.png");
    execFileSync("/usr/bin/mkfifo", [preset]);
    global(w.store, { paramDefaults: { t: { pic: preset } } });
    expect(await refusalOf(w.start({ templateRef: "builtin/t" }))).toBe("flow-param-invalid:pic");
  });

  it("a start whose folder import refuses stores nothing", async () => {
    const w = await smallWorld();
    writeFileSync(join(w.folder, "pic.png"), PNG);
    // The vault root is a file: openVault refuses after every param check passed.
    const notADir = join(w.root, "vault-is-a-file");
    writeFileSync(notADir, "x");
    w.deps.env.ORCA_VAULT_DIR = notADir;
    expect(await refusalOf(w.start({ templateRef: "builtin/t", params: { pic: "pic.png" } }))).not.toBe("started");
    expect(existsSync(attachmentsDir(w.deps.env)) ? readdirSync(attachmentsDir(w.deps.env)) : []).toEqual([]);
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

/**
 * §8.1 "always a copy", as built after the human's choice (a) (spec §21 entry 4): in a `work` step's prompt and in
 * commands, `{{param.<id>}}` of an image expands to the absolute path of its stored copy,
 * `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>` -- the bytes that were hashed -- whether the value was
 * folder-relative or a preset. Single calls (draft, review, ask) keep names only (controller ruling, Task 6b fix 1):
 * their prompts carry the value as given, never the store path.
 */
describe("{{param.<id>}} of an image is its stored copy's absolute path (§8.1, §21 entry 4)", () => {
  const storedOf = (env: NodeJS.ProcessEnv, bytes: Buffer, ext: string) => attachmentPath(env, `${sha(bytes)}.${ext}`);

  it("a single call (draft) gets the value as given, folder-relative or preset -- never the store path", async () => {
    const w = await smallWorld();
    writeFileSync(join(w.folder, "cover.png"), PNG);
    await w.start({ templateRef: "builtin/t", params: { pic: "cover.png" } });
    await w.advance();
    const folderPrompt = w.calls.at(-1)!.prompt;
    expect(w.calls.at(-1)!.purpose).toBe("flow-draft");
    expect(folderPrompt).toContain("Use 'cover.png' in a plain tone.");
    expect(folderPrompt).not.toContain(w.deps.env.ORCA_CONTROL_DIR!);
    // The bytes are stored all the same.
    expect(sha(readFileSync(storedOf(w.deps.env, PNG, "png")))).toBe(sha(PNG));

    const preset = join(tempRoot(), "default-cover.jpg");
    writeFileSync(preset, JPG);
    global(w.store, { paramDefaults: { t: { pic: preset } } });
    await w.start({ templateRef: "builtin/t" });
    await w.advance();
    const presetPrompt = w.calls.at(-1)!.prompt;
    expect(presetPrompt).toContain(`Use '${preset}' in a plain tone.`);
    expect(presetPrompt).not.toContain(w.deps.env.ORCA_CONTROL_DIR!);
  });

  it("a work step's prompt, gates and tool rules, and a check command, expand to the store path", async () => {
    const commands: string[] = [];
    const yaml = "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nparams:\n  pic: {type: image, required: false}\nsteps:\n"
      + "  - id: look\n    kind: check\n    acceptance:\n      checks:\n        - {id: there, run: \"test -s '{{param.pic}}'\", role: gate}\n"
      + "  - id: up\n    kind: work\n    prompt: up.md\n    tools: {commands: [{prefix: \"cp '{{param.pic}}'\"}]}\n    acceptance:\n      checks:\n        - {run: \"test -s '{{param.pic}}'\", role: gate}\n";
    const children = fakeChildPort();
    const w = await flowWorld({ t: { yaml, assets: { "up.md": "Upload {{param.pic}}.\n" } } }, {
      children: children.port, runCommand: async (command) => { commands.push(command); return { exitCode: 0, output: "" }; },
    });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
    writeFileSync(join(w.folder, "pic.gif"), GIF);
    const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { pic: "pic.gif" } });
    await w.advance();
    const stored = storedOf(w.deps.env, GIF, "gif");
    expect(commands).toEqual([`test -s '${stored}'`]);
    const opened = children.opened.get(childGroupIdOf(flowRunId, "up", 1))!;
    const goal = JSON.parse(opened.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
    expect(goal).toContain(`Upload ${stored}.`);
    expect(goal).toContain(`gate: test -s '${stored}'`);
    expect(JSON.stringify(opened.plan)).toContain(`cp '${stored}'`);
    expect(JSON.stringify(opened.plan)).not.toContain("'pic.gif'");
    expect(readFileSync(stored)).toEqual(GIF);
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
    // A built-in that fails to load is refused by name, not skipped as if it were absent.
    mkdirSync(join(w.builtinRoot, "broken"));
    writeFileSync(join(w.builtinRoot, "broken", "template.yaml"), "format: orca-flow-v1\nid: broken\nsteps: []\n");
    expect(set(GLOBAL, { broken: { x: 1 } })).toMatch(/^flow-template-invalid: /);
    // A template that is not a built-in is checked at start instead.
    expect(set(GLOBAL, { other: { anything: 1 } })).toBe("accepted");
    expect(readFlowSettings(w.store, "repo").paramDefaults).toEqual({
      other: { anything: { value: 1, source: "global", lockedBy: null } },
      t: { pic: { value: "/covers/default-cover.png", source: "global", lockedBy: null }, tone: { value: "project", source: "project", lockedBy: null } },
    });
    // A template with no preset leaves no empty entry behind (here: nothing changes at all).
    expect(set(GLOBAL, { zzz: {} })).toMatch(/^no-op-command/);
    expect(Object.keys(readFlowSettings(w.store, null).paramDefaults)).toEqual(["other", "t"]);
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
  /** The draft box landed; neither its attempt commit, the vault head nor the folder holds the stored copy (§2.3). */
  async function landBoxAndGuard(world: Awaited<ReturnType<typeof wechatWorld>>, flowRunId: string, stored: string): Promise<void> {
    const { w } = world;
    const landed = world.children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ state: "done" });
    const vault = (getFlowRun(w.store, flowRunId)!.body as { vaultPath: string }).vaultPath;
    const git = (...args: string[]) => execFileSync("/usr/bin/git", ["--git-dir", vault, ...args], { encoding: "utf8" });
    const name = stored.split("/").at(-1)!;
    const holds = (listing: string) => listing.includes(name) || listing.includes("flow-attachments") || listing.includes(".orca/");
    expect(holds(git("ls-tree", "-r", "--name-only", landed))).toBe(false);
    expect(holds(git("ls-tree", "-r", "--name-only", `refs/orca/${flowRunId}/head`))).toBe(false);
    expect(holds(readdirSync(w.folder, { recursive: true }).map(String).join("\n"))).toBe(false);
  }

  it("a folder cover skips `cover` by its when; the draft box's prompt names the stored copy's absolute path, never the folder path", async () => {
    const world = await wechat();
    const { w } = world;
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const flowRunId = await wechatRun(world, { coverImage: "cover.png" });
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped", seq: 1 });
    expect(world.children.opened.has(childGroupIdOf(flowRunId, "cover", 1))).toBe(false);
    const stored = attachmentPath(w.deps.env, `${sha(PNG)}.png`);
    const goal = goalOf(world, childGroupIdOf(flowRunId, "to-draft-box", 1));
    expect(goal).toContain(`the person's cover '${stored}'`);
    expect(goal).not.toContain("'cover.png'");
    expect(sha(readFileSync(stored))).toBe(sha(PNG));
    await landBoxAndGuard(world, flowRunId, stored);
  });

  it("an absolute preset cover reaches md2publish-draft at the draft box as the stored copy: effect gated, child opened, the preset path never in a prompt", async () => {
    const world = await wechat();
    const { w } = world;
    const preset = join(tempRoot(), "default-cover.png");
    writeFileSync(preset, PNG);
    global(w.store, { paramDefaults: { "wechat-article": { coverImage: preset } } });
    const flowRunId = await wechatRun(world, {});
    expect(bodyOf(w.store, flowRunId).images).toEqual({ coverImage: { source: preset, sha256: sha(PNG), ext: "png" } });
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped" });
    expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ state: "running" });
    expect(listEffects(w.store, flowRunId).filter((e) => e.stepKey === "to-draft-box")).toHaveLength(1);
    const stored = attachmentPath(w.deps.env, `${sha(PNG)}.png`);
    expect(goalOf(world, childGroupIdOf(flowRunId, "to-draft-box", 1))).toContain(`the person's cover '${stored}'`);
    expect([...world.children.opened.values()].map((o) => JSON.stringify(o.plan)).some((plan) => plan.includes(preset))).toBe(false);
    expect(readFileSync(stored)).toEqual(PNG);
    await landBoxAndGuard(world, flowRunId, stored);
  });
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
    const webp = readFileSync(join(w.folder, "mine.webp"));
    expect(goalOf(world, childGroupIdOf(flowRunId, "to-draft-box", 2))).toContain(`the person's cover '${attachmentPath(w.deps.env, `${sha(webp)}.webp`)}'`);
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

  it("a params change through a linked parent directory is refused; a change refused at a later key stores nothing", async () => {
    const world = await wechat();
    const { w } = world;
    const flowRunId = await wechatRun(world, {});
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "c.png"), PNG);
    symlinkSync(elsewhere, join(w.folder, "linkdir"));
    expect(await params(world, flowRunId, { coverImage: "linkdir/c.png" }, "link")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:coverImage" });
    writeFileSync(join(w.folder, "good.png"), PNG);
    expect(await params(world, flowRunId, { coverImage: "good.png", nope: 1 }, "later")).toMatchObject({ state: "rejected", reason: "flow-param-invalid:nope" });
    expect(existsSync(attachmentsDir(w.deps.env)) ? readdirSync(attachmentsDir(w.deps.env)) : []).toEqual([]);
  });

  it("params {coverImage: null} on a run that took the person's cover makes `cover` run again", async () => {
    const world = await wechat();
    const { w } = world;
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const flowRunId = await wechatRun(world, { coverImage: "cover.png" });
    world.children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "skipped" });
    expect(await params(world, flowRunId, { coverImage: null }, "clear")).toMatchObject({ state: "applied" });
    expect(bodyOf(w.store, flowRunId).images).toBeUndefined();
    for (let open = lastPlan(world, flowRunId); open.state === "proposed"; open = lastPlan(world, flowRunId)) {
      const others = (open.candidates as PlanCandidates).list.map((c) => c.stepKey).filter((k) => k !== "cover" && k !== "to-draft-box");
      await w.answer(w.calls.length - 1, { skips: others.map((stepKey) => ({ stepKey, reason: "unchanged" })) });
    }
    expect(world.children.opened.has(childGroupIdOf(flowRunId, "cover", 2))).toBe(true);
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

describe("a run started on built-in version 2 (§8.5)", { timeout: 60_000 }, () => {
  it("still loads and advances on its own stored template after version 3 is seeded", async () => {
    const v2 = readFileSync(V2_YAML, "utf8");
    const world = await wechatWorld();
    cleanups.push(() => world.w.dispose());
    const { w } = world;
    const v3 = readFileSync(join(w.builtinRoot, "wechat-article", "template.yaml"), "utf8");
    writeFileSync(join(w.builtinRoot, "wechat-article", "template.yaml"), v2);
    writeFileSync(join(w.folder, "cover.png"), PNG);
    const { flowRunId } = await w.start({ templateRef: "builtin/wechat-article", params: { idea: "Tea for engineers", coverImage: "cover.png" } });
    expect(loadRun(w.store, flowRunId).template).toMatchObject({ version: 2, params: { coverImage: { type: "path", required: false } } });
    writeFileSync(join(w.builtinRoot, "wechat-article", "template.yaml"), v3);
    expect(seedBuiltinTemplates(w.store, 9, w.builtinRoot)).toEqual([expect.objectContaining({ id: "wechat-article", version: 3 })]);
    const run = loadRun(w.store, flowRunId);
    expect(run.template).toMatchObject({ version: 2, params: { coverImage: { type: "path", required: false } } });
    expect(run.params.coverImage).toBe("cover.png");
    await w.advance();
    await w.answer(0, zeroRound);
    expect(world.children.opened.has(childGroupIdOf(flowRunId, "outline", 1))).toBe(true);
  });
});
