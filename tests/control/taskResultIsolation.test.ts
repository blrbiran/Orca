import { describe, it, expect } from 'vitest';
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveRun, readArtifact } from '../../src/control/archive.js';
import { archiveCase } from './fixtures/archive.js';
import { exportResumeBundle } from '../../src/control/resumeBundle.js';
import { stepCleanupFailed } from '../../src/control/executionDriver.js';
import { stop, requestState, committedAndUsed } from './fixtures/handoffHarness.js';
import { execFileSync } from 'node:child_process';
import { driverHarness } from './fixtures/driverHarness.js';
// Removing either exact namespace exclusion admits optional faults into core checkpoint eligibility.
describe('task result archive isolation', { timeout: 30000 }, () => {
    it.each(['control/task-result-evidence', 'run/task-result-captures'])('ignores missing, special and changing supplemental entries in %s', async (namespace) => {
        const h = await archiveCase();
        try {
            const optional = join(h.sourceDir, namespace);
            await mkdir(optional, { recursive: true, mode: 0o700 });
            execFileSync('mkfifo', [join(optional, 'special')]);
            await symlink('/missing/result', join(optional, 'missing'));
            await writeFile(join(optional, 'changing'), 'before');
            const result = await archiveRun(h.store, { runId: h.claim.runId, sourceDir: h.sourceDir, repoDir: h.repoDir, stopProof: h.stopProof }, { afterCopy: async (path) => {
                    if (path.endsWith('stdout.log')) {
                        await rm(optional, { recursive: true });
                        await symlink('/missing/namespace', optional);
                    }
                } });
            expect(result.missing).toEqual([]);
            const manifest = JSON.parse((await readArtifact(h.store, result.artifacts.find(r => r.artifactId.startsWith('archive-'))!)).toString());
            expect(manifest.logs.some((e: {
                path: string;
            }) => e.path === namespace || e.path.startsWith(namespace + '/'))).toBe(false);
        }
        finally {
            await h.dispose();
        }
    });
    it('normal driver settlement keeps outcome, usage and recoverability with broken optional namespaces', async () => {
        const t = await driverHarness([{ taskId: 'a' }]);
        const driver = t.driver();
        try {
            const runId = await t.claim();
            await t.until(driver, () => t.body(runId).state === 'landed');
            const source = t.body(runId).drive.sourceDir;
            for (const ns of ['control/task-result-evidence', 'run/task-result-captures']) {
                await mkdir(join(source, ns.split('/')[0]), { recursive: true, mode: 0o700 });
                await symlink('/missing/optional', join(source, ns));
            }
            await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
            expect(t.body(runId)).toMatchObject({ state: 'settled', recoverable: true, highWater: 2, cumulative: { work: { tokens: 10 } }, drive: { outcome: 'succeeded', cleanupError: null } });
            const checkpoint = JSON.parse(String(t.h.store.db.prepare('SELECT body FROM checkpoints WHERE run_id=?').get(runId)!.body));
            expect(checkpoint.missing).toEqual([]);
        }
        finally {
            await driver.stop();
            await t.h.dispose();
        }
    });
});
async function poison(source: string): Promise<void> {
    for (const ns of ['control/task-result-evidence', 'run/task-result-captures']) {
        await mkdir(join(source, ns.split('/')[0]), { recursive: true, mode: 0o700 });
        await symlink('/missing/optional', join(source, ns));
    }
}
describe('isolation in H-settle, failed cleanup and continuation closure', { timeout: 60000 }, () => {
    it('H-settle retains continuation eligibility and booked usage with unreadable supplemental namespaces', async () => {
        const t = await driverHarness([{ taskId: 'a' }], { behaviour: () => 'stoppable' }), driver = t.driver();
        try {
            const id = await t.claim();
            await t.until(driver, () => t.body(id).state === 'accepted');
            await poison(t.body(id).drive.sourceDir);
            const committed = committedAndUsed(t), [request] = await stop(t);
            await t.until(driver, () => requestState(t, request) === 'settled-recoverable');
            expect(t.body(id)).toMatchObject({ state: 'settled-recoverable', recoverable: true, highWater: 2, cumulative: { work: { tokens: 10 } } });
            expect(committedAndUsed(t)).toEqual(committed);
            const checkpoint = JSON.parse(String(t.h.store.db.prepare('SELECT body FROM checkpoints WHERE run_id=?').get(id)!.body));
            expect(checkpoint.missing).toEqual([]);
            const bundle = await exportResumeBundle(t.h.store, { predecessorRunId: id, newSourceDir: join(t.h.root, 'continuation-source') });
            expect(bundle.checkpointId).toBe(checkpoint.checkpointId);
            const resumed = await t.service.resumeFromHandoff(t.h.command('resume-from-handoff', { selections: [{ taskId: 'a', predecessorRunId: id, checkpointId: checkpoint.checkpointId }] }));
            expect(resumed).not.toHaveProperty('error');
        }
        finally {
            await driver.stop();
            await t.h.dispose();
        }
    });
    it('settled-failed cleanup ignores supplemental faults and keeps failed outcome and usage', async () => {
        const t = await driverHarness([{ taskId: 'a' }], { behaviour: () => 'failed' }), driver = t.driver();
        try {
            const id = await t.claim();
            await t.until(driver, () => t.body(id).state === 'blocked');
            await poison(t.body(id).drive.sourceDir);
            expect(t.service.retryTask(t.h.command('retry-task', { taskId: 'a' }))).not.toHaveProperty('error');
            expect(await stepCleanupFailed(t.deps, id)).toBe(true);
            expect(t.body(id)).toMatchObject({ state: 'settled-failed', highWater: 2, cumulative: { work: { tokens: 10 } }, drive: { outcome: 'failed', cleanedUp: true, cleanupError: null } });
            const archive = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive'").get()!.body));
            expect(archive.missing).toEqual([]);
        }
        finally {
            await driver.stop();
            await t.h.dispose();
        }
    });
    it('genuine core handoff damage still refuses recoverability despite excluded optional faults', async () => {
        const t = await driverHarness([{ taskId: 'a' }], { behaviour: () => 'stoppable-missing' }), driver = t.driver();
        try {
            const id = await t.claim();
            await t.until(driver, () => t.body(id).state === 'accepted');
            await poison(t.body(id).drive.sourceDir);
            const [request] = await stop(t);
            await t.until(driver, () => requestState(t, request) === 'settled-unrecoverable');
            expect(t.body(id)).toMatchObject({ recoverable: false, failureCode: 'missing:evidence-lost' });
            await expect(exportResumeBundle(t.h.store, { predecessorRunId: id, newSourceDir: join(t.h.root, 'refused-source') })).rejects.toThrow('resume-predecessor-unrecoverable');
        }
        finally {
            await driver.stop();
            await t.h.dispose();
        }
    });
});
