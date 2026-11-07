import { describe, expect, it } from 'vitest';
import { unknownFailure, settle } from './fixtures/unknownFailure.js';
import { rawAuthorityCommandSchema } from '../../src/control/webProtocol.js';
import { driverHarness } from './fixtures/driverHarness.js';

describe('saved result controller authority', () => {
 it('accepts only the explicit task-scoped original source tuple', () => {
  const command={schema:'orca-raw-command-v1',commandId:'verify-command',actorId:'member',expectedRevision:3,verb:'verify-saved-result',target:{kind:'task',groupId:'g',taskId:'a'},payload:{sourceRunId:'source',sourceAttempt:1,capsuleHash:'a'.repeat(64)}};
  expect(rawAuthorityCommandSchema.safeParse(command).success).toBe(true);
  expect(rawAuthorityCommandSchema.safeParse({...command,payload:{...command.payload,sourceAttempt:0}}).success).toBe(false);
  expect(rawAuthorityCommandSchema.safeParse({...command,payload:{...command.payload,free:true}}).success).toBe(false);
 });
 it('reads unavailable accounting without creating a command, run, reservation or provider call', async () => {
  const {t,runId}=await unknownFailure();
  try {
   const before=t.h.store.db.prepare('SELECT body FROM groups WHERE id=?').get('g');
   const runs=t.h.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n;
   const commands=t.h.store.db.prepare('SELECT COUNT(*) AS n FROM commands').get()?.n;
   const answer=await (t.service as any).savedResultEligibility(runId);
   expect(answer).toMatchObject({status:'unavailable',reason:'saved-result-usage-unsettled'});
   expect(t.h.store.db.prepare('SELECT body FROM groups WHERE id=?').get('g')).toEqual(before);
   expect(t.h.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(runs);
   expect(t.h.store.db.prepare('SELECT COUNT(*) AS n FROM commands').get()?.n).toBe(commands);
  } finally {t.h.store.close();}
 });
 it('names an exhausted current run without execution proof instead of calling it stale', async () => {
  const t=await driverHarness([{taskId:'a'}],{behaviour:()=> 'exhausted',sealedOwnerProof:true});
  try {
   const runId=await t.claim();
   await t.until(t.driver(),()=>t.body(runId).state==='blocked');
   expect(t.body(runId).drive?.outcome).toBe('exhausted');
   expect(await t.service.savedResultEligibility(runId)).toEqual({status:'unavailable',reason:'saved-result-exhausted'});
  } finally {await t.h.dispose();}
 });
 it('opens the exhausted gate only for a producer-captured completion source, and still refuses evidence it cannot read', async () => {
  const t=await driverHarness([{taskId:'a'}],{behaviour:()=> 'exhausted',sealedOwnerProof:true});
  try {
   const runId=await t.claim();
   await t.until(t.driver(),()=>t.body(runId).state==='blocked');
   expect(await t.service.savedResultEligibility(runId)).toEqual({status:'unavailable',reason:'saved-result-exhausted'});
   // The gate is the source kind, not the outcome: a captured completion source is read, and its missing artifact is a
   // different refusal than "no producer evidence".
   t.h.store.transaction(()=>{const body=JSON.parse(String(t.h.store.db.prepare('SELECT body FROM runs WHERE id=?').get(runId)!.body));
    body.savedSource={authorityKind:'execution-complete-before-verification-v1',source:{artifactId:`saved-result-${'a'.repeat(64)}`,hash:'a'.repeat(64)},attempt:1};
    t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body),runId);});
   expect((await t.service.savedResultEligibility(runId)).reason).not.toBe('saved-result-exhausted');
  } finally {await t.h.dispose();}
 });
 it('refuses a settled historical source once an ordinary retry has replaced its task membership', async () => {
  const {t,runId}=await unknownFailure([{taskId:'a'}],true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   expect(t.service.retryTask(t.h.command('retry-task',{taskId:'a'}))).not.toHaveProperty('error');
   expect(await (t.service as any).savedResultEligibility(runId)).toMatchObject({status:'unavailable',reason:'saved-result-source-stale'});
  } finally {t.h.store.close();}
 });
 // Task setup spec 2026-11-04 §4.6 (A6): recovery re-runs the checks without the contract's setup, so it would judge a
 // different environment. Refused by name, at the command and at dispatch.
 const verify=(t:any,runId:string)=>t.service.verifySavedResult(t.h.taskCommand('verify-saved-result','a',{sourceRunId:runId,sourceAttempt:1,capsuleHash:'a'.repeat(64)}));
 it('refuses verify-saved-result of a task whose contract has setup, by name',async()=>{
  const {t,runId}=await unknownFailure([{taskId:'a',contextExtra:{setupCommands:['npm ci']}}] as any,true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   expect(await verify(t,runId)).toMatchObject({error:{code:'saved-result-unavailable',message:expect.stringContaining('setup-unsupported-here')}});
  } finally {t.h.store.close();}
 });
 // Final-review fix wave (minor 2): the eligibility the task page reads does not offer the recovery the command refuses.
 it('answers the eligibility of a task with setup unavailable by name, and a task without setup on its own reason',async()=>{
  const {t,runId}=await unknownFailure([{taskId:'a',contextExtra:{setupCommands:['npm ci']}}] as any,true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   // Mutation m2-M1 (no setup check in readSavedResultEligibility) -> another reason, red.
   expect(await (t.service as any).savedResultEligibility(runId)).toMatchObject({status:'unavailable',reason:'setup-unsupported-here'});
  } finally {t.h.store.close();}
  const plain=await unknownFailure([{taskId:'a'}],true,{extraReserve:true});
  try {
   expect(await settle(plain.t,plain.runId)).not.toHaveProperty('error');
   expect((await (plain.t.service as any).savedResultEligibility(plain.runId)).reason).not.toBe('setup-unsupported-here');
  } finally {plain.t.h.store.close();}
 });
 it('leaves a task without setup on its own reason (the refusal is about setup, not about every unsettled source)',async()=>{
  const {t,runId}=await unknownFailure([{taskId:'a'}],true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   const answer:any=await verify(t,runId);
   expect(answer).toMatchObject({error:{code:'saved-result-unavailable'}});
   expect(answer.error.message).not.toContain('setup');
   expect(JSON.stringify(answer)).not.toContain('setup-unsupported-here');
  } finally {t.h.store.close();}
 });
 it('blocks a recovery run of a task with setup at dispatch, before any workspace exists',async()=>{
  const t=await driverHarness([{taskId:'a',contextExtra:{setupCommands:['npm ci']}}] as any);
  try {
   const runId=await t.claim();
   await t.driver().round();
   const body:any=t.body(runId);body.mode='verify-saved-result';
   t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body),runId);
   await t.driver().round();
   expect(t.body(runId).drive.blockedReason).toBe('setup-unsupported-here');
   expect(t.fake.calls.accept).toHaveLength(0);
  } finally {t.h.store.close();}
 });
 it('does not block a recovery run of a task without setup on setup',async()=>{
  const t=await driverHarness([{taskId:'a'}]);
  try {
   const runId=await t.claim();
   await t.driver().round();
   const body:any=t.body(runId);body.mode='verify-saved-result';
   t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body),runId);
   try{await t.driver().round();}catch{/* assertCurrentSavedRecovery refuses a run with no recovery record */}
   expect(t.body(runId).drive?.blockedReason).not.toBe('setup-unsupported-here');
  } finally {t.h.store.close();}
 });
 it('answers a target that is not a task of the group exactly as it would without the setup lookup, not with a lookup error',async()=>{
  const {t,runId}=await unknownFailure([{taskId:'a'}],true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   const body={sourceRunId:runId,sourceAttempt:1,capsuleHash:'a'.repeat(64)};
   const known:any=await t.service.verifySavedResult(t.h.taskCommand('verify-saved-result','a',body));
   const unknown:any=await t.service.verifySavedResult(t.h.taskCommand('verify-saved-result','nope',body));
   // A failed contract lookup must fall through to the identity/source checks, which answer the same way for any target here.
   expect(unknown.error.code).toBe(known.error.code);
   expect(unknown.error.message).toBe(known.error.message);
  } finally {t.h.store.close();}
 });
});
