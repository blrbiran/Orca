// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {SavedResultAction,TaskDetail} from '../src/TaskDetail.js';
import {view,run,workItem} from './fixtures/board.js';
import i18n from '../src/i18n.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('enables the actual task-detail action with the authoritative null stop mode and disables it under a pause',async()=>{
 await i18n.changeLanguage('en');const recoveryOf={sourceRunId:'run-a',sourceAttempt:1,capsuleHash:'a'.repeat(64),snapshotHash:'b'.repeat(64),normalizedExecutionHash:'c'.repeat(64)};
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/saved-result-eligibility')?new Response(JSON.stringify({status:'eligible',recoveryOf}),{status:200,headers:{'content-type':'application/json'}}):new Response('',{status:404})));
 const item=workItem({currentRunId:'run-a',lineageRunIds:['run-a']}),group=view([item],[run({state:'blocked',outcome:'failed'})]),props={item,drafts:{},onDraft:vi.fn(),onCommand:vi.fn()};
 const {rerender}=render(<TaskDetail view={group} {...props}/>);const button=await screen.findByRole('button',{name:'Verify saved results'});expect((button as HTMLButtonElement).disabled).toBe(false);
 rerender(<TaskDetail view={{...group,summary:{...group.summary,stopMode:'pause'},stop:{mode:'pause',state:'paused',frozenRunIds:[],acceptedAt:null,deadlineAt:null}}} {...props}/>);expect((screen.getByRole('button',{name:'Verify saved results'}) as HTMLButtonElement).disabled).toBe(true);expect(props.onCommand).not.toHaveBeenCalled();
});
it('shows verification cost and sends the source tuple at the visible revision in both languages',async()=>{
 for(const [language,label] of [['zh','验证已保存成果'],['en','Verify saved results']]){
  await i18n.changeLanguage(language);
  const recoveryOf={sourceRunId:'old',sourceAttempt:1,capsuleHash:'a'.repeat(64),snapshotHash:'b'.repeat(64),normalizedExecutionHash:'c'.repeat(64)};
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'eligible',recoveryOf})})));
  const onCommand=vi.fn();render(<SavedResultAction runId="old" groupId="g" taskId="a" revision={7} changeSeq={2} onCommand={onCommand}/>);
  fireEvent.click(await screen.findByRole('button',{name:label}));
  expect(onCommand).toHaveBeenCalledWith({verb:'verify-saved-result',groupId:'g',taskId:'a',expectedRevision:7,payload:{sourceRunId:'old',sourceAttempt:1,capsuleHash:'a'.repeat(64)}});
  expect(screen.getByText(language==='zh'?'跳过执行；校验和验证可能消耗模型用量。':'Execution is skipped; validation and verification may consume model usage.')).toBeTruthy();cleanup();
 }
});
it('keeps a precise unavailable reason and never dispatches from availability polling',async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({status:'unavailable',reason:'saved-result-legacy-ref-missing'})}));vi.stubGlobal('fetch',fetch);const onCommand=vi.fn();
 render(<SavedResultAction runId="old" groupId="g" taskId="a" revision={7} changeSeq={2} onCommand={onCommand}/>);
 await screen.findByText(/saved-result-legacy-ref-missing/);expect(onCommand).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Verify saved results'})).toBeNull();
});

import {retryRunOpen,lineageRunNumber} from '../src/runFacts.js';
it('offers explicit ordinary retry for a proven no-dispatch recovery and keeps it out of provider run counts',()=>{
 const run:any={runId:'never',taskId:'a',state:'settled-restartable',outcome:null,recoveryOf:{sourceRunId:'old'},savedResultOrdinaryRetry:true};
 const view:any={stop:null,summary:{state:'running'},workItems:[{taskId:'a',currentRunId:'never',pendingRunId:null,status:'ready'}],ledger:{usageUnknown:false},handoffRequests:[]};
 expect(retryRunOpen(view,run)).toBe(true);expect(lineageRunNumber(['never'],[run])).toBe(0);expect(retryRunOpen(view,{...run,savedResultOrdinaryRetry:false})).toBe(false);
});
