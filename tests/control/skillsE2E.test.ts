import { existsSync, readdirSync, readFileSync, chmodSync, lstatSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Syncskill integration spec §10.8 C9 (plan Task 6), a smoke with no mutation: a loop task with a frozen skill set runs
 * under ccloop's CLI-level fake claude against the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop's
 * skillPluginDir change), with a fake syncskill doing the inject. The run lands; the landed tree carries no `.claude/`
 * path and no `syncskill-lock.json` (the snapshot lives beside the workspace, never in it); every claude call was given
 * `--plugin-dir <the run's snapshot>`; and once the run settles its snapshot is gone with its workspace.
 * Honest claim: fake claude and fake syncskill only; nothing here shows a real claude loading the plugin.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-skills-e2e-", epochPrefix: "epoch-skills-e2e-" });
const FAKE_SYNCSKILL = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const extra: string[] = [];
function restoreTestPermissions(path:string):void {let stat;try{stat=lstatSync(path);}catch{return;}if(stat.isSymbolicLink())return;chmodSync(path,(stat.mode&0o777)|0o700);if(stat.isDirectory())for(const name of readdirSync(path))restoreTestPermissions(join(path,name));}
const ownedWorldRoots:string[]=[];
afterAll(async () => {
  for(const root of ownedWorldRoots)restoreTestPermissions(root);
  await removeRoots();
  for (const dir of extra) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
// ccloop's fake claude reports answer.txt as changed on every execute (tests/fixtures/fake-claude-cli.mjs), so a loop
// plan's allowlist (its targetPaths) names it too, as loopPlanE2E.test.ts explains.
const loopWithSkills = { plan: "standard", goal: "write shared.txt", successCondition: "shared.txt holds the scripted text", targetPaths: ["shared.txt", "answer.txt"], checks: ["true"], skills: { names: ["alpha"] } };

describe("a run with skills against real ccloop (syncskill integration spec §10.8 C9)", { timeout: 300_000 }, () => {
  relocateHome("orca-skills-e2e-home-");
  // Gated at run time, never with describe.skipIf (tests/setup/scopeTmpdir.ts ERRATUM 2026-09-29).
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("lands, with no .claude/ and no syncskill-lock.json in the landed tree, and every claude call given the run's plugin dir", async () => {
    const fakeDir = await realpath(await mkdtemp(join(tmpdir(), "orca-skills-e2e-syncskill-")));
    extra.push(fakeDir);
    const bin = join(fakeDir, "syncskill");
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_SYNCSKILL}' "$@"\n`, { mode: 0o755 });
    const log = join(fakeDir, "calls.jsonl");
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt", "answer.txt"], agent: { agent: "claude" }, loop: loopWithSkills }], {}, {
      claudeScript: { a: { files: { "shared.txt": "A\n" } } },
      env: { ORCA_SYNCSKILL_BIN: bin, FAKE_SYNCSKILL_MODE: "inject-ok", FAKE_SYNCSKILL_LOG: log },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the run to settle");
      const [run] = workRuns(runtime);
      const drive = run!.body.drive;
      const dir = drive.skills.dir as string;
      expect(dir).toBe(join(`${runtime.store.stateDir}.workspaces`, `skills-${run!.runId}`));
      expect(JSON.parse(readCanonicalRecord(runtime.store, drive.envelopeHash)).work.skillPluginDir).toBe(dir);
      // Every claude call (plan, execute, verify) was handed the snapshot.
      const argv = w.argv("claude");
      expect(argv.length).toBeGreaterThan(0);
      for (const args of argv) expect(args[args.indexOf("--plugin-dir") + 1]).toBe(dir);
      expect(w.argv("codex")).toEqual([]);
      // The landed tree: the scripted change, and nothing of the snapshot.
      const landed = g(w.repo, "ls-tree", "-r", "--name-only", drive.landedCommit).split("\n");
      // Printed for the task report's C9 evidence (the full `git ls-tree -r` of the landed commit).
      console.log(`C9 landed tree of ${drive.landedCommit}:\n${g(w.repo, "ls-tree", "-r", drive.landedCommit)}`);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
      expect(landed.filter((path) => path.startsWith(".claude/") || path.split("/").includes("syncskill-lock.json"))).toEqual([]);
      expect(readFileSync(log, "utf8").split("\n").filter((line) => line !== "")).toHaveLength(1);
      // Settled: the snapshot went with the workspace.
      expect(existsSync(dir)).toBe(false);
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});

/**
 * Final review I1 pinned that a codex task with skills was accepted by Orca and blocked by ccloop at run start
 * (`accept-refused:2:skills-unsupported-agent`), after which the task could be neither changed nor re-dispatched and only
 * stopping the group ended it. Human ruling 2026-10-03 (session 9d95e6c8) moves the refusal to confirm, by the kind the
 * real ccloop build reports for the installation (listAgents); this criterion is rewritten to pin that instead. ccloop's
 * acceptStart refusal stays, for a table changed after confirm. Honest claim: fake codex and fake syncskill.
 */
// Approved H6 design (2026-10-05): replaces the old Codex refusal E2E criterion whole.
describe("Codex frozen skills through real ccloop",{timeout:300000},()=>{
 relocateHome("orca-skills-codex-home-");beforeEach(ctx=>{if(!realBinary)ctx.skip();});
 async function scenario(mode:string) {
  const fakeDir=await realpath(await mkdtemp(join(tmpdir(),"h6-codex-e2e-")));extra.push(fakeDir);
  const bin=join(fakeDir,"syncskill");await writeFile(bin,`#!/bin/sh\nexec '${process.execPath}' '${FAKE_SYNCSKILL}' "$@"\n`,{mode:0o755});
  const w=await world([{taskId:"a",targetPaths:["shared.txt","answer.txt"],agent:{agent:"codex"},loop:{...loopWithSkills,plan:"bugfix"}}],{a:{files:{"shared.txt":"A\n"}}},{env:{ORCA_SYNCSKILL_BIN:bin,FAKE_SYNCSKILL_MODE:"inject-ok",FAKE_SYNCSKILL_LOG:join(fakeDir,"syncskill.jsonl")}});
  ownedWorldRoots.push(w.root);
  await mkdir(join(w.repo,".agents/skills/legacy"),{recursive:true});await writeFile(join(w.repo,".agents/skills/legacy/SKILL.md"),"legacy bytes");
  if(mode==="conflict")await writeFile(join(w.repo,".agents/skills/alpha"),"existing selected name");
  g(w.repo,"add",".agents");g(w.repo,"commit","-qm","existing skills");
  const command=w.agentsTable.installations.codex!.command as string[];
  const wrapper=join(fakeDir,"codex-wrapper.mjs");
  await writeFile(wrapper,`import {appendFileSync,readFileSync,chmodSync} from "node:fs";
import {pathToFileURL} from "node:url";
const mode=process.argv[2],fake=process.argv[3],marker=process.argv[5];
if(!process.argv.includes("--version")) {
 const args=process.argv;const schema=JSON.parse(readFileSync(args[args.indexOf("--output-schema")+1],"utf8"));const business=schema.properties?.result??schema;
 const phase=business.anyOf?"execute":business.properties?.approved?"verify":"plan";
 appendFileSync(marker+".skills",JSON.stringify({phase,skill:readFileSync(".agents/skills/alpha/SKILL.md","utf8"),legacy:readFileSync(".agents/skills/legacy/SKILL.md","utf8")})+"\\n");
 if(mode==="cleanup")chmodSync(".agents/skills",0o500);
}
process.argv.splice(1,2);await import(pathToFileURL(fake).href);`);
  w.agentsTable.installations.codex!.command=[process.execPath,wrapper,mode,...command.slice(1)];await writeFile(w.table,JSON.stringify(w.agentsTable),{mode:0o600});
  return w;
 }
 it("reads frozen skills in every phase, preserves legacy bytes and lands no temporary links",async()=>{
  const w=await scenario("success"),runtime=await w.boot();try {
   await startGroup(runtime,w.repoId);runtime.startPump(50);await until(()=>{noBlocked(runtime);return workStatus(runtime,"a")==="done"&&workRuns(runtime).every(r=>r.body.drive?.cleanedUp);},240000,"Codex skills to settle");
   const [run]=workRuns(runtime),drive=run!.body.drive;
   const envelope=JSON.parse(readCanonicalRecord(runtime.store,drive.envelopeHash));expect(envelope.work.codexSkillsDir).toBe(join(drive.skills.dir,"skills"));expect(envelope.work).not.toHaveProperty("skillPluginDir");
   const marker=(w.agentsTable.installations.codex!.command as string[])[5]!;
   const calls=readFileSync(marker+".skills","utf8").trim().split("\n").map(line=>JSON.parse(line));expect(calls).toEqual(["plan","execute","verify"].map(phase=>({phase,skill:"# alpha\n",legacy:"legacy bytes"})));
   const tree=g(w.repo,"ls-tree","-r","--name-only",drive.landedCommit).split("\n");expect(tree).not.toContain(".agents/skills/alpha");expect(tree).not.toContain(".agents/skills/syncskill-lock.json");expect(g(w.repo,"show",drive.landedCommit+":.agents/skills/legacy/SKILL.md")).toBe("legacy bytes");expect(existsSync(drive.skills.dir)).toBe(false);expect(await runtime.shutdown()).toBe(true);
  }finally{await w.teardown();}
 });
 it.each(["conflict","cleanup"])("blocks %s with the stable reason and publishes no Orca link",async(mode)=>{
  const w=await scenario(mode),runtime=await w.boot();try {
   await startGroup(runtime,w.repoId);runtime.startPump(50);await until(()=>workRuns(runtime).some(r=>r.body.state==="blocked"),120000,"Codex skills refusal");const [run]=workRuns(runtime),drive=run!.body.drive;
   expect(drive.blockedReason).toContain(mode==="conflict"?"codex-skills-path-conflict:alpha":"codex-skills-cleanup-failed:EACCES");expect(drive.landedCommit).toBeNull();
   const marker=(w.agentsTable.installations.codex!.command as string[])[5]!;
   if(mode==="conflict"){expect(existsSync(marker+".skills")).toBe(false);expect(g(w.repo,"show","HEAD:.agents/skills/alpha")).toBe("existing selected name");}
   else {const attempt=join(drive.sourceDir,"run/worktrees/attempt-1");expect(existsSync(attempt+".codex-skills-pending")).toBe(true);expect(g(JSON.parse(readCanonicalRecord(runtime.store,drive.envelopeHash)).work.contract.context.repoPath,"for-each-ref","--format=%(refname)","refs/ccloop/" )).toBe("");if(existsSync(join(attempt,".agents/skills")))chmodSync(join(attempt,".agents/skills"),0o700);}
   expect(g(w.repo,"show","HEAD:.agents/skills/legacy/SKILL.md")).toBe("legacy bytes");expect(await runtime.shutdown()).toBe(true);
  }finally{await w.teardown();}
 });
});
