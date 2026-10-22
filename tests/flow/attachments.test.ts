/**
 * Gaps spec §4.7, §16 (G14, Rule 17): the feedback attachment store `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>`
 * -- images by their magic bytes only, at most 5 MiB, at most 4 per message, directory 0700 and files 0600 set
 * explicitly, an existing file never rewritten or re-moded -- and the upload route that answers the id. Single calls and
 * work prompts name attachments by id only: §4.7's copy into the attempt workspace is open for the human (spec §21
 * entry 2), pinned below as a todo that names the question rather than left out.
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { ATTACHMENT_MAX_BYTES, attachmentPath, attachmentsDir, storeAttachment } from "../../src/flow/feedback/attachments.js";
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

  it("a message takes at most 4 attachments, each a stored id; the triage call and the work prompt name them by id only", { timeout: 60_000 }, async () => {
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
    expect(goal).toContain(`The person attached screenshots (not available to you): ${ids[0]}, ${ids[1]}`);
    expect(goal).not.toContain(".orca/attachments");
  });

  it.todo("an attachment is present in the child's attempt workspace (.orca/attachments/<id>) -- OPEN for the human (spec §21 entry 2): ccloop opens attempts from the run workspace's HEAD, so Orca cannot place it there; decide (a) an absolute path outside the workspace, which needs ccloop read access for the agent, or (b) a ccloop change that seeds files into each attempt (Rule 16). Evidence: logs/gaps/t5-g14-premise.{sh,log}");

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
  });
});
