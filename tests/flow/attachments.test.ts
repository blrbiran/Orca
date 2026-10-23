/**
 * Gaps spec §4.7, §16 (G14, Rule 17): the feedback attachment store `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>`
 * -- images by their magic bytes only, at most 5 MiB, at most 4 per message, directory 0700 and files 0600 set
 * explicitly, an existing file never rewritten or re-moded -- and the upload route that answers the id. Single calls
 * name attachments by id only; a work execution that takes the feedback gets each one's absolute store path (spec §21
 * entry 4: the human's choice (a) in place of §4.7's copy into the attempt workspace).
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { ATTACHMENT_MAX_BYTES, attachmentPath, attachmentsDir, storeAttachment } from "../../src/flow/feedback/attachments.js";
import { feedbackForWork } from "../../src/flow/feedback/intake.js";
import { expansionParams } from "../../src/flow/params.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { registerControlMutationRoutes } from "../../src/panel/controlApi.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpg body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 body")]);

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const tempRoot = (): string => { const root = mkdtempSync(join(tmpdir(), "orca-attach-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; };
const mode = (path: string) => statSync(path).mode & 0o777;

describe("attachment store (gaps §4.7, G14)", () => {
  it("stores png, jpg and webp by their bytes under $ORCA_CONTROL_DIR, dir 0700 and files 0600 whatever the umask", () => {
    const env = { ORCA_CONTROL_DIR: join(tempRoot(), "control") };
    const old = process.umask(0);
    try {
      for (const [bytes, ext] of [[PNG, "png"], [JPG, "jpg"], [WEBP, "webp"]] as const) {
        const stored = storeAttachment(env, bytes);
        expect(stored.ext).toBe(ext);
        expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(mode(attachmentPath(env, `${stored.sha256}.${ext}`))).toBe(0o600);
      }
    } finally { process.umask(old); }
    expect(attachmentsDir(env)).toBe(join(env.ORCA_CONTROL_DIR, "flow-attachments"));
    expect(mode(attachmentsDir(env))).toBe(0o700);
    expect(mode(env.ORCA_CONTROL_DIR)).toBe(0o700);
    // No temporary file is left behind.
    expect(readdirSync(attachmentsDir(env)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("refuses what is not an image by its bytes, and anything over 5 MiB; a refusal leaves no file", () => {
    const env = { ORCA_CONTROL_DIR: join(tempRoot(), "control") };
    expect(() => storeAttachment(env, Buffer.from("just text, named .png"))).toThrow(/^flow-attachment-invalid: not a png, jpg or webp/);
    expect(() => storeAttachment(env, Buffer.alloc(0))).toThrow(/^flow-attachment-invalid/);
    expect(() => storeAttachment(env, Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES)]))).toThrow(/^flow-attachment-invalid: larger than/);
    expect(existsSync(attachmentsDir(env)) ? readdirSync(attachmentsDir(env)) : []).toEqual([]);
    expect(storeAttachment(env, Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES - PNG.length)])).ext).toBe("png");
  });

  it("the same bytes are the same file: never rewritten, and a mode the person set is kept", () => {
    const env = { ORCA_CONTROL_DIR: join(tempRoot(), "control") };
    const first = storeAttachment(env, PNG);
    const file = attachmentPath(env, `${first.sha256}.png`);
    chmodSync(file, 0o640);
    utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    expect(storeAttachment(env, PNG)).toEqual(first);
    expect(mode(file)).toBe(0o640);
    expect(statSync(file).mtimeMs).toBe(1_000_000);
  });

  it("a message takes at most 4 attachments, each a stored id; the triage call names them by id only, the work prompt by their absolute store paths", { timeout: 60_000 }, async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: { yaml: "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: w.md}\n", assets: { "w.md": "Write post.md.\n" } } }, { children: children.port });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    children.land(childGroupIdOf(flowRunId, "write", 1), { "post.md": "# Tea\n\nTea is warm.\n" });
    await w.advance();
    const ids = [PNG, JPG, WEBP, Buffer.concat([PNG, Buffer.from("2")]), Buffer.concat([PNG, Buffer.from("3")])].map((b) => { const s = storeAttachment(w.deps.env, b); return `${s.sha256}.${s.ext}`; });
    const send = (attachments: string[]) => acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "run" }, body: { text: "the screenshot shows it", attachments }, by: "ann", via: "cli:test", requestId: `r-${attachments.length}` });
    expect(await send(ids)).toMatchObject({ state: "rejected", reason: "flow-attachment-invalid:at most 4 per message" });
    expect(await send(ids.slice(0, 2))).toMatchObject({ state: "accepted" });
    const triage = w.calls.at(-1)!;
    expect(triage.purpose).toBe("feedback-triage");
    expect(triage.prompt).toContain(`- ${ids[0]}`);
    expect(triage.prompt).toContain(`- ${ids[1]}`);
    expect(triage.prompt).not.toContain(w.deps.env.ORCA_CONTROL_DIR);
    await w.answer(w.calls.length - 1, { targets: [{ stepKey: "write", why: "only step" }] });
    await w.answer(w.calls.length - 1, { skips: [] });
    const goal = JSON.parse(children.opened.get(childGroupIdOf(flowRunId, "write", 2))!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
    // The human's choice (a) (spec §21 entry 4): the work agent reads each screenshot where the store keeps it.
    for (const id of ids.slice(0, 2)) {
      const path = attachmentPath(w.deps.env, id);
      expect(path.startsWith(join(w.deps.env.ORCA_CONTROL_DIR!, "flow-attachments") + "/")).toBe(true);
      expect(goal).toContain(`- ${path}`);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(id.split(".")[0]);
    }
    expect(goal).not.toContain("not available to you");
    expect(goal).not.toContain(".orca/attachments");
  });

  it("a single-call step that takes the feedback (here a draft) gets the attachment ids only, never a path", { timeout: 60_000 }, async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: { yaml: "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nsteps:\n  - {id: note, kind: draft, prompt: n.md}\n  - {id: write, kind: work, prompt: w.md}\n", assets: { "w.md": "Write post.md.\n", "n.md": "Note it.\n" } } }, { children: children.port });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    await w.answer(w.calls.length - 1, { content: "a note" });
    children.land(childGroupIdOf(flowRunId, "write", 1), { "post.md": "# Tea\n\nTea is warm.\n" });
    await w.advance();
    const stored = storeAttachment(w.deps.env, PNG);
    const id = `${stored.sha256}.${stored.ext}`;
    expect(await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "run" }, body: { text: "see it", attachments: [id] }, by: "ann", via: "cli:test", requestId: "r-draft" })).toMatchObject({ state: "accepted" });
    await w.answer(w.calls.length - 1, { targets: [{ stepKey: "note", why: "the note" }] });
    await w.answer(w.calls.length - 1, { skips: [] });
    const draft = w.calls.at(-1)!;
    expect(draft).toMatchObject({ purpose: "flow-draft", key: { stepKey: "note" } });
    expect(draft.prompt).toContain(`The person attached screenshots (not available to you): ${id}`);
    expect(draft.prompt).not.toContain(w.deps.env.ORCA_CONTROL_DIR!);
  });

  it("a work prompt rewrites a last line in the attachment format only when its ids are valid; invalid ids and other prefixes stay as typed", () => {
    const env = { ORCA_CONTROL_DIR: "/c" };
    const id = `${"a".repeat(64)}.png`;
    const line = "The person attached screenshots (not available to you): ";
    expect(feedbackForWork([`fix it\n${line}${id}`], env)).toEqual([`fix it\nThe person attached screenshots. Read each image file at its absolute path (outside your workspace; do not copy it into the workspace):\n- /c/flow-attachments/${id}`]);
    // Not an attachment id (a path the person typed): kept as typed, no path is made of it.
    expect(feedbackForWork([`fix it\n${line}../secret.png`], env)).toEqual([`fix it\n${line}../secret.png`]);
    // Not the line's prefix, though as long and ending in an id: kept.
    expect(feedbackForWork([`fix it\n${"x".repeat(line.length)}${id}`], env)).toEqual([`fix it\n${"x".repeat(line.length)}${id}`]);
    expect(feedbackForWork(["no screenshots"], env)).toEqual(["no screenshots"]);
  });

  it("a relative ORCA_CONTROL_DIR (a foreground panel) still names absolute paths: the store path, a work prompt's line, an image expansion", () => {
    const root = tempRoot();
    const env = { ORCA_CONTROL_DIR: relative(process.cwd(), join(root, "control")) };
    expect(isAbsolute(env.ORCA_CONTROL_DIR)).toBe(false);
    const stored = storeAttachment(env, PNG);
    const id = `${stored.sha256}.${stored.ext}`;
    const abs = join(root, "control", "flow-attachments", id);
    expect(attachmentPath(env, id)).toBe(abs);
    expect(existsSync(abs)).toBe(true);
    expect(feedbackForWork([`x\nThe person attached screenshots (not available to you): ${id}`], env)[0]).toContain(`\n- ${abs}`);
    const run = { params: { pic: "a.png" }, body: { images: { pic: { source: "a.png", sha256: stored.sha256, ext: "png" } } } };
    expect(expansionParams(env, run as never).pic).toBe(abs);
  });

  it("the feedback clarify round (a single call) names attachments by id only, never a path", { timeout: 60_000 }, async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: { yaml: "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: w.md}\n", assets: { "w.md": "Write post.md.\n" } } }, { children: children.port });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(w.root, "control");
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    children.land(childGroupIdOf(flowRunId, "write", 1), { "post.md": "# Tea\n\nTea is warm.\n" });
    await w.advance();
    const stored = storeAttachment(w.deps.env, PNG);
    const id = `${stored.sha256}.${stored.ext}`;
    const sent = await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "run" }, body: { text: "something feels off", attachments: [id] }, by: "ann", via: "cli:test", requestId: "r-vague" });
    expect(sent).toMatchObject({ state: "accepted" });
    await w.answer(w.calls.length - 1, { targets: [{ stepKey: "write", why: "only step" }], clarity: "vague" });
    const clarify = w.calls.at(-1)!;
    expect(clarify).toMatchObject({ purpose: "clarify", key: { stepKey: "@feedback", seq: sent.seq } });
    expect(clarify.prompt).toContain(id);
    expect(clarify.prompt).not.toContain(w.deps.env.ORCA_CONTROL_DIR!);
  });

  it("the upload route stores the raw body and answers the id; a non-image is refused flow-attachment-invalid", async () => {
    const root = tempRoot();
    const w = await flowWorld({ t: { yaml: "format: orca-flow-v1\nid: t\nversion: 1\nworkspace: {kind: dir}\nsteps:\n  - {id: a, kind: draft, prompt: a.md}\n", assets: { "a.md": "a\n" } } });
    cleanups.push(() => w.dispose());
    w.deps.env.ORCA_CONTROL_DIR = join(root, "control");
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, knownRepository: () => false, flowDeps: () => w.deps } as never);
    const app = express();
    app.use(express.json({ limit: "64kb" }));
    app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "agent", client: "cli" }; next(); });
    registerControlMutationRoutes(app, w.store, service, "socket");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const url = (runId: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control/flows/${runId}/attachments`;
    const post = (runId: string, body: Buffer) => fetch(url(runId), { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(body) });
    const ok = await post(flowRunId, JPG);
    expect(ok.status).toBe(200);
    const answer = await ok.json() as { id: string; sha256: string; ext: string };
    expect(answer).toMatchObject({ schema: "orca-flow-attachment-v1", ext: "jpg", id: `${answer.sha256}.jpg` });
    expect(existsSync(attachmentPath(w.deps.env, answer.id))).toBe(true);
    const bad = await post(flowRunId, Buffer.from("text"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "flow-attachment-invalid" } });
    expect((await post("fr-nope", PNG)).status).toBe(404);
    // Review fix (minor 3): over the body limit is the same refusal by name, never a bare 413.
    const big = await post(flowRunId, Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES + 100)]));
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ error: { code: "flow-attachment-invalid" } });
  });
});
