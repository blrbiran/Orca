import express from 'express';
import {createServer} from 'node:http';
import {it,expect} from 'vitest';
import {registerControlMutationRoutes} from '../../src/panel/controlApi.js';
import {unknownFailure} from '../control/fixtures/unknownFailure.js';
import type {Principal} from '../../src/panel/permissions.js';

it.each([{kind:'user',userId:'member',name:'member',roles:['member']},{kind:'agent',client:'mcp:saved'}] as Principal[])('admits the retry-equivalent permission and books the authenticated $kind principal on a precise refusal',async principal=>{
 const {t,runId}=await unknownFailure();const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.orcaPrincipal=principal;next();});registerControlMutationRoutes(app,t.h.store,t.service,principal.kind==='agent'?'socket':'web');const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try {
  const address=server.address() as {port:number},commandId=`verify-${principal.kind}`;
  const response=await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/tasks/a/verify-saved-result`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId,expectedRevision:Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),payload:{sourceRunId:runId,sourceAttempt:1,capsuleHash:'a'.repeat(64)}})});
  expect(response.status).toBe(409);expect(await response.json()).toHaveProperty('error.code','saved-result-unavailable');
  expect(t.h.store.db.prepare('SELECT principal,client,verb FROM commands WHERE id=?').get(commandId)).toEqual({principal:principal.kind==='user'?'user:member':'agent:mcp:saved',client:principal.kind==='user'?'web':'mcp:saved',verb:'verify-saved-result'});
 }finally{await new Promise<void>(r=>server.close(()=>r()));await t.h.dispose();}
});
