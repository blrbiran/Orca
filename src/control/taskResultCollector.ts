import { createHash } from 'node:crypto';
import type { AdmissionGate } from './admissionGate.js';
import { writeArtifact } from './archive.js';
import { sha256Canonical } from './canonicalJson.js';
import type { ExecutionPort, StartEnvelope } from './executionPort.js';
import type { ControlStore } from './store.js';
import type { ArtifactRef } from './types.js';
import { MAX_TASK_RESULT_EVIDENCE_BYTES, MAX_TASK_RESULT_FILE_BYTES, TASK_RESULT_FLUSH_TIMEOUT_MS, TASK_RESULT_RPC_TIMEOUT_MS, TaskResultUnsupportedError, safeTaskResultPath, taskResultCollectionSchema, taskResultManifestSchema, taskResultVerification, type TaskResultCollectionV1 } from './taskResultProtocol.js';
import { readTaskResultState, saveTaskResultState, taskResultManifestRefs, type TaskResultState, type TaskResultObservation } from './taskResultStore.js';
export interface TaskResultCollectorDeps {
    store: ControlStore;
    admissionGate?: AdmissionGate;
    resolve(runId: string): {
        input: StartEnvelope;
        executionId: string;
        port: ExecutionPort;
    } | null;
}
export interface TaskResultCollector {
    schedule(runId: string): void;
    flush(runId: string): Promise<void>;
    stop(): Promise<void>;
}
type Job = {
    runId: string;
    cancelled: boolean;
    started: boolean;
    done: Promise<void>;
    finish: () => void;
    cancel: Promise<void>;
    abort: () => void;
};
// Process-wide queue: separate runtimes cannot multiply the two-job limit.
const queue: {
    key: string;
    start: () => Promise<void>;
}[] = [];
let active = 0;
const busyRuns = new Set<string>();
function pump(): void {
    while (active < 2 && queue.length) {
        const index = queue.findIndex(entry => !busyRuns.has(entry.key));
        if (index < 0)
            return;
        const [next] = queue.splice(index, 1);
        active++;
        busyRuns.add(next.key);
        void next.start().catch(() => { }).finally(() => { active--; busyRuns.delete(next.key); pump(); });
    }
}
const collectors = new WeakMap<ControlStore, {
    collector: TaskResultCollector;
    stopped: () => boolean;
    assertRun: (runId: string) => string;
}>();
/** Actual source deletion joins the queued job; business transitions do not wait. */
export async function flushTaskResults(store: ControlStore, runId: string): Promise<() => void> {
    const registration = collectors.get(store);
    if (!registration)
        return () => store.assertOwner();
    const identity = registration.assertRun(runId);
    await registration.collector.flush(runId);
    const assertCurrent = () => { if (collectors.get(store) !== registration || registration.assertRun(runId) !== identity)
        throw new Error('task-result-owner-changed'); };
    assertCurrent();
    return assertCurrent;
}
export function createTaskResultCollector(deps: TaskResultCollectorDeps): TaskResultCollector {
    const existing = collectors.get(deps.store);
    if (existing && !existing.stopped())
        void existing.collector.stop().catch(() => { });
    const jobs = new Map<string, Job>();
    let stopped = false;
    const valid = (job: Job, owner: NonNullable<ReturnType<TaskResultCollectorDeps['resolve']>>) => {
        if (stopped || job.cancelled || deps.admissionGate?.draining)
            throw new Error('task-result-job-stopped');
        deps.store.assertOwner();
        const current = deps.resolve(job.runId);
        if (!current || current.executionId !== owner.executionId || sha256Canonical(current.input) !== sha256Canonical(owner.input))
            throw new Error('task-result-owner-changed');
        const row = deps.store.db.prepare('SELECT body FROM runs WHERE id=?').get(job.runId);
        if (!row)
            throw new Error('task-result-owner-changed');
        const run = JSON.parse(String(row.body));
        if (run.generation !== owner.input.claim.generation || run.executionId !== owner.executionId || run.ownerToken !== owner.input.claim.ownerToken)
            throw new Error('task-result-owner-changed');
    };
    const admitted = async <T>(job: Job, owner: NonNullable<ReturnType<TaskResultCollectorDeps['resolve']>>, operation: () => Promise<T>) => {
        const release = deps.admissionGate?.enter();
        try {
            valid(job, owner);
            return await operation();
        }
        finally {
            release?.();
        }
    };
    const rpc = async <T>(job: Job, operation: () => Promise<T>): Promise<T> => {
        if (stopped || job.cancelled)
            throw new Error('task-result-job-stopped');
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([Promise.resolve().then(operation), job.cancel.then(() => { throw new Error('task-result-job-stopped'); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('task-result-rpc-timeout')), TASK_RESULT_RPC_TIMEOUT_MS); })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    };
    const empty = (): TaskResultState => ({ schema: 'orca-task-result-store-v1', identity: null, revision: 0, sourceRevision: 0, currentAttempt: 0, observations: [], status: 'missing', reason: null });
    const diagnostic = async (job: Job, owner: NonNullable<ReturnType<TaskResultCollectorDeps['resolve']>>, error: unknown) => {
        const old = readTaskResultState(deps.store, job.runId) ?? empty();
        const status = error instanceof TaskResultUnsupportedError ? 'unsupported' : old.observations.length ? 'stale' : 'unavailable';
        await admitted(job, owner, async () => deps.store.transaction(() => { valid(job, owner); saveTaskResultState(deps.store, job.runId, owner.input.claim.groupId, { ...old, status, reason: (error instanceof Error ? error.message : 'task-result-unavailable').slice(0, 256) }); }));
    };
    const acquire = async (job: Job) => {
        const owner = deps.resolve(job.runId);
        if (!owner || owner.input.claim.taskId === null || owner.input.work.kind !== 'loop')
            return;
        try {
            valid(job, owner);
            if (!owner.port.collectTaskResults || !owner.port.readTaskResultEvidence)
                throw new TaskResultUnsupportedError();
            const call = <T>(operation: () => Promise<T>) => { valid(job, owner); return rpc(job, operation); };
            for (;;) {
                const old = readTaskResultState(deps.store, job.runId) ?? empty();
                const page = taskResultCollectionSchema.parse(await call(() => owner.port.collectTaskResults!(owner.input, old.revision)));
                const identity = { ...Object.fromEntries(['groupId', 'workItemId', 'taskId', 'runId', 'generation', 'graphVersion', 'targetVersion'].map(k => [k, (owner.input.claim as unknown as Record<string, unknown>)[k]])), executionId: owner.executionId, envelopeHash: sha256Canonical(owner.input) };
                if (sha256Canonical(page.identity) !== sha256Canonical(identity) || (old.identity && sha256Canonical(old.identity) !== sha256Canonical(page.identity)))
                    throw new Error('task-result-identity-invalid');
                validatePage(page, old);
                const observations: TaskResultObservation[] = [];
                const evidence = new Map<string, {
                    ref: ArtifactRef;
                    bytes: Buffer;
                }>();
                const read = async (manifestRef: ArtifactRef, ref: ArtifactRef, limit = MAX_TASK_RESULT_EVIDENCE_BYTES) => {
                    const bytes = await call(() => owner.port.readTaskResultEvidence!(owner.input, manifestRef, ref));
                    if (bytes.length > limit || createHash('sha256').update(bytes).digest('hex') !== ref.hash || ref.artifactId !== 'task-result-' + ref.hash)
                        throw new Error('task-result-evidence-invalid');
                    evidence.set(ref.artifactId, { ref, bytes });
                    return bytes;
                };
                for (const observation of page.manifests) {
                    const manifest = taskResultManifestSchema.parse(JSON.parse((await read(observation.ref, observation.ref)).toString('utf8')));
                    if (manifest.revision !== observation.revision || manifest.attempt > page.currentAttempt || sha256Canonical(manifest.identity) !== sha256Canonical(page.identity))
                        throw new Error('task-result-manifest-invalid');
                    const prior = [...old.observations, ...observations].find(o => o.manifest.attempt === manifest.attempt && o.manifest.stage === 'execution');
                    if (manifest.stage === 'verification' && (!prior || sha256Canonical({ outputs: prior.manifest.outputs, executionRef: prior.manifest.executionRef, explanation: prior.manifest.explanation }) !== sha256Canonical({ outputs: manifest.outputs, executionRef: manifest.executionRef, explanation: manifest.explanation })))
                        throw new Error('task-result-snapshot-invalid');
                    if (manifest.stage === 'execution' && prior)
                        throw new Error('task-result-snapshot-invalid');
                    for (const output of manifest.outputs) {
                        if (output.ref && !safeTaskResultPath(output.path))
                            throw new Error('task-result-output-unsafe');
                    }
                    for (const ref of taskResultManifestRefs(manifest)) {
                        const output = manifest.outputs.find(o => o.ref?.artifactId === ref.artifactId && o.ref.hash === ref.hash);
                        const bytes = await read(observation.ref, ref, output ? MAX_TASK_RESULT_FILE_BYTES : MAX_TASK_RESULT_EVIDENCE_BYTES);
                        if (output && bytes.length !== output.byteLength)
                            throw new Error('task-result-output-size-invalid');
                    }
                    observations.push({ manifestRef: observation.ref, manifest, verification: taskResultVerification(manifest, manifest.verificationRef ? evidence.get(manifest.verificationRef.artifactId)!.bytes : null) });
                }
                // Complete page first. A partial read never publishes a cursor or replaces history.
                for (const { ref, bytes } of evidence.values())
                    await writeArtifact(deps.store, ref.artifactId, bytes, { assertHeld: () => valid(job, owner), admit: operation => admitted(job, owner, operation) });
                await admitted(job, owner, async () => deps.store.transaction(() => {
                    valid(job, owner);
                    const current = readTaskResultState(deps.store, job.runId) ?? empty();
                    if (current.revision !== old.revision || current.sourceRevision > page.revision)
                        throw new Error('task-result-page-stale');
                    saveTaskResultState(deps.store, job.runId, page.identity.groupId, { schema: 'orca-task-result-store-v1', identity: page.identity, revision: page.nextRevision, sourceRevision: page.revision, currentAttempt: page.currentAttempt, observations: [...current.observations, ...observations], status: page.revision > 0 ? 'available' : 'missing', reason: null });
                }));
                if (page.nextRevision === page.revision)
                    return;
            }
        }
        catch (error) {
            await diagnostic(job, owner, error).catch(() => { });
        }
    };
    const schedule = (runId: string) => {
        if (stopped || jobs.has(runId))
            return;
        let finish!: () => void, abort!: () => void;
        const done = new Promise<void>(r => { finish = r; }), cancel = new Promise<void>(r => { abort = r; });
        const job: Job = { runId, cancelled: false, started: false, done, finish, cancel, abort };
        jobs.set(runId, job);
        queue.push({ key: deps.store.stateDir + ':' + runId, start: async () => {
                job.started = true;
                try {
                    if (!job.cancelled)
                        await acquire(job);
                }
                finally {
                    if (jobs.get(runId) === job)
                        jobs.delete(runId);
                    job.finish();
                }
            } });
        pump();
    };
    const collector: TaskResultCollector = { schedule, async flush(runId) {
            if (stopped)
                return;
            schedule(runId);
            const job = jobs.get(runId);
            if (!job)
                return;
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([job.done, new Promise<void>(resolve => {
                        timer = setTimeout(() => {
                            // Queue time counts. Fence acquisition before allowing source deletion.
                            const failure = Promise.resolve().then(() => { const owner = deps.resolve(runId); return owner ? diagnostic(job, owner, new Error('task-result-flush-timeout')) : undefined; });
                            void failure.catch(() => { }).finally(() => {
                                job.cancelled = true;
                                job.abort();
                                if (jobs.get(runId) === job)
                                    jobs.delete(runId);
                                job.finish();
                                resolve();
                            });
                        }, TASK_RESULT_FLUSH_TIMEOUT_MS);
                    })]);
            }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
        }, async stop() {
            stopped = true;
            for (const job of jobs.values()) {
                job.cancelled = true;
                job.abort();
                if (!job.started)
                    job.finish();
            }
            await Promise.all([...jobs.values()].map(job => job.done));
            jobs.clear();
        } };
    collectors.set(deps.store, { collector, stopped: () => stopped, assertRun(runId) {
            const owner = deps.resolve(runId);
            if (stopped)
                throw new Error('task-result-job-stopped');
            deps.store.assertOwner();
            if (!owner)
                return 'absent';
            valid({ runId, cancelled: false } as Job, owner);
            return sha256Canonical({ input: owner.input, executionId: owner.executionId });
        } });
    return collector;
}
function validatePage(page: TaskResultCollectionV1, old: TaskResultState): void {
    if (page.revision < old.sourceRevision || page.nextRevision < old.revision || page.currentAttempt < old.currentAttempt || page.manifests.some((m, i) => m.revision !== old.revision + i + 1) || page.nextRevision !== (page.manifests.at(-1)?.revision ?? old.revision) || (page.nextRevision < page.revision && page.manifests.length !== 64))
        throw new Error('task-result-page-stale');
}
