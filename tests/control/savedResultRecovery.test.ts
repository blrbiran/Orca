import { describe, expect, it } from 'vitest';
import { unknownFailure, settle } from './fixtures/unknownFailure.js';
import { rawAuthorityCommandSchema } from '../../src/control/webProtocol.js';

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
 it('refuses a settled historical source once an ordinary retry has replaced its task membership', async () => {
  const {t,runId}=await unknownFailure([{taskId:'a'}],true,{extraReserve:true});
  try {
   expect(await settle(t,runId)).not.toHaveProperty('error');
   expect(t.service.retryTask(t.h.command('retry-task',{taskId:'a'}))).not.toHaveProperty('error');
   expect(await (t.service as any).savedResultEligibility(runId)).toMatchObject({status:'unavailable',reason:'saved-result-source-stale'});
  } finally {t.h.store.close();}
 });
});
