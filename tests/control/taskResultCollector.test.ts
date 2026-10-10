import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { driverHarness } from './fixtures/driverHarness.js';
import { createTaskResultCollector } from '../../src/control/taskResultCollector.js';
import { readTaskResultState, readOwnedTaskResultEvidence } from '../../src/control/taskResultStore.js';
import { createExecutionDriver, readStartEnvelope } from '../../src/control/executionDriver.js';
import { sha256Canonical } from '../../src/control/canonicalJson.js';
import { readProjectionState } from '../../src/control/projectionJournal.js';
import { TaskResultUnsupportedError } from '../../src/control/taskResultProtocol.js';
import type { StartEnvelope } from '../../src/control/executionPort.js';
import type { ArtifactRef } from '../../src/control/types.js';
const latch = () => { let release!: (value?: unknown) => void; const promise = new Promise<any>(r => { release = r; }); return { promise, release }; };
import { readWebGroup } from '../../src/control/webService.js';
import { cleanupCommittedRun } from '../../src/control/cleanup.js';
import { createExecutionProfileRouter, resolveProfile } from '../../src/control/profiles.js';
import { profileSnapshot } from './fixtures/web.js';
import { createCcloopExecutionPort } from '../../src/control/ccloopPort.js';
import { chmod, symlink } from 'node:fs/promises';
const tick = () => new Promise<void>(r => setImmediate(r));
const ref = (bytes: Buffer): ArtifactRef => { const hash = createHash('sha256').update(bytes).digest('hex'); return { artifactId: 'task-result-' + hash, hash }; };
async function fixture() {
    const t = await driverHarness([{ taskId: 'a' }]);
    const runId = await t.claim(), driver = t.driver();
    await t.until(driver, () => t.body(runId).state === 'accepted');
    await driver.stop();
    const input = readStartEnvelope(t.h.store, t.body(runId));
    const { groupId, workItemId, taskId, generation, graphVersion, targetVersion } = input.claim;
    const identity = { groupId, workItemId, taskId, runId, generation, graphVersion, targetVersion, executionId: t.body(runId).executionId, envelopeHash: sha256Canonical(input) };
    const files = new Map<string, Buffer>();
    const add = (value: unknown) => { const b = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); const r = ref(b); files.set(r.artifactId, b); return r; };
    const output = add(Buffer.from('saved result'));
    const execution = add({ changedFiles: ['a'], diffPatch: '', commandOutputs: [], stdoutStderrLog: '' });
    const manifest = (revision = 1, attempt = 1, stage: 'execution' | 'verification' = 'execution', verificationRef: ArtifactRef | null = null) => ({ schema: 'ccloop-task-result-manifest-v1', identity, attempt, revision, stage, explanation: { status: 'missing', reason: null, ref: null }, executionRef: execution, verificationRef, outputs: [{ id: 'output-1', path: 'a', label: 'A', origin: 'changed', status: 'available', byteLength: 12, ref: output }] });
    const m = add(manifest());
    let page: any = { schema: 'ccloop-task-results-v1', identity, currentAttempt: 1, revision: 1, manifests: [{ revision: 1, ref: m }], nextRevision: 1 };
    const port = { ...t.fake.port, collectTaskResults: async (_input: StartEnvelope, _cursor: number) => page, readTaskResultEvidence: async (_input: StartEnvelope, _manifest: ArtifactRef, r: ArtifactRef) => {
            const b = files.get(r.artifactId);
            if (!b)
                throw new Error('missing');
            return b;
        } };
    const resolve = () => ({ input, executionId: identity.executionId, port });
    const collector = createTaskResultCollector({ store: t.h.store, resolve, admissionGate: t.deps.admissionGate });
    return { t, runId, input, identity, files, add, manifest, output, execution, m, port, collector, setPage: (p: any) => { page = p; }, page: () => page, dispose: async () => { await collector.stop(); await t.h.dispose(); } };
}
describe('independent result retention', { timeout: 30000 }, () => {
    it('retains manifest-owned hashes with stable run/attempt membership and results-only projection changes', async () => {
        const f = await fixture();
        try {
            const before = readProjectionState(f.t.h.store).changeSeq;
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'available', revision: 1, currentAttempt: 1, observations: [{ manifestRef: f.m, manifest: { attempt: 1 } }] });
            expect((await readOwnedTaskResultEvidence(f.t.h.store, f.runId, 1, f.m, f.output)).toString()).toBe('saved result');
            expect((await stat(join(f.t.h.store.stateDir, 'artifacts', f.output.artifactId, 'data'))).mode & 0o777).toBe(0o600);
            expect(readProjectionState(f.t.h.store).changeSeq).toBeGreaterThan(before);
            const admitted = readProjectionState(f.t.h.store).changeSeq;
            f.setPage({ ...f.page(), manifests: [] });
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            expect(readProjectionState(f.t.h.store).changeSeq).toBe(admitted);
            await expect(readOwnedTaskResultEvidence(f.t.h.store, f.runId, 2, f.m, f.output)).rejects.toThrow();
            const forged = f.add(Buffer.from('unowned'));
            await expect(readOwnedTaskResultEvidence(f.t.h.store, f.runId, 1, f.m, forged)).rejects.toThrow();
            await writeFile(join(f.t.h.store.stateDir, 'artifacts', f.output.artifactId, 'data'), 'damage');
            await expect(readOwnedTaskResultEvidence(f.t.h.store, f.runId, 1, f.m, f.output)).rejects.toThrow('artifact-hash-mismatch');
        }
        finally {
            await f.dispose();
        }
    });
    it('never admits a partial/corrupt page or rolls history backward and retries transient faults', async () => {
        const f = await fixture();
        try {
            await f.collector.flush(f.runId);
            const start = readTaskResultState(f.t.h.store, f.runId)!;
            const m2 = f.add(f.manifest(2, 2));
            f.setPage({ ...f.page(), currentAttempt: 2, revision: 2, nextRevision: 2, manifests: [{ revision: 2, ref: m2 }] });
            const original = f.port.readTaskResultEvidence;
            f.port.readTaskResultEvidence = async (...args) => args[2].artifactId === f.output.artifactId ? Buffer.from('forged') : original(...args);
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'stale', revision: 1, observations: start.observations });
            f.port.readTaskResultEvidence = original;
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'available', revision: 2, currentAttempt: 2, observations: [{ manifest: { attempt: 1 } }, { manifest: { attempt: 2 } }] });
            f.setPage({ ...f.page(), currentAttempt: 1, revision: 1, nextRevision: 1, manifests: [] });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ revision: 2, currentAttempt: 2, observations: [{ manifest: { attempt: 1 } }, { manifest: { attempt: 2 } }] });
        }
        finally {
            await f.dispose();
        }
    });
    it('requires contiguous complete pages, identity and immutable execution snapshot successors', async () => {
        const f = await fixture();
        try {
            f.setPage({ ...f.page(), nextRevision: 0 });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'unavailable', revision: 0, observations: [] });
            f.setPage({ ...f.page(), nextRevision: 1, identity: { ...f.identity, generation: 2 } });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)?.revision).toBe(0);
            f.setPage({ ...f.page(), identity: f.identity });
            await f.collector.flush(f.runId);
            const changed = f.add(Buffer.from('changed'));
            const m2 = f.add({ ...f.manifest(2, 1, 'verification', f.add({ schema: 'ccloop-task-result-verification-started-v1', attempt: 1, status: 'in-progress' })), outputs: [{ ...f.manifest().outputs[0], ref: changed }] });
            f.setPage({ ...f.page(), revision: 2, nextRevision: 2, manifests: [{ revision: 2, ref: m2 }] });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'stale', revision: 1 });
        }
        finally {
            await f.dispose();
        }
    });
    it('separates actual verifier start, completion and unavailable evidence from executor claims', async () => {
        const f = await fixture();
        try {
            const started = f.add({ schema: 'ccloop-task-result-verification-started-v1', attempt: 1, status: 'in-progress' });
            const complete = f.add({ approved: false, rejectCategory: 'check', primaryTargetPaths: ['a'], failingCommand: 'test', safeToRetry: true, evidence: [], pauseSignals: [], stopSignals: [] });
            const m2 = f.add(f.manifest(2, 1, 'verification', started)), m3 = f.add(f.manifest(3, 1, 'verification', complete));
            f.setPage({ ...f.page(), revision: 3, nextRevision: 3, manifests: [{ revision: 1, ref: f.m }, { revision: 2, ref: m2 }, { revision: 3, ref: m3 }] });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)?.observations.map(o => o.verification)).toEqual(['unavailable', 'in-progress', 'failed']);
        }
        finally {
            await f.dispose();
        }
    });
    it.each(['owner', 'drain', 'shutdown', 'run-owner', 'lease'])('rejects late writes after %s fence', async (fence) => {
        const f = await fixture(), held = latch(), entered = latch();
        try {
            f.port.readTaskResultEvidence = async () => { entered.release(); await held.promise; return f.files.get(f.m.artifactId)!; };
            f.collector.schedule(f.runId);
            await entered.promise;
            const before = readProjectionState(f.t.h.store).changeSeq;
            let stopping: Promise<void> | undefined;
            if (fence === 'owner') {
                const path = join(f.t.h.store.stateDir, 'service-lock', 'owner.json');
                const owner = JSON.parse(await readFile(path, 'utf8'));
                await writeFile(path, JSON.stringify({ ...owner, nonce: 'new-owner' }));
            }
            if (fence === 'drain')
                await f.t.deps.admissionGate!.beginDrain().beforeWriterTransaction;
            if (fence === 'shutdown')
                stopping = f.collector.stop();
            if (fence === 'run-owner') {
                const body = f.t.body(f.runId);
                body.executionId = 'replaced';
                f.t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body), f.runId);
            }
            if (fence === 'lease') {
                const body = f.t.body(f.runId);
                body.ownerToken = 'replaced';
                f.t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body), f.runId);
            }
            held.release();
            await (stopping ?? f.collector.flush(f.runId));
            expect(readTaskResultState(f.t.h.store, f.runId)).toBeNull();
            expect(readProjectionState(f.t.h.store).changeSeq).toBe(before);
        }
        finally {
            held.release();
            await f.dispose();
        }
    });
    it('core usage and terminal settle independently during a blocked optional RPC', async () => {
        const f = await fixture(), held = latch(), entered = latch();
        try {
            f.port.collectTaskResults = async () => { entered.release(); await held.promise; return f.page(); };
            f.collector.schedule(f.runId);
            f.collector.schedule(f.runId);
            await entered.promise;
            const driver = createExecutionDriver({ ...f.t.deps, taskResults: f.collector });
            await f.t.until(driver, () => f.t.body(f.runId).state === 'settled');
            expect(f.t.body(f.runId)).toMatchObject({ state: 'settled', highWater: 2, cumulative: { work: { tokens: 10 } } });
            held.release();
            await f.collector.flush(f.runId);
            await driver.stop();
        }
        finally {
            held.release();
            await f.dispose();
        }
    });
    it('optional RPC timeout is bounded and a real peer refusal alone means unsupported', async () => {
        const f = await fixture();
        try {
            f.port.collectTaskResults = async () => new Promise(() => { });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'unavailable', revision: 0 });
            f.port.collectTaskResults = async () => { throw new TaskResultUnsupportedError(); };
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)?.status).toBe('unsupported');
        }
        finally {
            await f.dispose();
        }
    });
});
describe('retention queue and source deletion', { timeout: 30000 }, () => {
    it('permits at most two process-wide jobs and deduplicates one run across schedule/flush', async () => {
        const fixtures = await Promise.all([fixture(), fixture(), fixture()]);
        const held = latch();
        let entered = 0;
        try {
            for (const f of fixtures)
                f.port.collectTaskResults = async () => { entered++; await held.promise; return f.page(); };
            for (const f of fixtures) {
                f.collector.schedule(f.runId);
                f.collector.schedule(f.runId);
            }
            await tick();
            expect(entered).toBe(2);
            expect(readTaskResultState(fixtures[2].t.h.store, fixtures[2].runId)).toBeNull();
            const flushing = fixtures.map(f => f.collector.flush(f.runId));
            await tick();
            expect(entered).toBe(2);
            held.release();
            await Promise.all(flushing);
            expect(entered).toBe(3);
            for (const f of fixtures)
                expect(readTaskResultState(f.t.h.store, f.runId)?.revision).toBe(1);
        }
        finally {
            held.release();
            await Promise.all(fixtures.map(f => f.dispose()));
        }
    });
    it('flushes owned queued results before actual source deletion after settled budget, preserving saved bytes', async () => {
        const f = await fixture(), held = latch(), entered = latch(), deleting = latch();
        const driver = createExecutionDriver({ ...f.t.deps, taskResults: f.collector });
        let deletingSource: Promise<{
            removed: boolean;
        }> | undefined;
        try {
            await f.t.until(driver, () => f.t.body(f.runId).state === 'landed');
            const before = readWebGroup(f.t.h.store, 'g').ledger.committedRemaining.tokens;
            const remaining = f.t.body(f.runId).remaining;
            await f.t.until(driver, () => f.t.body(f.runId).state === 'settled');
            await f.collector.flush(f.runId);
            f.t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run('task-results:' + f.runId);
            const original = f.port.collectTaskResults;
            f.port.collectTaskResults = async (...args) => { entered.release(); await held.promise; return original(...args); };
            f.collector.schedule(f.runId);
            await entered.promise;
            deletingSource = cleanupCommittedRun(f.t.h.store, f.runId, f.input.work.sourceDir, { beforeCleanup: async () => { deleting.release(); } });
            await deleting.promise;
            await tick();
            expect((await stat(f.input.work.sourceDir)).isDirectory()).toBe(true);
            expect(readTaskResultState(f.t.h.store, f.runId)).toBeNull();
            expect(f.t.body(f.runId).state).toBe('settled');
            expect(f.t.h.store.db.prepare('SELECT active FROM runs WHERE id=?').get(f.runId)).toEqual({ active: 0 });
            expect(readWebGroup(f.t.h.store, 'g').ledger.committedRemaining.tokens).toBe(before - remaining.work.tokens - remaining.handoff.tokens);
            held.release();
            expect(await deletingSource).toEqual({ removed: true });
            await expect(stat(f.input.work.sourceDir)).rejects.toThrow();
            expect((await readOwnedTaskResultEvidence(f.t.h.store, f.runId, 1, f.m, f.output)).toString()).toBe('saved result');
        }
        finally {
            held.release();
            await deletingSource?.catch(() => { });
            await driver.stop();
            await f.dispose();
        }
    });
    it.each(['available', 'unavailable'])('includes global queue wait in the 67000-ms flush deadline with %s authority and fences late evidence', async (authority) => {
        const fixtures = await Promise.all([fixture(), fixture(), fixture()]);
        const [first, second, queued] = fixtures;
        let queuedCalls = 0;
        try {
            for (const f of [first, second]) {
                const observations = Array.from({ length: 64 }, (_, i) => ({ revision: i + 1, ref: f.add(f.manifest(i + 1, i + 1)) }));
                f.setPage({ ...f.page(), revision: 64, nextRevision: 64, currentAttempt: 64, manifests: observations });
                f.port.readTaskResultEvidence = async (_i, _m, r) => { await new Promise(resolve => setTimeout(resolve, 999)); return f.files.get(r.artifactId)!; };
            }
            queued.port.collectTaskResults = async () => { queuedCalls++; return queued.page(); };
            vi.useFakeTimers();
            first.collector.schedule(first.runId);
            second.collector.schedule(second.runId);
            let collector = queued.collector;
            if (authority === 'unavailable')
                collector = createTaskResultCollector({ store: queued.t.h.store, resolve() { throw new Error('authority-unreadable'); } });
            const flushing = collector.flush(queued.runId);
            await vi.advanceTimersByTimeAsync(67000);
            await flushing;
            expect(queuedCalls).toBe(0);
            if (authority === 'available')
                expect(readTaskResultState(queued.t.h.store, queued.runId)).toMatchObject({ status: 'unavailable', reason: 'task-result-flush-timeout', revision: 0 });
            else
                expect(readTaskResultState(queued.t.h.store, queued.runId)).toBeNull();
            await first.collector.stop();
            await second.collector.stop();
            await vi.advanceTimersByTimeAsync(1000);
            expect(queuedCalls).toBe(0);
            if (authority === 'available')
                expect(readTaskResultState(queued.t.h.store, queued.runId)?.revision).toBe(0);
            else
                expect(readTaskResultState(queued.t.h.store, queued.runId)).toBeNull();
            await collector.stop();
        }
        finally {
            vi.useRealTimers();
            await Promise.all(fixtures.map(f => f.dispose()));
        }
    });
    it('does not invent observations on missing/non-task sources and retries transport errors', async () => {
        const f = await fixture();
        try {
            f.setPage({ ...f.page(), revision: 0, nextRevision: 0, currentAttempt: 0, manifests: [] });
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ status: 'missing', observations: [] });
            f.port.collectTaskResults = async () => { throw new Error('temporary-transport'); };
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)?.status).toBe('unavailable');
            f.port.collectTaskResults = async () => f.page();
            await f.collector.flush(f.runId);
            expect(readTaskResultState(f.t.h.store, f.runId)?.status).toBe('missing');
        }
        finally {
            await f.dispose();
        }
    });
    it('caches only old command refusal by executable file identity and re-discovers a changed file', async () => {
        const f = await fixture();
        try {
            const binary = join(f.t.h.root, 'optional-peer.mjs'), calls = join(f.t.h.root, 'optional-calls'), table = join(f.t.h.root, 'optional-table.json');
            await writeFile(table, '{}', { mode: 0o600 });
            const script = (code: string) => '#!/usr/bin/env node\nimport {appendFileSync} from "node:fs";appendFileSync(' + JSON.stringify(calls) + ',"call\\n");' + code;
            await writeFile(binary, script('process.stderr.write("control-command-invalid");process.exit(2);'), { mode: 0o700 });
            const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 5000 });
            await expect(port.collectTaskResults!(f.input, 0)).rejects.toBeInstanceOf(TaskResultUnsupportedError);
            await expect(port.collectTaskResults!(f.input, 0)).rejects.toBeInstanceOf(TaskResultUnsupportedError);
            expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(1);
            await writeFile(binary, script('process.stdout.write(' + JSON.stringify(JSON.stringify(f.page())) + ');'));
            await chmod(binary, 0o700);
            expect(await port.collectTaskResults!(f.input, 0)).toMatchObject({ revision: 1 });
            expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(2);
            await writeFile(binary, script('process.stderr.write("control-envelope-conflict");process.exit(2);'));
            await chmod(binary, 0o700);
            await expect(port.collectTaskResults!(f.input, 0)).rejects.toThrow('control-peer-exit');
            await expect(port.collectTaskResults!(f.input, 0)).rejects.toThrow('control-peer-exit');
            expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(4);
            await writeFile(binary, script('setTimeout(()=>{},10000);'));
            await chmod(binary, 0o700);
            const before = Date.now();
            await expect(port.collectTaskResults!(f.input, 0)).rejects.toThrow('control-peer-timeout');
            expect(Date.now() - before).toBeLessThan(3000);
        }
        finally {
            await f.dispose();
        }
    });
});
describe('optional methods through owned profile routing', { timeout: 30000 }, () => {
    it('retains evidence through the real frozen router while absent optional methods remain absent', async () => {
        const f = await fixture();
        try {
            await f.collector.stop();
            const router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), f.port)]);
            const owned = router.list()[0].port;
            const collector = createTaskResultCollector({ store: f.t.h.store, resolve: () => ({ input: f.input, executionId: f.identity.executionId, port: owned }) });
            try {
                await collector.flush(f.runId);
                expect(readTaskResultState(f.t.h.store, f.runId)?.revision).toBe(1);
            }
            finally {
                await collector.stop();
            }
            const absent = createExecutionProfileRouter([resolveProfile(profileSnapshot(), f.t.fake.port)]).list()[0].port;
            expect(absent.collectTaskResults).toBeUndefined();
            expect(absent.readTaskResultEvidence).toBeUndefined();
        }
        finally {
            await f.dispose();
        }
    });
    it('deduplicates a run across two collector assemblies for the same owned store', async () => {
        const f = await fixture(), held = latch();
        let entered = 0;
        try {
            f.port.collectTaskResults = async () => { entered++; await held.promise; return f.page(); };
            const second = createTaskResultCollector({ store: f.t.h.store, resolve: () => ({ input: f.input, executionId: f.identity.executionId, port: f.port }) });
            f.collector.schedule(f.runId);
            second.schedule(f.runId);
            await tick();
            expect(entered).toBe(1);
            held.release();
            await second.flush(f.runId);
            await second.stop();
            expect(readTaskResultState(f.t.h.store, f.runId)?.revision).toBe(1);
        }
        finally {
            held.release();
            await f.dispose();
        }
    });
});
describe('collector assembly owner handover', { timeout: 30000 }, () => {
    it('observes the old RPC but lets the new assembly retain the same run without an old stop cancelling it', async () => {
        const f = await fixture(), held = latch(), entered = latch();
        let second: ReturnType<typeof createTaskResultCollector> | undefined;
        try {
            f.port.collectTaskResults = async () => { entered.release(); await held.promise; return f.page(); };
            f.collector.schedule(f.runId);
            await entered.promise;
            const input = { ...f.input, claim: { ...f.input.claim, generation: 2, ownerToken: 'new-lease' } };
            const identity = { ...f.identity, generation: 2, envelopeHash: sha256Canonical(input), executionId: 'new-execution' };
            const run = f.t.body(f.runId);
            run.generation = 2;
            run.ownerToken = 'new-lease';
            run.executionId = 'new-execution';
            f.t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(run), f.runId);
            const m = f.add({ ...f.manifest(), identity });
            const port = { ...f.port, collectTaskResults: async () => ({ ...f.page(), identity, manifests: [{ revision: 1, ref: m }] }) };
            second = createTaskResultCollector({ store: f.t.h.store, resolve: () => ({ input, executionId: 'new-execution', port }) });
            const flushing = second.flush(f.runId);
            await f.collector.stop();
            held.release();
            await flushing;
            expect(readTaskResultState(f.t.h.store, f.runId)).toMatchObject({ identity: { generation: 2, executionId: 'new-execution' }, revision: 1, status: 'available' });
        }
        finally {
            held.release();
            await second?.stop();
            await f.dispose();
        }
    });
    it('preserves source when shutdown wins a flush racing actual deletion', async () => {
        const f = await fixture(), held = latch(), entered = latch(), deleting = latch();
        const driver = createExecutionDriver({ ...f.t.deps, taskResults: f.collector });
        let deletion: Promise<{
            removed: boolean;
        }> | undefined;
        try {
            await f.t.until(driver, () => f.t.body(f.runId).state === 'settled');
            await f.collector.flush(f.runId);
            f.port.collectTaskResults = async () => { entered.release(); await held.promise; return f.page(); };
            f.collector.schedule(f.runId);
            await entered.promise;
            deletion = cleanupCommittedRun(f.t.h.store, f.runId, f.input.work.sourceDir, { beforeCleanup: async () => { deleting.release(); } });
            const observed = deletion.catch(e => e);
            await deleting.promise;
            await tick();
            await f.collector.stop();
            held.release();
            expect(await observed).toBeInstanceOf(Error);
            expect((await stat(f.input.work.sourceDir)).isDirectory()).toBe(true);
        }
        finally {
            held.release();
            await deletion?.catch(() => { });
            await driver.stop();
            await f.dispose();
        }
    });
});
describe('owner check at artifact registration', { timeout: 30000 }, () => {
    it('registers no result artifacts when the owner changes after publication admission but before the transaction', async () => {
        const f = await fixture();
        try {
            const path = join(f.t.h.store.stateDir, 'service-lock', 'owner.json'), owner = JSON.parse(readFileSync(path, 'utf8'));
            const transaction = f.t.h.store.transaction.bind(f.t.h.store);
            let changed = false;
            f.t.h.store.transaction = action => {
                if (!changed) {
                    changed = true;
                    writeFileSync(path, JSON.stringify({ ...owner, nonce: 'new-at-register' }));
                }
                return transaction(action);
            };
            f.collector.schedule(f.runId);
            await f.collector.flush(f.runId);
            expect(f.t.h.store.db.prepare("SELECT id FROM artifacts WHERE id LIKE 'task-result-%'").all()).toEqual([]);
            expect(readTaskResultState(f.t.h.store, f.runId)).toBeNull();
        }
        finally {
            await f.dispose();
        }
    });
});
describe('last source deletion fence', { timeout: 30000 }, () => {
    it('rechecks shutdown after optional flush and immediately before rm starts', async () => {
        const f = await fixture(), driver = createExecutionDriver({ ...f.t.deps, taskResults: f.collector });
        try {
            await f.t.until(driver, () => f.t.body(f.runId).state === 'settled');
            await f.collector.flush(f.runId);
            let admissions = 0;
            await expect(cleanupCommittedRun(f.t.h.store, f.runId, f.input.work.sourceDir, { admit: async (operation) => { admissions++; if (admissions === 2)
                    await f.collector.stop(); return operation(); } })).rejects.toThrow();
            expect((await stat(f.input.work.sourceDir)).isDirectory()).toBe(true);
        }
        finally {
            await driver.stop();
            await f.dispose();
        }
    });
});
