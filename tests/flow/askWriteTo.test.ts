import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportedFlowOf } from "../../src/control/reportedDecisions.js";
import { answerAsk } from "../../src/flow/kinds/ask.js";
import { builtinKinds, type KindDefinition } from "../../src/flow/kinds/registry.js";
import { getFlowRun, getHead, listMessages } from "../../src/flow/store.js";
import { writeAnswer } from "../../src/flow/writeTo.js";
import { FlowRefusal } from "../../src/flow/kernel.js";
import { openVault } from "../../src/flow/vault/vault.js";
import { importSnapshot, DEFAULT_CAPS } from "../../src/flow/vault/snapshot.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §4.2 `ask` and §4.4 (plan Task 9, criterion C16 part, Review Focus 2): candidates come from an earlier
 * step's REPORT (`flow.candidates`) or the `flow-ask` call, never from parsing the file; the answer is written by code
 * into exactly one field of the workspace as a person `edit` execution (`by` = the answerer), so later steps become
 * candidates; the same value writes nothing; a missing file or field, or a path outside the workspace, is the red flag
 * `writeTo-missing` with nothing touched. `confirm-before` parks only itself and later steps; `review-after` lets them
 * run on the default; an unattended run takes the default with a minor decision.
 */
const standInWork: KindDefinition = {
  kind: "work", kindVersion: 1, interactive: false,
  async start(ctx) { return { call: { purpose: "flow-work-stand-in", prompt: ctx.prompt(), responseSchema: {}, maxOutputTokens: 1000 } }; },
  collect(_ctx, raw) {
    const flow = reportedFlowOf(raw);
    return { done: { record: { result: raw }, ...(flow.kind === "object" && flow.value.candidates !== undefined ? { reported: { candidates: flow.value.candidates } } : {}) } };
  },
};
const registry = () => { const r = builtinKinds(); r.register(standInWork); return r; };

