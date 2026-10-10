import { sha256Canonical } from './canonicalJson.js';
import { readArtifact } from './archive.js';
import { recordProjectionChange } from './projectionJournal.js';
import type { ControlStore } from './store.js';
import type { ArtifactRef } from './types.js';
import type { TaskResultIdentityV1, TaskResultManifestV1, TaskResultVerification } from './taskResultProtocol.js';
export type TaskResultSourceStatus = 'available' | 'missing' | 'unsupported' | 'stale' | 'unavailable';
export interface TaskResultObservation {
    manifestRef: ArtifactRef;
    manifest: TaskResultManifestV1;
    verification: TaskResultVerification;
}
export interface TaskResultState {
    schema: 'orca-task-result-store-v1';
    identity: TaskResultIdentityV1 | null;
    revision: number;
    sourceRevision: number;
    currentAttempt: number;
    observations: TaskResultObservation[];
    status: TaskResultSourceStatus;
    reason: string | null;
}
export function readTaskResultState(store: ControlStore, runId: string): TaskResultState | null {
    const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='task-results'").get('task-results:' + runId);
    return row ? JSON.parse(String(row.body)) as TaskResultState : null;
}
/** Caller holds owner/run/admission fences; only admitted pages, never partial staging, own evidence. */
export function saveTaskResultState(store: ControlStore, runId: string, groupId: string, state: TaskResultState): void {
    const body = JSON.stringify(state);
    if (JSON.stringify(readTaskResultState(store, runId)) === body)
        return;
    store.db.prepare("INSERT INTO outbox VALUES (?, 'task-results', ?, 1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run('task-results:' + runId, body);
    recordProjectionChange(store, [groupId]);
}
export const sameTaskResultRef = (a: ArtifactRef, b: ArtifactRef) => a.artifactId === b.artifactId && a.hash === b.hash;
export function taskResultManifestRefs(manifest: TaskResultManifestV1): ArtifactRef[] {
    return [manifest.explanation.ref, manifest.executionRef, manifest.verificationRef, ...manifest.outputs.map(o => o.ref)].filter((ref): ref is ArtifactRef => ref !== null);
}
/** Saved bytes are authorized by run + attempt + exact admitted manifest membership, never content hash alone. */
export async function readOwnedTaskResultEvidence(store: ControlStore, runId: string, attempt: number, manifestRef: ArtifactRef, ref: ArtifactRef): Promise<Buffer> {
    const state = readTaskResultState(store, runId), observation = state?.observations.find(o => o.manifest.attempt === attempt && sameTaskResultRef(o.manifestRef, manifestRef));
    if (state?.identity?.runId !== runId || !observation || ![manifestRef, ...taskResultManifestRefs(observation.manifest)].some(r => sameTaskResultRef(r, ref)))
        throw new Error('task-result-evidence-unavailable');
    const bytes = await readArtifact(store, manifestRef);
    if (sha256Canonical(JSON.parse(bytes.toString('utf8'))) !== sha256Canonical(observation.manifest))
        throw new Error('task-result-evidence-unavailable');
    return sameTaskResultRef(manifestRef, ref) ? bytes : readArtifact(store, ref);
}
