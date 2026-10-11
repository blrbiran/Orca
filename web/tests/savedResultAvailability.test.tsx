// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import {TaskDetail,SavedResultAction} from '../src/TaskDetail.js';
import {view,run,workItem} from './fixtures/board.js';
import i18n from '../src/i18n.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const recoveryOf={sourceRunId:'source',sourceAttempt:1,capsuleHash:'a'.repeat(64),snapshotHash:'b'.repeat(64),normalizedExecutionHash:'c'.repeat(64)};
it.each(['en','zh'])('omits saved recovery for an actually done/succeeded task in %s',async language=>{
 await i18n.changeLanguage(language);const fetch=vi.fn(async(_input:RequestInfo|URL)=>new Response('',{status:404}));vi.stubGlobal('fetch',fetch);
 const item=workItem({status:'completed',currentRunId:'recovered',lineageRunIds:['source','recovered']}),group=view([item],[run({runId:'source',state:'settled-failed',outcome:'failed'}),run({runId:'recovered',state:'settled-recoverable',outcome:'succeeded',recoveryOf})]);
 render(<TaskDetail view={group} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);await waitFor(()=>expect(fetch).toHaveBeenCalled());
 expect(fetch.mock.calls.some(args=>String(args[0]).endsWith('/saved-result-eligibility'))).toBe(false);expect(screen.queryByRole('button',{name:language==='en'?'Verify saved results':'验证已保存成果'})).toBeNull();expect(screen.queryByText(language==='en'?/ordinary retry is available/:/可使用普通重试/)).toBeNull();
});
it.each(['en','zh'])('uses truthful neutral unavailable copy for usage settlement, stop and archive in %s',async language=>{
 await i18n.changeLanguage(language);
 for(const reason of ['saved-result-usage-unsettled','stop-mode-conflict','group-archived']){
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'unavailable',reason})})));const onCommand=vi.fn();render(<SavedResultAction runId="source" groupId="g" taskId="a" revision={1} changeSeq={1} onCommand={onCommand} disabled/>);
  await screen.findByText(reason);expect(screen.queryByText(language==='en'?/ordinary retry is available/:/可使用普通重试/)).toBeNull();expect(onCommand).not.toHaveBeenCalled();cleanup();
 }
});
