// CLI v2 plan Task 5 (spec §6.3): small proposal edits are the main path; a whole-document replace requires --if-revision
// and is refused here without it; a conflict answers one JSON object with the current revision and the current document;
// `proposal edit` is a TTY convenience over replace.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const dir = mkdtempSync(join(tmpdir(), "prop-"));
const OPS = { operations: [{ target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: 700, provenance: "human" }] };
const opsFile = join(dir, "ops.json");
writeFileSync(opsFile, JSON.stringify(OPS));

describe("proposal replace (spec §6.3)", () => {
  it("without --if-revision: exit 1 before any socket call", async () => {
    const w = await world();
    const out = await cli(["proposal", "replace", "g-alpha", "--file", opsFile, "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(out.json().body.error.message).toContain("--if-revision");
    expect(w.requests).toEqual([]);
  });

  it("with the revision it was based on: sends the file's operations at that revision, the base version read now", async () => {
    const w = await world();
    expect((await cli(["proposal", "replace", "g-alpha", "--file", opsFile, "--if-revision", "5"], w.dir)).code).toBe(0);
    expect(w.posts()).toEqual([{ path: "groups/g-alpha/proposal/edit", commandId: expect.stringMatching(/^cli-/), expectedRevision: 5, payload: { baseProposalVersion: 3, ...OPS } }]);
  });

  it("stale: one JSON object with currentRevision and the current proposal document", async () => {
    const w = await world();
    const out = await cli(["proposal", "replace", "g-alpha", "--file", opsFile, "--if-revision", "3", "--json"], w.dir);
    expect(out.code).toBe(2);
    const body = out.json().body;
    expect(body).toMatchObject({ error: { code: "revision-conflict" }, currentRevision: 5 });
    expect(body.current).toEqual({
      schema: "orca-proposal-view-v1", groupId: "g-alpha", revision: 5, proposal: w.state.view.proposal, allocations: w.state.view.allocations, groupLimit: w.state.view.ledger.groupLimit,
    });
  });
});

describe("small edits (spec §6.3 main path)", () => {
  it("set-budget sends exactly one operation under the base version read now", async () => {
    const w = await world();
    expect((await cli(["proposal", "set-budget", "g-alpha", "--task", "t1", "--allocation", "work", "--dimension", "tokens", "--value", "900"], w.dir)).code).toBe(0);
    expect(w.posts().map((p) => [p.path, p.expectedRevision, p.payload])).toEqual([["groups/g-alpha/proposal/edit", 5, {
      baseProposalVersion: 3, operations: [{ target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: 900, provenance: "human" }],
    }]]);
  });

  it("set-budget for the goal review, and an unlimited task token ceiling", async () => {
    const w = await world();
    await cli(["proposal", "set-budget", "g-alpha", "--goal-review", "--dimension", "attempts", "--value", "2"], w.dir);
    await cli(["proposal", "set-budget", "g-alpha", "--task", "t1", "--allocation", "work", "--dimension", "tokens", "--value", "none"], w.dir);
    expect(w.posts().map((p) => (p.payload as { operations: unknown[] }).operations[0])).toEqual([
      { target: { scope: "goal-review", dimension: "attempts" }, value: 2, provenance: "human" },
      { target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: null, provenance: "human" },
    ]);
  });

  it("set-agent replaces one selection layer, or clears it", async () => {
    const w = await world();
    await cli(["proposal", "set-agent", "g-alpha", "--slot", "worker", "--agent", "claude-main", "--model", "opus"], w.dir);
    await cli(["proposal", "set-agent", "g-alpha", "--task", "t1", "--clear"], w.dir);
    expect(w.posts().map((p) => [p.path, p.payload])).toEqual([
      ["groups/g-alpha/proposal/agent", { baseProposalVersion: 3, scope: { kind: "group", slot: "worker" }, partial: { agent: "claude-main", model: "opus" } }],
      ["groups/g-alpha/proposal/agent", { baseProposalVersion: 3, scope: { kind: "task", taskId: "t1" }, partial: null }],
    ]);
  });
});

describe("proposal edit (spec §6.3: a TTY convenience over replace)", () => {
  it("not on a TTY: exit 1, pointing at proposal replace, nothing asked of the panel", async () => {
    const w = await world();
    const out = await cli(["proposal", "edit", "g-alpha", "--json"], w.dir, { stdinIsTTY: false });
    expect(out.code).toBe(1);
    expect(out.json().body.error.message).toContain("orca proposal replace");
    expect(w.requests).toEqual([]);
  });

  it("on a TTY: $EDITOR edits the shown document, and the changed values go as replace --if-revision <the revision read>", async () => {
    const w = await world();
    const editor = join(dir, "editor.sh");
    // Change task t1's work token value from 500 to 650; leave everything else as shown.
    writeFileSync(editor, `#!/bin/sh\nnode -e 'const fs=require("fs");const f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,"utf8"));for(const o of d.operations)if(o.target.scope==="task"&&o.target.taskId==="t1"&&o.target.allocation==="work"&&o.target.dimension==="tokens")o.value=650;fs.writeFileSync(f,JSON.stringify(d,null,2));' "$1"\n`);
    chmodSync(editor, 0o700);
    const out = await cli(["proposal", "edit", "g-alpha"], w.dir, { stdinIsTTY: true, env: { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json", EDITOR: editor, PATH: process.env.PATH } });
    expect(out.code, out.stderr).toBe(0);
    expect(w.posts().map((p) => [p.path, p.expectedRevision, p.payload])).toEqual([["groups/g-alpha/proposal/edit", 5, {
      baseProposalVersion: 3, operations: [{ target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: 650, provenance: "human" }],
    }]]);
  });
});
