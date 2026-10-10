import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resultFixture, context } from './fixtures/taskResults.js';
import { readRunResults, readGroupResults } from '../../src/panel/taskResults.js';
import { readTaskResultState } from '../../src/control/taskResultStore.js';
import { readArchivedPlan } from '../../src/control/queries.js';
import { runResultsSchema, groupResultsSchema } from '../../src/control/webProtocol.js';
const approved = (value: boolean) => ({
    approved: value, rejectCategory: value ? 'none' : 'test', primaryTargetPaths: [], failingCommand: null, safeToRetry: true, evidence: [], pauseSignals: [], stopSignals: []
});
const view = (f: Awaited<ReturnType<typeof resultFixture>>) => readRunResults(f.store, f.runId, context);
const mutateState = (f: Awaited<ReturnType<typeof resultFixture>>, fn: (state: any) => void) => { const state = readTaskResultState(f.store, f.runId)!; fn(state); f.store.db.prepare('UPDATE outbox SET body=? WHERE id=?').run(JSON.stringify(state), 'task-results:' + f.runId); };
describe('admitted run and group result facts', { timeout: 30000 }, () => {
    it('isolates rejected attempt from later approval and exposes exact immutable observation history', async () => {
        const f = await resultFixture();
        try {
            const first = f.manifest();
            await f.capture([first]);
            expect((await view(f)).attempts[0].snapshotRevision).toBe(1);
            const started = {
                ...f.manifest(2), stage: 'verification' as const,
                verificationRef: f.add({
                    schema: 'ccloop-task-result-verification-started-v1', attempt: 1, status: 'in-progress'
                })
            };
            await f.capture([started]);
            const running = await view(f);
            expect(running.attempts[0].snapshotRevision).toBe(1);
            expect(running.attempts[0].verification).toBe('in-progress');
            const rejected = {
                ...f.manifest(3), stage: 'verification' as const, verificationRef: f.add(approved(false))
            };
            await f.capture([rejected]);
            const completed = await view(f);
            expect(completed.attempts[0].snapshotRevision).toBe(1);
            expect(completed.attempts[0].verification).toBe('failed');
            expect(readTaskResultState(f.store, f.runId)!.observations.map(o => o.manifest.outputs)).toEqual([first.outputs, first.outputs, first.outputs]);
            const second = f.manifest(4, 2), accepted = {
                ...f.manifest(5, 2), stage: 'verification' as const, verificationRef: f.add(approved(true))
            };
            await f.capture([second, accepted]);
            const r = await view(f);
            expect(r.captureRevision).toBe(5);
            expect(r.currentAttempt).toBe(2);
            expect(r.attempts.map(a => a.verification)).toEqual(['failed', 'passed']);
            expect(r.attempts.map(a => a.current)).toEqual([false, true]);
            expect(r.attempts[0].observations.map(o => o.revision)).toEqual([1, 2, 3]);
            expect(r.attempts.map(a => a.snapshotRevision)).toEqual([1, 4]);
            expect(runResultsSchema.safeParse({ ...r, surprise: true }).success).toBe(false);
        }
        finally {
            await f.dispose();
        }
    });
    it('uses independently newer source attempt after failed page while core is older, without reusing explanation', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            f.core({ progress: {
                    status: 'executing', currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: '2026-10-10T00:00:00Z'
                } });
            const m = f.manifest(2, 2);
            f.files.delete(f.report.artifactId);
            await f.capture([m], 2);
            const r = await view(f);
            expect(r.currentAttempt).toBe(2);
            expect(r.captureRevision).toBe(1);
            expect(r.source.status).toBe('stale');
            expect(r.currentExplanation.status).toBe('missing');
            expect(r.attempts[0].current).toBe(false);
            expect(r.attempts[0].explanation.status).toBe('available');
        }
        finally {
            await f.dispose();
        }
    });
    it('unknown or foreign current facts do not promote saved history to current', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            for (const mode of ['absent', 'foreign']) {
                mutateState(f, s => {
                    if (mode === 'absent')
                        delete s.currentAttemptFact;
                    else
                        s.currentAttemptFact = {
                            schema: 'orca-task-result-current-attempt-v1', identity: { ...f.identity, groupId: 'foreign' }, revision: 1, currentAttempt: 1
                        };
                });
                const r = await view(f);
                expect(r.currentAttempt).toBeNull();
                expect(r.currentExplanation.status).toBe('unavailable');
                expect(r.attempts[0].current).toBe(false);
            }
        }
        finally {
            await f.dispose();
        }
    });
    it('actual started evidence shows in-progress only on current active lifecycle, never core verifying alone', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            f.core({ progress: {
                    status: 'verifying', currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: '2026-10-10T00:00:00Z'
                } });
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
            const start = {
                ...f.manifest(2), stage: 'verification' as const, verificationRef: f.add({
                    schema: 'ccloop-task-result-verification-started-v1', attempt: 1, status: 'in-progress'
                })
            };
            await f.capture([start]);
            expect((await view(f)).attempts[0].verification).toBe('in-progress');
            f.core({ drive: { ...f.t.body(f.runId).drive, outcome: 'cancelled' } });
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
        }
        finally {
            await f.dispose();
        }
    });
    it.each([{ failureType: 'timeout' }, { failureType: 'error', partialOrigin: 'runner' }, { failureType: 'error', changedFiles: [] }])('retained partial core facts prove actual verifier bypass: %j', async (partial) => {
        const f = await resultFixture();
        try {
            const m = f.manifest();
            m.executionRef = f.add({
                changedFiles: ['a'], diffPatch: '', commandOutputs: [], stdoutStderrLog: '', completionStatus: 'partial', failureMessage: 'actual runner failure', ...partial
            });
            await f.capture([m]);
            const r = await view(f);
            expect(r.attempts[0].execution).toBe('partial');
            expect(r.attempts[0].verification).toBe('not-run');
        }
        finally {
            await f.dispose();
        }
    });
    it('error partial with changed files may actually verify and must not claim verifier bypass', async () => {
        const f = await resultFixture();
        try {
            const m = f.manifest();
            m.executionRef = f.add({
                changedFiles: ['a'], diffPatch: '', commandOutputs: [], stdoutStderrLog: '', completionStatus: 'partial', failureType: 'error', failureMessage: 'execute error'
            });
            await f.capture([m]);
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
        }
        finally {
            await f.dispose();
        }
    });
    it('damaged completed verifier bytes become unavailable, despite stored passed summary or agent claims', async () => {
        const f = await resultFixture();
        try {
            const ref = f.add(approved(true));
            await f.capture([f.manifest(), {
                    ...f.manifest(2), stage: 'verification', verificationRef: ref
                }]);
            expect((await view(f)).attempts[0].verification).toBe('passed');
            await writeFile(join(f.store.stateDir, 'artifacts', ref.artifactId, 'data'), 'damaged');
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
        }
        finally {
            await f.dispose();
        }
    });
    it('group follows archived plan order and distinguishes unstarted coverage from missing supported results and independent delivery/review', async () => {
        const f = await resultFixture([{ taskId: 'z' }, { taskId: 'a' }]);
        try {
            const before = await readGroupResults(f.store, 'g', context);
            expect(before.tasks.map(t => t.taskId)).toEqual(readArchivedPlan(f.store, 'g').plan.tasks.map(t => t.taskId));
            expect(before.tasks[0].availability).toBe('missing');
            expect(before.tasks[1].availability).toBe('not-produced');
            expect(before.coverage).toEqual({
                total: 2, available: 0, partial: 0, missing: 1, unavailable: 0, notProduced: 1
            });
            expect(before.review.runs).toEqual([]);
            expect(before.delivery).toBeNull();
            expect(groupResultsSchema.safeParse({ ...before, extra: 1 }).success).toBe(false);
            await f.capture([f.manifest()]);
            const after = await readGroupResults(f.store, 'g', context);
            expect(after.tasks[0].availability).toBe('available');
            expect(after.tasks[0].runs[0].runId).toBe(f.runId);
            expect(after.tasks[1].runs).toEqual([]);
        }
        finally {
            await f.dispose();
        }
    });
    it('optional store damage is unavailable and does not repair original core authority damage', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            mutateState(f, s => { s.observations = 'bad'; });
            expect((await view(f)).source.status).toBe('unavailable');
            f.store.db.prepare('DELETE FROM execution_snapshots WHERE hash=?').run(JSON.parse(String(f.store.db.prepare('SELECT body FROM groups WHERE id=?').get('g')!.body)).proposal.executionSnapshotHash);
            await expect(view(f)).rejects.toThrow('recovery-blocked');
        }
        finally {
            await f.dispose();
        }
    });
    it.each([['status', 'fictional'], ['reason', 'x'.repeat(300)], ['observations', [null]], ['revision', -1]])('damaged optional field %s remains explicit unavailable', async (field, value) => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            mutateState(f, state => { state[String(field)] = value; });
            const r = await view(f);
            expect(r.source.status).toBe('unavailable');
            expect(r.attempts).toEqual([]);
        }
        finally {
            await f.dispose();
        }
    });
    it('actual verifier completion overrides authenticated partial-bypass policy and malformed partial cannot claim not-run', async () => {
        const f = await resultFixture();
        try {
            const m = f.manifest();
            m.executionRef = f.add({
                changedFiles: [], diffPatch: '', commandOutputs: [], stdoutStderrLog: '', completionStatus: 'partial', failureType: 'timeout'
            });
            await f.capture([m]);
            expect((await view(f)).attempts[0].execution).toBe('unavailable');
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
            const verified = {
                ...m, revision: 2, stage: 'verification' as const, verificationRef: f.add(approved(false))
            };
            await f.capture([verified]);
            expect((await view(f)).attempts[0].verification).toBe('failed');
        }
        finally {
            await f.dispose();
        }
    });
    it('transport failure makes previously current explanation historical while newer real core attempt remains independent', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            expect((await view(f)).currentExplanation.status).toBe('available');
            f.port.collectTaskResults = async () => { throw Error('transport unavailable'); };
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            const stale = await view(f);
            expect(stale.source.status).toBe('stale');
            expect(stale.currentAttempt).toBeNull();
            expect(stale.currentExplanation.status).toBe('unavailable');
            expect(stale.attempts[0].current).toBe(false);
            expect(stale.attempts[0].explanation.status).toBe('available');
            f.core({ progress: {
                    status: 'executing', currentAttempt: 2, attemptsUsed: 2, attemptsRemaining: 1, lastTransitionAt: '2026-10-10T00:00:00Z'
                } });
            expect((await view(f)).currentAttempt).toBe(2);
            expect((await view(f)).currentExplanation.status).toBe('missing');
        }
        finally {
            await f.dispose();
        }
    });
    it.each([null, 1])('same-index source attempt2 remains newer than core %s without fabricated attempt2 report', async (core) => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            f.core({ progress: core === null ? null : {
                    status: 'executing', currentAttempt: core, attemptsUsed: core, attemptsRemaining: 2, lastTransitionAt: '2026-10-10T00:00:00Z'
                } });
            f.port.collectTaskResults = async () => ({
                schema: 'ccloop-task-results-v1', identity: f.identity, currentAttempt: 2, revision: 1, nextRevision: 1, manifests: []
            });
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            const r = await view(f);
            expect(r.currentAttempt).toBe(2);
            expect(r.captureRevision).toBe(1);
            expect(r.currentExplanation.status).toBe('missing');
            expect(r.attempts[0].current).toBe(false);
        }
        finally {
            await f.dispose();
        }
    });
    it.each([{ currentAttempt: 1, revision: 4 }, { currentAttempt: 2, revision: 1 }, { currentAttempt: 1, revision: 1 }])('fix1 rejects older same-owner hint %j without rolling back available capture2/revision4', async (hint) => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest(), {
                    ...f.manifest(2), stage: 'verification', verificationRef: f.add(approved(false))
                }, f.manifest(3, 2), {
                    ...f.manifest(4, 2), stage: 'verification', verificationRef: f.add(approved(true))
                }]);
            f.core({ progress: null });
            mutateState(f, state => { state.currentAttemptFact = { ...state.currentAttemptFact, ...hint }; });
            const r = await view(f);
            expect(r.currentAttempt).toBe(2);
            expect(r.attempts.map(a => a.current)).toEqual([false, true]);
            expect(r.currentExplanation.status).toBe('available');
            expect(r.attempts.map(a => a.verification)).toEqual(['failed', 'passed']);
        }
        finally {
            await f.dispose();
        }
    });
    it('fix1 malformed capture bounds preserve independent source2 over old core1 with explanation unavailable', async () => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest()]);
            f.port.collectTaskResults = async () => ({
                schema: 'ccloop-task-results-v1', identity: f.identity, currentAttempt: 2, revision: 1, nextRevision: 1, manifests: []
            });
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            f.core({ progress: {
                    status: 'executing', currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: '2026-10-10T00:00:00Z'
                } });
            mutateState(f, state => { state.observations = 'damaged'; });
            const r = await view(f);
            expect(r.currentAttempt).toBe(2);
            expect(r.source.status).toBe('unavailable');
            expect(r.currentExplanation.status).toBe('unavailable');
            expect(r.attempts).toEqual([]);
        }
        finally {
            await f.dispose();
        }
    });
    it('fix1 actual admitted handoff not-run evidence reuses snapshot and later started/completed observations supersede it', async () => {
        const f = await resultFixture();
        try {
            const boundary = {
                ...f.manifest(2), stage: 'verification' as const, verificationRef: f.add({
                    schema: 'ccloop-task-result-verification-not-run-v1', attempt: 1, status: 'not-run'
                })
            };
            await f.capture([f.manifest(), boundary]);
            const bypass = await view(f);
            expect(bypass.attempts[0].verification).toBe('not-run');
            expect(bypass.attempts[0].snapshotRevision).toBe(1);
            const started = {
                ...f.manifest(3), stage: 'verification' as const, verificationRef: f.add({
                    schema: 'ccloop-task-result-verification-started-v1', attempt: 1, status: 'in-progress'
                })
            };
            await f.capture([started]);
            expect((await view(f)).attempts[0].verification).toBe('in-progress');
            await f.capture([{
                    ...f.manifest(4), stage: 'verification', verificationRef: f.add(approved(false))
                }]);
            const completed = await view(f);
            expect(completed.attempts[0].verification).toBe('failed');
            expect(completed.attempts[0].snapshotRevision).toBe(1);
            expect(completed.attempts[0].observations.map(o => o.verification)).toEqual(['unavailable', 'not-run', 'in-progress', 'failed']);
        }
        finally {
            await f.dispose();
        }
    });
    it.each([{
            schema: 'ccloop-task-result-verification-not-run-v1', attempt: 2, status: 'not-run'
        }, {
            schema: 'ccloop-task-result-verification-not-run-v1', attempt: 1, status: 'not-run', ...approved(true)
        }])('fix1 mismatched or malformed not-run evidence is unavailable %j', async (value) => {
        const f = await resultFixture();
        try {
            await f.capture([f.manifest(), {
                    ...f.manifest(2), stage: 'verification', verificationRef: f.add(value)
                }]);
            expect((await view(f)).attempts[0].verification).toBe('unavailable');
        }
        finally {
            await f.dispose();
        }
    });
    it('fix1 damaged owned not-run evidence is unavailable while original execution snapshot remains historical', async () => {
        const f = await resultFixture();
        try {
            const ref = f.add({
                schema: 'ccloop-task-result-verification-not-run-v1', attempt: 1, status: 'not-run'
            });
            await f.capture([f.manifest(), {
                    ...f.manifest(2), stage: 'verification', verificationRef: ref
                }]);
            expect((await view(f)).attempts[0].verification).toBe('not-run');
            await writeFile(join(f.store.stateDir, 'artifacts', ref.artifactId, 'data'), 'damaged');
            const r = await view(f);
            expect(r.attempts[0].verification).toBe('unavailable');
            expect(r.attempts[0].snapshotRevision).toBe(1);
        }
        finally {
            await f.dispose();
        }
    });
    it('fix1 validated empty successful index retains independent current1 without producing an observation or borrowing explanation', async () => {
        const f = await resultFixture();
        try {
            f.port.collectTaskResults = async () => ({
                schema: 'ccloop-task-results-v1', identity: f.identity, currentAttempt: 1, revision: 0, nextRevision: 0, manifests: []
            });
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            const empty = await view(f);
            expect(empty.source.status).toBe('missing');
            expect(empty.captureRevision).toBe(0);
            expect(empty.currentAttempt).toBe(1);
            expect(empty.currentExplanation.status).toBe('missing');
            expect(empty.attempts).toEqual([]);
            const original = readTaskResultState(f.store, f.runId)!;
            mutateState(f, state => { delete state.currentAttemptFact; });
            expect((await view(f)).currentAttempt).toBeNull();
            mutateState(f, state => { state.currentAttemptFact = { ...original.currentAttemptFact, identity: { ...f.identity, groupId: 'foreign' } }; });
            expect((await view(f)).currentAttempt).toBeNull();
            mutateState(f, state => { state.currentAttemptFact = original.currentAttemptFact; });
            f.port.collectTaskResults = async () => { throw Error('transport unavailable after empty index'); };
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            const lost = await view(f);
            expect(lost.source.status).toBe('unavailable');
            expect(lost.currentAttempt).toBeNull();
            expect(lost.attempts).toEqual([]);
        }
        finally {
            await f.dispose();
        }
    });
});