const tpl = (ask: string) => ({
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: titles, kind: work, prompt: t.md}
  - {id: pick-title, kind: ask, form: {title: {type: text}}, ${ask}}
  - {id: polish, kind: draft, prompt: p.md}
`,
  assets: { "t.md": "Titles.\n", "p.md": "Polish.\n" },
});
const FROM_TITLES = "candidatesFrom: {step: titles, name: title}, writeTo: {file: article.md, frontmatter: title}";
const ARTICLE = "---\ntitle: Old title\ntags: [tea]\n---\nBody text.\n";
const REPORT = { flow: { candidates: { title: { items: ["Tea at Dawn", "Morning Tea"], recommended: 0 } } } };

const blobAt = (vaultPath: string, commit: string, path: string): string =>
  execFileSync("git", ["--git-dir", vaultPath, "show", `${commit}:${path}`], { encoding: "utf8" });

describe("ask with writeTo (C16 part, §4.4)", () => {
  it("confirm-before: candidates from the report; the answer lands in the title field as the answerer's edit; later steps then run", async () => {
    const w = await flowWorld({ t: tpl(FROM_TITLES) }, { registry: registry(), files: { "article.md": ARTICLE } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, REPORT);
      const ask = w.latest(flowRunId, "pick-title")!;
      expect(ask.state).toBe("needs-person");
      // From the report, never from the file (which holds "Old title").
      expect((ask.body as { ask: unknown }).ask).toEqual({ kind: "ask", form: { title: { type: "text" } }, candidates: { title: ["Tea at Dawn", "Morning Tea"] }, defaults: { title: "Tea at Dawn" }, freeText: true });
      expect(w.calls).toHaveLength(1);

      await answerAsk(w.deps, { flowRunId, stepKey: "pick-title" }, { title: "Morning Tea" }, "ann", "cli:test");
      await w.advance();
      const edit = w.latest(flowRunId, "pick-title")!;
      expect(edit).toMatchObject({ seq: 2, state: "done", outputKind: "commit", by: "ann", via: "cli:test" });
      expect(getHead(w.store, flowRunId, "pick-title")).toBe(2);
      const vaultPath = (getFlowRun(w.store, flowRunId)!.body as { vaultPath: string }).vaultPath;
      expect(blobAt(vaultPath, edit.outputRef!, "article.md")).toBe("---\ntitle: Morning Tea\ntags: [tea]\n---\nBody text.\n");
      // Copied back into the person's folder.
      expect(readFileSync(join(w.folder, "article.md"), "utf8")).toBe("---\ntitle: Morning Tea\ntags: [tea]\n---\nBody text.\n");
      expect(listMessages(w.store, flowRunId).map((m) => ({ kind: m.kind, by: m.by, body: m.body }))).toEqual([
        { kind: "command", by: "ann", body: { command: "answer", stepKey: "pick-title", seq: 1, values: { title: "Morning Tea" } } },
      ]);
      expect(w.calls[1]).toMatchObject({ purpose: "flow-draft", key: { stepKey: "polish" } });
      await expect(answerAsk(w.deps, { flowRunId, stepKey: "pick-title" }, { title: "Again" }, "ann", "cli:test")).rejects.toThrow(/flow-ask-closed/);
    } finally { await w.dispose(); }
  });

  it("review-after: later steps run on the default; the same value writes no commit; a later answer makes them candidates", async () => {
    const article = "---\ntitle: Tea at Dawn\n---\nBody.\n";
    const w = await flowWorld({ t: tpl(`policy: review-after, ${FROM_TITLES}`) }, { registry: registry(), files: { "article.md": article } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, REPORT);
      const first = w.latest(flowRunId, "pick-title")!;
      expect(first).toMatchObject({ seq: 1, state: "done", outputKind: "artifact", by: "orca-auto" });
      expect(readFileSync(join(w.folder, "article.md"), "utf8")).toBe(article);
      expect(w.calls[1]).toMatchObject({ key: { stepKey: "polish", seq: 1 } });
      await w.answer(1, { content: "polished" });

      await answerAsk(w.deps, { flowRunId, stepKey: "pick-title" }, { title: "Tea at Dawn" }, "ann", "cli:test");
      await w.advance();
      expect(w.execs(flowRunId, "pick-title")).toHaveLength(1);
      expect(w.calls).toHaveLength(2);

      await answerAsk(w.deps, { flowRunId, stepKey: "pick-title" }, { title: "Morning Tea" }, "ann", "cli:test");
      await w.advance();
      expect(w.latest(flowRunId, "pick-title")).toMatchObject({ seq: 2, outputKind: "commit", by: "ann" });
      expect(w.calls[2]).toMatchObject({ key: { stepKey: "polish", seq: 2 } });
    } finally { await w.dispose(); }
  });

  it("a missing field is the red flag writeTo-missing and nothing is touched", async () => {
    const w = await flowWorld({ t: tpl("candidatesFrom: {step: titles, name: title}, writeTo: {file: article.md, frontmatter: subtitle}") }, { registry: registry(), files: { "article.md": ARTICLE } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, REPORT);
      await answerAsk(w.deps, { flowRunId, stepKey: "pick-title" }, { title: "Morning Tea" }, "ann", "cli:test");
      await w.advance();
      const edit = w.latest(flowRunId, "pick-title")!;
      expect(edit.state).toBe("failed");
      expect(edit.body).toMatchObject({ failure: "writeTo-missing", flags: ["writeTo-missing"] });
      expect(readFileSync(join(w.folder, "article.md"), "utf8")).toBe(ARTICLE);
      expect(w.calls).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("an unattended run takes the default with one minor decision", async () => {
    const w = await flowWorld({ t: tpl(FROM_TITLES) }, { registry: registry(), files: { "article.md": ARTICLE } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", unattended: true });
      await w.advance();
      await w.answer(0, REPORT);
      expect(w.latest(flowRunId, "pick-title")).toMatchObject({ state: "done", outputKind: "commit", by: "orca-auto" });
      expect(readFileSync(join(w.folder, "article.md"), "utf8")).toContain("title: Tea at Dawn\n");
      const rows = w.store.db.prepare("SELECT grade, body FROM flow_decisions WHERE flow_run_id=?").all(flowRunId) as Array<{ grade: string; body: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.grade).toBe("minor");
      expect(JSON.parse(rows[0]!.body)).toMatchObject({ kind: "ask-default", stepKey: "pick-title", values: { title: "Tea at Dawn" } });
    } finally { await w.dispose(); }
  });

  it("without candidatesFrom the candidates come from the flow-ask call", async () => {
    const w = await flowWorld({ t: tpl("writeTo: {file: article.md, frontmatter: title}") }, { registry: registry(), files: { "article.md": ARTICLE } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, {});
      expect(w.calls[1]).toMatchObject({ purpose: "flow-ask", key: { stepKey: "pick-title" } });
      await w.answer(1, { candidates: { title: { items: ["A", "B"], recommended: 1 } } });
      expect((w.latest(flowRunId, "pick-title")!.body as { ask: { defaults: unknown } }).ask.defaults).toEqual({ title: "B" });
    } finally { await w.dispose(); }
  });
});

describe("writeAnswer (§4.4, Review Focus 2)", () => {
  const world = async (files: Record<string, string>) => {
    const w = await flowWorld({}, { files });
    const vault = await openVault(w.deps.env, w.folder);
    const { commit } = await importSnapshot(vault, w.folder, { flowRunId: "fr-x", caps: DEFAULT_CAPS });
    return { w, vault, commit };
  };

  it("writes only the JSON field the pointer names, keeping the file's indentation", async () => {
    const { w, vault, commit } = await world({ "meta.json": "{\n    \"title\": \"Old\",\n    \"n\": 1\n}\n" }); try {
      const out = await writeAnswer(vault, commit, { file: "meta.json", json: "/title" }, "New", "ann");
      if (!("commit" in out)) throw new Error("expected a commit");
      expect(blobAt(vault.path, out.commit, "meta.json")).toBe("{\n    \"title\": \"New\",\n    \"n\": 1\n}\n");
      expect(await writeAnswer(vault, out.commit, { file: "meta.json", json: "/title" }, "New", "ann")).toEqual({ unchanged: true });
      expect(await writeAnswer(vault, commit, { file: "meta.json", json: "/missing" }, "x", "ann")).toEqual({ flag: "writeTo-missing" });
    } finally { await w.dispose(); }
  });

  it("refuses a path outside the workspace and a missing file, writing nothing", async () => {
    const { w, vault, commit } = await world({ "a.md": "---\ntitle: A\n---\n" }); try {
      expect(await writeAnswer(vault, commit, { file: "../x.md", frontmatter: "title" }, "B", "ann")).toEqual({ flag: "writeTo-missing" });
      expect(await writeAnswer(vault, commit, { file: "/etc/x.md", frontmatter: "title" }, "B", "ann")).toEqual({ flag: "writeTo-missing" });
      expect(await writeAnswer(vault, commit, { file: "nope.md", frontmatter: "title" }, "B", "ann")).toEqual({ flag: "writeTo-missing" });
      expect(existsSync(join(w.folder, "..", "x.md"))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a template whose writeTo.file leaves the workspace does not start", async () => {
    const w = await flowWorld({ t: tpl("writeTo: {file: ../x.md, frontmatter: title}") }, { registry: registry() }); try {
      await expect(w.start({ templateRef: "builtin/t" })).rejects.toBeInstanceOf(FlowRefusal);
    } finally { await w.dispose(); }
  });
});
