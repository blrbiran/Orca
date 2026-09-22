import { chmod, copyFile, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { createExecutionProfileRouter, intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

async function fixture(mode = "ok", extra:Record<string,unknown> = {}) {
  const root=await realpath(await mkdtemp(join(tmpdir(),"orca-ccloop-port-")));
  const binary=join(root,"fake;ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"),binary);await chmod(binary,0o700);
  const record=join(root,"record.json"),config=join(root,"adapter.json");
  await writeFile(config,JSON.stringify({mode,record,...extra}),{mode:0o600});
  const port=createCcloopExecutionPort({binary,adapter:"codex",adapterConfigPath:config,timeoutMs:10_000});
  const envelope:StartEnvelope={protocol:1,claim:{groupId:"g",workItemId:"w",taskId:"t",runId:"r",generation:1,graphVersion:1,targetVersion:1,commandId:"c",configHash:"a".repeat(64),grant:{work:{tokens:1,activeMs:1,attempts:1,sessions:1},handoff:{tokens:1,activeMs:1,attempts:0,sessions:0}},ownerToken:"owner"},contractHash:"b".repeat(64),inputCheckpoint:null,work:{contract:{objective:"ship",scope:{allowedPaths:["src/**"]},acceptance:{commands:["true"]}},targetRepo:root,base:"HEAD",sourceDir:root}};
  return {root,binary,config,record,port,envelope};
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
    const h=await fixture();
    const router=createExecutionProfileRouter([resolveProfile(probeSnapshot(),h.port)]);
    const observation=await router.probe(router.list()[0]!);
    expect(observation.probeFailureCode).toBe(null);
    expect(observation.probeFailureCode).not.toBe("control-capability-probe-failed");
  });
  it("states only what ccloop states, and says unavailable for the rest rather than inventing it",async()=>{
    // ccloop's `control capabilities` answers seven fields and none of them describes context
    // observation, handoff control or execution, a context window, or a request-bound proof
    // descriptor. Each `unavailable`/`null` below is the absence of a ccloop answer, not a guess.
    const h=await fixture();
    expect(await h.port.probeProfileCapabilities!()).toEqual({
      usageObservation:"phase-end",
      budgetEnforcement:"soft",
      contextObservation:"unavailable",
      handoffControl:"unavailable",
      handoffExecution:null,
      contextWindowTokens:null,
      requestBoundProof:null,
    });
  });
  it("therefore fails a claim closed on capabilities, which is the accurate answer until ccloop grows the probe",async()=>{
    // Named here so the gap cannot be mistaken for a regression: exposing the probe changes the
    // refusal from "the probe failed" to "the peer does not offer this", and does not make Web
    // dispatch to real ccloop work. That needs a ccloop-side change.
    const h=await fixture();
    const declared=probeSnapshot().profile.capabilities;
    const observed=intersectCapabilities(declared,await h.port.probeProfileCapabilities!());
    expect(observed.handoffControl).toBe("unavailable");
    expect(observed.handoffExecution).toBe(null);
  });
  it("uses direct argv plus stdin JSON and validates successful responses",async()=>{
    const h=await fixture();expect(await h.port.capabilities()).toMatchObject({protocol:1,budgetEnforcement:"soft"});
    expect(await h.port.accept(h.envelope)).toEqual({kind:"accepted",executionId:"execution-1",configHash:"a".repeat(64)});
    const recorded=JSON.parse(await readFile(h.record,"utf8"));expect(recorded.argv).toEqual(["control","accept","--adapter","codex","--adapter-config",h.config]);expect(JSON.parse(recorded.stdin)).toEqual(h.envelope);
  });
  it("propagates exit 2 stably and refuses malformed or oversized stdout",async()=>{
    await expect((await fixture("exit2")).port.capabilities()).rejects.toMatchObject({
      name: "ControlError", code: "control-peer-exit", detail: "2:remote-refusal", message: "control-peer-exit:2:remote-refusal",
    });
    await expect((await fixture("bad-json")).port.capabilities()).rejects.toThrow("control-response-invalid");
    await expect((await fixture("oversized")).port.capabilities()).rejects.toThrow("control-response-too-large");
  });
  it("validates evidence identity, base64 and hash",async()=>{
    const ref={artifactId:"evidence-proof",hash:createHash("sha256").update("proof").digest("hex")},h=await fixture("ok",{evidence:"proof",collectRef:ref});
    await h.port.collect(h.envelope,0);expect((await h.port.readEvidence(ref)).toString()).toBe("proof");
    const bad=await fixture("ok",{evidence:"proof",badHash:true,collectRef:ref});await bad.port.collect(bad.envelope,0);await expect(bad.port.readEvidence(ref)).rejects.toThrow("artifact-hash-mismatch");
  });
  it("requires absolute canonical regular binary and config files",async()=>{
    const h=await fixture();expect(()=>createCcloopExecutionPort({binary:"relative",adapter:"codex",adapterConfigPath:h.config,timeoutMs:1})).toThrow("control-binary-invalid");
    const link=join(h.root,"config-link");await symlink(h.config,link);expect(()=>createCcloopExecutionPort({binary:h.binary,adapter:"codex",adapterConfigPath:link,timeoutMs:1})).toThrow("control-adapter-config-invalid");
  });
});
