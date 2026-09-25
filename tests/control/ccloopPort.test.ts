import { chmod, copyFile, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort, peerErrorCode } from "../../src/control/ccloopPort.js";
import { ControlError } from "../../src/control/errors.js";
import { createExecutionProfileRouter, intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

async function fixture(mode = "ok", extra:Record<string,unknown> = {}) {
  const root=await realpath(await mkdtemp(join(tmpdir(),"orca-ccloop-port-")));
  const binary=join(root,"fake;ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"),binary);await chmod(binary,0o700);
  // Agent selection spec §6.6: the port is given a binary and an agents table. The stand-in reads its own knobs from
  // the file passed as the table, so this is not a real table.
  const record=join(root,"record.json"),table=join(root,"agents.json");
  await writeFile(table,JSON.stringify({mode,record,...extra}),{mode:0o600});
  const port=createCcloopExecutionPort({binary,agentsTablePath:table,timeoutMs:10_000});
  const envelope:StartEnvelope={protocol:2,claim:{groupId:"g",workItemId:"w",taskId:"t",runId:"r",generation:1,graphVersion:1,targetVersion:1,commandId:"c",configHash:"a".repeat(64),agent:{agent:"codex",model:"fixture-model",contextWindow:"agent-default"},grant:{work:{tokens:1,activeMs:1,attempts:1,sessions:1},handoff:{tokens:1,activeMs:1,attempts:0,sessions:0}},ownerToken:"owner"},contractHash:"b".repeat(64),inputCheckpoint:null,work:{contract:{objective:"ship",scope:{allowedPaths:["src/**"]},acceptance:{commands:["true"]}},targetRepo:root,base:"HEAD",sourceDir:root}};
  return {root,binary,table,record,port,envelope};
}

const hx=(v:string)=>v.repeat(64);
/** Declares everything, so that anything the probe reports as missing is the port's answer. */
const probeSnapshot=():ExecutionProfileSnapshotV1=>({schema:"orca-execution-profile-snapshot-v1",
 profile:{profileId:"worker",allowedWorkKinds:["task"],adapter:"test",adapterConfigRef:"a",modelPolicyRef:"m",
  contextTokenizer:{tokenizerId:"tok",tokenizerVersion:"1"},workMaxOutputTokens:4096,
  capabilities:{usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"realtime",handoffControl:"durable",
   handoffExecution:"mechanical-in-run-v1",contextWindowTokens:100_000,
   requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["tokens"],handoffDimensions:["activeMs"],evidenceKind:"request-bound-v1"}},
  estimatorPreflight:null},
 resolved:{adapterConfigContentHash:hx("a"),modelPolicyContentHash:hx("b"),proofDocumentContentHashes:[hx("c")],
  adapterImplementationHash:hx("d"),adapterProtocolVersion:"1",tokenizerArtifactHashes:[{purpose:"context",contentHash:hx("e")}],
  secretValueHashes:[{name:"/adapter/token",valueHash:hx("f")}]}});

