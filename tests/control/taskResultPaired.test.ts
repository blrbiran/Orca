import { describe, it, expect, afterAll } from 'vitest';
import { readTaskResultState, readOwnedTaskResultEvidence } from '../../src/control/taskResultStore.js';
import { flushTaskResults } from '../../src/control/taskResultCollector.js';
import { readStartEnvelope } from '../../src/control/executionDriver.js';
import { TaskResultUnsupportedError } from '../../src/control/taskResultProtocol.js';
import { ccloopWorlds, realBinary, startGroup, until, workRuns } from './fixtures/ccloopWorld.js';
const feature = '/private/tmp/orca-results-ccloop-20261010/dist/cli.js';
const fixed = '/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js';
const worlds = ccloopWorlds({ rootPrefix: 'orca-task-result-paired-', epochPrefix: 'epoch-result-paired-' });
afterAll(worlds.removeRoots);
// Default and feature are deliberately separate native gates/environments; neither changes the package pin.
describe('result optional transport exact build', { timeout: 120000 }, () => {
    worlds.relocateHome('orca-task-result-paired-home-');
    it('proves fixed-pin refusal or live saved results before a terminal candidate using the exact selected CLI', async () => {
        expect([fixed, feature]).toContain(realBinary);
        const paired = realBinary === feature;
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
});
