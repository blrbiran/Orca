import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { artifactSchema, idSchema } from './schema.js';
export const MAX_TASK_RESULT_FILES = 64;
export const MAX_TASK_RESULT_FILE_BYTES = 1048576;
export const MAX_TASK_RESULT_PREVIEW_BYTES = 131072;
export const MAX_TASK_RESULT_EVIDENCE_BYTES = 16 * 1024 * 1024;
export const TASK_RESULT_RPC_TIMEOUT_MS = 1000;
export const TASK_RESULT_FLUSH_TIMEOUT_MS = 67000;
export const TASK_RESULT_SOURCE_EXCLUSIONS = ['control/task-result-evidence', 'run/task-result-captures'];
export class TaskResultUnsupportedError extends Error {
    constructor() { super('task-results-unsupported'); }
}
export function safeTaskResultPath(path: string): boolean {
    return path.length > 0 && path.length <= 1024 && !/[\\\0:]/.test(path) && !isAbsolute(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export const TASK_RESULT_MANIFEST_SCHEMA = "ccloop-task-result-manifest-v1";
export const TASK_RESULT_COLLECTION_SCHEMA = "ccloop-task-results-v1";
export const TASK_RESULT_VERIFICATION_STARTED_SCHEMA = "ccloop-task-result-verification-started-v1";
export const TASK_RESULT_VERIFICATION_NOT_RUN_SCHEMA = "ccloop-task-result-verification-not-run-v1";
const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), positive = safe.refine(n => n > 0), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const taskResultIdentitySchema = z.object({
    groupId: idSchema, workItemId: idSchema, taskId: idSchema.nullable(), runId: idSchema, generation: positive, graphVersion: safe, targetVersion: safe, executionId: idSchema, envelopeHash: hash
}).strict();
export const taskResultVerificationStartedSchema = z.object({
    schema: z.literal(TASK_RESULT_VERIFICATION_STARTED_SCHEMA),
    attempt: positive,
    status: z.literal("in-progress"),
}).strict();
export const taskResultVerificationNotRunSchema = z.object({schema:z.literal(TASK_RESULT_VERIFICATION_NOT_RUN_SCHEMA),attempt:positive,status:z.literal('not-run')}).strict();
export type TaskResultIdentityV1 = z.infer<typeof taskResultIdentitySchema>;
export const taskResultOutputSchema = z.object({
    id: idSchema, path: z.string().max(1024), label: z.string().max(256), origin: z.enum(["reported", "changed"]), status: z.enum(["available", "missing", "deleted", "symlink", "binary", "too-large", "changed", "unsafe", "unavailable"]), byteLength: safe.max(MAX_TASK_RESULT_FILE_BYTES).nullable(), ref: artifactSchema.nullable()
}).strict().refine(o => (o.status === "available" || o.status === "binary") ? o.ref !== null && o.byteLength !== null : o.ref === null && o.byteLength === null);
export type TaskResultOutputV1 = z.infer<typeof taskResultOutputSchema>;
export const taskResultManifestSchema = z.object({
    schema: z.literal(TASK_RESULT_MANIFEST_SCHEMA), identity: taskResultIdentitySchema, attempt: positive, revision: positive, stage: z.enum(["execution", "verification"]), explanation: z.object({
        status: z.enum(["missing", "invalid", "available"]), reason: z.string().max(256).nullable(), ref: artifactSchema.nullable()
    }).strict(), executionRef: artifactSchema.nullable(), verificationRef: artifactSchema.nullable(), outputs: z.array(taskResultOutputSchema).max(MAX_TASK_RESULT_FILES)
}).strict().refine(m => m.stage !== "execution" || m.verificationRef === null).refine(m => new Set(m.outputs.map(o => o.id)).size === m.outputs.length);
export type TaskResultManifestV1 = z.infer<typeof taskResultManifestSchema>;
const observationSchema = z.object({
    revision: positive, ref: artifactSchema
}).strict();
export const taskResultCollectionSchema = z.object({
    schema: z.literal(TASK_RESULT_COLLECTION_SCHEMA), identity: taskResultIdentitySchema, currentAttempt: safe, revision: safe, manifests: z.array(observationSchema).max(64), nextRevision: safe
}).strict().refine(c => c.nextRevision <= c.revision && c.manifests.every((m, i) => m.revision <= c.nextRevision && (i === 0 || c.manifests[i - 1]!.revision < m.revision)));
export type TaskResultCollectionV1 = z.infer<typeof taskResultCollectionSchema>;
/** Only actual controller verifier evidence establishes these facts. Executor text is never consulted. */
const completedVerificationSchema = z.object({ approved: z.boolean(), rejectCategory: z.string(), primaryTargetPaths: z.array(z.string()), failingCommand: z.string().nullable(), safeToRetry: z.boolean(), evidence: z.array(z.string()), pauseSignals: z.array(z.string()), stopSignals: z.array(z.string()) }).passthrough();
export type TaskResultVerification = 'not-run' | 'in-progress' | 'passed' | 'failed' | 'unavailable';
export function taskResultVerification(manifest: TaskResultManifestV1, bytes: Buffer | null): TaskResultVerification {
    if (manifest.stage !== 'verification' || bytes === null)
        return 'unavailable';
    try {
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        const marker = typeof value === 'object' && value !== null && 'schema' in value ? value.schema : null;
        if (marker === TASK_RESULT_VERIFICATION_NOT_RUN_SCHEMA) {
            const boundary = taskResultVerificationNotRunSchema.safeParse(value);
            return boundary.success && boundary.data.attempt === manifest.attempt ? 'not-run' : 'unavailable';
        }
        const started = taskResultVerificationStartedSchema.safeParse(value);
        if (marker === TASK_RESULT_VERIFICATION_STARTED_SCHEMA)
            return started.success && started.data.attempt === manifest.attempt ? 'in-progress' : 'unavailable';
        const completed = completedVerificationSchema.safeParse(value);
        return completed.success ? (completed.data.approved ? 'passed' : 'failed') : 'unavailable';
    }
    catch {
        return 'unavailable';
    }
}
/** Source-observed attempt freshness is independent of admitted evidence/capture cursor. */
export const taskResultCurrentAttemptFactSchema = z.object({
    schema: z.literal('orca-task-result-current-attempt-v1'), identity: taskResultIdentitySchema, revision: safe, currentAttempt: safe,
}).strict();
export type TaskResultCurrentAttemptFactV1 = z.infer<typeof taskResultCurrentAttemptFactSchema>;