describe("production ccloop execution port",()=>{
  it("answers a profile probe through the router instead of being reported as a failed probe",async()=>{
    // Assembly plan Task 3. Reading `typeof port.probeProfileCapabilities` would pass while the
    // method stayed unreachable, so this drives the real router: what matters is that the answer
    // arrives from the port and `probeFailureCode` stays null.
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): a probe is of one
    // selection now (spec §6.4); the answer still has to arrive from the port with probeFailureCode null.
    const h=await fixture();
    const router=createExecutionProfileRouter([resolveProfile(probeSnapshot(),h.port)]);
    const observation=await router.probe(router.list()[0]!,{agent:"codex",model:"fixture-model",contextWindow:"agent-default"});
    expect(observation.probeFailureCode).toBe(null);
    expect(observation.probeFailureCode).not.toBe("control-capability-probe-failed");
  });
  // Human authorization 2026-09-24, G1 seam A Task 4: ccloop's `control capabilities` now answers
  // the eight-field v2 shape (protocol tag plus the seven capability fields), so the port no
  // longer has anything left to translate or invent -- it passes the peer's own answer through
  // verbatim, stripped only of the `protocol` tag. This test is rewritten, not weakened: it pins
  // both that the pass-through is faithful (Step 1's original assertion, still exercised against
  // the v2 default) AND that it is a genuine pass-through rather than a hardcode that happens to
  // match the default -- the second `fixture` call overrides one field and asserts the override
  // survives, which a hardcoded `"durable"` could never do.
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the view now arrives inside
  // one selection's capabilities-v3 resolution; it is still the peer's own answer, passed through whole.
  it("passes the peer's own capabilities-v3 view through, substituting nothing",async()=>{
    const h=await fixture();
    expect((await h.port.resolveAgent({agent:"codex"})).capabilities).toEqual({
      usageObservation:"phase-end",
      budgetEnforcement:"soft",
      contextObservation:"unavailable",
      handoffControl:"durable",
      handoffExecution:"mechanical-in-run-v1",
      contextWindowTokens:null,
      requestBoundProof:null,
    });
  });
  it("does not invent a substitute source for a peer's observation -- an overridden field passes through unchanged",async()=>{
    // Human authorization 2026-09-24, G1 seam A Task 4. If this method still hardcoded a field
    // instead of reading the peer's answer, a peer that states something other than the default
    // would be silently overridden. Answering "phase-end" here and asserting "phase-end" back --
    // not "durable" -- is what tells a pass-through apart from a hardcode that merely matches the
    // default by coincidence.
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the override is the view
    // inside the resolution (capabilities protocol 3); the same field must come back as the peer stated it.
    const h=await fixture("ok",{capabilities:{
      usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",
      handoffControl:"phase-end",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null,
    }});
    expect((await h.port.resolveAgent({agent:"codex"})).capabilities).toMatchObject({handoffControl:"phase-end"});
  });
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): "v2 default" became the
  // default view of a capabilities-v3 resolution; the intersection it pins is unchanged.
  it("therefore, with a peer answering the default view, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities",async()=>{
    // Human authorization 2026-09-24, G1 seam A Task 4. Renamed from its pre-G1 form, which
    // recorded that a claim closed on capabilities failed because the port could not observe
    // `handoffControl`/`handoffExecution` at all. That gap is closed now that ccloop's `capabilities`
    // states both fields: this test is now an observation of the real port, through the fake
    // binary, producing an intersection that keeps what the declared profile and the peer agree on
    // -- it is not a claim that Web dispatch to real ccloop is fully wired (that is Tasks 5/6).
    const h=await fixture();
    const declared=probeSnapshot().profile.capabilities;
    const observed=intersectCapabilities(declared,(await h.port.resolveAgent({agent:"codex"})).capabilities);
    expect(observed.handoffControl).toBe("durable");
    expect(observed.handoffExecution).toBe("mechanical-in-run-v1");
  });
  it("uses direct argv plus stdin JSON and validates successful responses",async()=>{
    // Human authorization 2026-09-24, G1 seam A Task 4: only the `protocol` expectation changes,
    // from v1 to the v2 wire vocabulary the fake binary now answers with.
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities answer protocol 3
    // (the tag is stripped, the resolution kept), the argv is `--agents <table>` and the envelope is protocol 2.
    const h=await fixture();expect(await h.port.resolveAgent({agent:"codex"})).toMatchObject({configHash:"d".repeat(64),capabilities:{budgetEnforcement:"soft"}});
    expect(await h.port.accept(h.envelope)).toEqual({kind:"accepted",executionId:"execution-1",configHash:"a".repeat(64)});
    const recorded=JSON.parse(await readFile(h.record,"utf8"));expect(recorded.argv).toEqual(["control","accept","--agents",h.table]);expect(JSON.parse(recorded.stdin)).toEqual(h.envelope);
  });
  it("propagates exit 2 stably and refuses malformed or oversized stdout",async()=>{
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the same three refusals,
    // reached through resolveAgent, the only capabilities call left.
    await expect((await fixture("exit2")).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({
      name: "ControlError", code: "control-peer-exit", detail: "2:remote-refusal", message: "control-peer-exit:2:remote-refusal",
    });
    await expect((await fixture("bad-json")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-invalid");
    await expect((await fixture("oversized")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-too-large");
  });
  it("validates evidence identity, base64 and hash",async()=>{
    const ref={artifactId:"evidence-proof",hash:createHash("sha256").update("proof").digest("hex")},h=await fixture("ok",{evidence:"proof",collectRef:ref});
    await h.port.collect(h.envelope,0);expect((await h.port.readEvidence(ref)).toString()).toBe("proof");
    const bad=await fixture("ok",{evidence:"proof",badHash:true,collectRef:ref});await bad.port.collect(bad.envelope,0);await expect(bad.port.readEvidence(ref)).rejects.toThrow("artifact-hash-mismatch");
  });
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the agents table takes the
  // adapter config's place and its own refusal code (spec §6.6); the symlink is still refused.
  it("requires absolute canonical regular binary and agents table files",async()=>{
    const h=await fixture();expect(()=>createCcloopExecutionPort({binary:"relative",agentsTablePath:h.table,timeoutMs:1})).toThrow("control-binary-invalid");
    const link=join(h.root,"table-link");await symlink(h.table,link);expect(()=>createCcloopExecutionPort({binary:h.binary,agentsTablePath:link,timeoutMs:1})).toThrow("control-agents-table-invalid");
  });
  it("asks capabilities about exactly the given selection and returns ccloop's resolution without the protocol tag",async()=>{
    const h=await fixture();
    const resolution=await h.port.resolveAgent({agent:"codex",model:"gpt-6-sol"});
    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:{agent:"codex",model:"gpt-6-sol"}});
    expect(resolution).toEqual({selection:{agent:"codex",model:"gpt-6-sol",contextWindow:"agent-default"},configHash:"d".repeat(64),timeoutMs:120000,killGraceMs:5000,
      capabilities:{usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null}});
  });
  it("lists the installations by asking capabilities with agent null",async()=>{
    const h=await fixture();
    expect(await h.port.listAgents()).toEqual({installations:[{id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture"}]});
    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:null});
  });
  it("refuses a resolution that does not echo a field the request gave (spec M5)",async()=>{
    const h=await fixture("rewrite-model");
    await expect(h.port.resolveAgent({agent:"codex",model:"claude-opus-5-5"})).rejects.toMatchObject({code:"control-response-invalid",detail:"selection-not-echoed:model"});
    // A field the request left to the descriptor may come back as anything the descriptor says.
    expect((await h.port.resolveAgent({agent:"codex"})).selection.model).toBe("rewritten-model");
  });
  it("refuses a capabilities answer in the retired protocol-2 shape",async()=>{
    await expect((await fixture("protocol-2")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-invalid");
    await expect((await fixture("protocol-2")).port.listAgents()).rejects.toThrow("control-response-invalid");
  });
  it("TEMPORARY (plan T11 deletes it): a probe given no selection asks about the table's first installation, with nothing overridden",async()=>{
    const h=await fixture("ok",{installations:[{id:"zeta",kind:"claude",defaults:{model:"m",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"1.0.0"},{id:"alpha",kind:"codex",defaults:{model:"m",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"1.0.0"}]});
    const router=createExecutionProfileRouter([resolveProfile(probeSnapshot(),h.port)]);
    expect((await router.probe(router.list()[0]!)).probeFailureCode).toBe(null);
    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:{agent:"alpha"}});
    const empty=await fixture("ok",{installations:[]});
    const emptyRouter=createExecutionProfileRouter([resolveProfile(probeSnapshot(),empty.port)]);
    expect((await emptyRouter.probe(emptyRouter.list()[0]!)).probeFailureCode).toBe("control-capability-probe-failed");
  });
  it("rethrows ccloop's named refusals of a selection or table under their own names, and any other exit as a peer exit (agent selection spec §7)",async()=>{
    for(const code of ["agent-installation-missing","agent-context-unsupported","agent-selection-invalid","agent-version-drift","agents-table-invalid"]){
      await expect((await fixture("ok",{refuse:`${code}: detail`})).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({name:"ControlError",code});
    }
    await expect((await fixture("ok",{refuse:"agents-table-invalid"})).port.listAgents()).rejects.toMatchObject({code:"agents-table-invalid"});
    // Plan P15 (real ccloop T5): a named refusal that is not about the selection or table (exit 2) and an unnamed
    // failure (exit 1) both stay peer exits, carrying ccloop's exit code and stderr.
    await expect((await fixture("ok",{refuse:"control-protocol-unsupported"})).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({code:"control-peer-exit",detail:"2:control-protocol-unsupported"});
    await expect((await fixture("ok",{fail:"control-json-invalid"})).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({code:"control-peer-exit",detail:"1:control-json-invalid"});
  });
  it("reads ccloop's error code out of a peer exit, and nothing out of any other failure",async()=>{
    const refused=await (await fixture("exit2")).port.resolveAgent({agent:"codex"}).catch((error:unknown)=>error);
    expect(peerErrorCode(refused)).toBe("remote-refusal");
    // Plan P15: the literal real ccloop produces -- exit 2, stderr `<code>: <detail>`.
    expect(peerErrorCode(new ControlError("control-peer-exit","2:agent-version-drift: table says 2.1.0"))).toBe("agent-version-drift");
    expect(peerErrorCode(new ControlError("control-response-invalid"))).toBe(null);
    expect(peerErrorCode(new Error("control-peer-exit:2:agent-version-drift"))).toBe(null);
  });
});
