import { describe, it, expect, afterAll } from 'vitest';
import { readTaskResultState, readOwnedTaskResultEvidence } from '../../src/control/taskResultStore.js';
import { flushTaskResults } from '../../src/control/taskResultCollector.js';
import { readStartEnvelope } from '../../src/control/executionDriver.js';
import { TaskResultUnsupportedError } from '../../src/control/taskResultProtocol.js';
import { readRunResults } from '../../src/panel/taskResults.js';
import { ccloopWorlds, realBinary, raw, startGroup, until, workRuns } from './fixtures/ccloopWorld.js';
// Ruling (session 4de777f4, 2026-10-17, the human authorized rewriting these two criteria): the build is no longer
// matched against two hardcoded /private/tmp paths, which made both criteria red in every gate. Only the historical
// ab824d1 build refuses task results; every build ORCA_CCLOOP_BIN names today carries the transport, so it is paired.
const fixed = '/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js';
const paired = realBinary !== fixed;
const worlds = ccloopWorlds({ rootPrefix: 'orca-task-result-paired-', epochPrefix: 'epoch-result-paired-' });
afterAll(worlds.removeRoots);
// Default and feature are deliberately separate native gates/environments; neither changes the package pin.
describe.skipIf(!realBinary)('result optional transport exact build', { timeout: 120000 }, () => {
    worlds.relocateHome('orca-task-result-paired-home-');
    it('proves fixed-pin refusal or live saved results before a terminal candidate using the exact selected CLI', async () => {
        const w = await worlds.world([{ taskId: 'a', targetPaths: ['shared.txt'] }], { a: { files: { 'shared.txt': 'A\n' }, delayMs: { verify: paired ? 6000 : 0 } } });
        const runtime = await w.boot();
        try {
            await startGroup(runtime, w.repoId);
            runtime.startPump(50);
            await until(() => workRuns(runtime).some(r => r.body.executionId !== null), 30000, 'accepted run');
            const run = workRuns(runtime)[0];
            if (!paired) {
                const input = readStartEnvelope(runtime.store, run.body as never);
                await expect(runtime.port.collectTaskResults!(input, 0)).rejects.toBeInstanceOf(TaskResultUnsupportedError);
                await until(() => workRuns(runtime)[0]?.body.state === 'settled', 60000, 'fixed pin business settlement');
                await flushTaskResults(runtime.store, run.runId);
                expect(readTaskResultState(runtime.store, run.runId)).toMatchObject({ status: 'unsupported', observations: [] });
            }
            else {
                try {
                    await until(() => readTaskResultState(runtime.store, run.runId)?.observations.some(o => o.verification === 'in-progress') === true, 30000, 'real live verifier start');
                }
                catch (error) {
                    const saved = readTaskResultState(runtime.store, run.runId);
                    console.error('paired diagnostic', JSON.stringify({ saved, phase: workRuns(runtime)[0]?.body.state, calls: w.calls() }));
                    throw error;
                }
                const live = readTaskResultState(runtime.store, run.runId)!;
                expect(live).toMatchObject({ status: 'available', revision: 2, currentAttempt: 1 });
                const now = workRuns(runtime)[0].body;
                expect(now.state).toBe('accepted');
                const input = readStartEnvelope(runtime.store, now as never);
                const core = await runtime.port.collect(input, now.highWater);
                expect(core.candidate).toBeNull();
                expect(core.terminal).toBeNull();
                const execution = live.observations[0], output = execution.manifest.outputs.find(o => o.path === 'shared.txt')!;
                expect((await readOwnedTaskResultEvidence(runtime.store, run.runId, 1, execution.manifestRef, output.ref!)).toString()).toBe('A\n');
                await until(() => workRuns(runtime)[0]?.body.state === 'settled', 60000, 'paired business settlement');
                await flushTaskResults(runtime.store, run.runId);
                expect(readTaskResultState(runtime.store, run.runId)?.observations.map(o => o.verification)).toEqual(['unavailable', 'in-progress', 'passed']);
            }
            expect(w.calls()).toEqual(['plan', 'execute', 'verify']);
            expect(workRuns(runtime)[0].body).toMatchObject({ state: 'settled', recoverable: true });
            expect(await runtime.shutdown()).toBe(true);
        }
        finally {
            await w.teardown();
        }
    });
    it('proves actual pre-verifier handoff not-run on feature and explicit unsupported on fixed pin',async()=>{
        const w=await worlds.world([{taskId:'a',targetPaths:['shared.txt']}],{a:{files:{'shared.txt':'A\n'},delayMs:{execute:6000}}});const runtime=await w.boot();
        try{await startGroup(runtime,w.repoId);runtime.startPump(50);await until(()=>w.calls().includes('execute'),30000,'real execute before handoff');const run=workRuns(runtime)[0];
            const stopped=await runtime.service.handoffStop(raw(runtime,'result4-handoff','handoff-stop',{}));expect(stopped).toMatchObject({result:{kind:'handoff-stopped'}});
            await until(()=>workRuns(runtime)[0]?.body.state==='settled-recoverable',60000,'actual post-execute handoff settlement');await flushTaskResults(runtime.store,run.runId);
            const saved=readTaskResultState(runtime.store,run.runId);const view=await readRunResults(runtime.store,run.runId,{epoch:runtime.epoch});
            if(paired){expect(saved?.observations.map(o=>o.verification)).toEqual(['unavailable','not-run']);expect(view.attempts[0].verification).toBe('not-run');expect(view.attempts[0].snapshotRevision).toBe(1);const execution=saved!.observations[0],boundary=saved!.observations[1];expect(boundary.manifest.outputs).toEqual(execution.manifest.outputs);expect(boundary.manifest.executionRef).toEqual(execution.manifest.executionRef);expect(JSON.parse((await readOwnedTaskResultEvidence(runtime.store,run.runId,1,boundary.manifestRef,boundary.manifest.verificationRef!)).toString())).toEqual({schema:'ccloop-task-result-verification-not-run-v1',attempt:1,status:'not-run'});const output=boundary.manifest.outputs.find(o=>o.path==='shared.txt')!;expect((await readOwnedTaskResultEvidence(runtime.store,run.runId,1,boundary.manifestRef,output.ref!)).toString()).toBe('A\n');}
            else{expect(saved).toMatchObject({status:'unsupported',observations:[]});expect(view.source.status).toBe('unsupported');expect(view.attempts).toEqual([]);}
            expect(w.calls()).toEqual(['plan','execute']);expect(workRuns(runtime)[0].body).toMatchObject({state:'settled-recoverable',recoverable:true});expect(await runtime.shutdown()).toBe(true);
        }finally{await w.teardown();}
    });

});
