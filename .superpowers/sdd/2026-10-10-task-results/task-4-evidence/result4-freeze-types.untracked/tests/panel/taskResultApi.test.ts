import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readTaskResultState } from '../../src/control/taskResultStore.js';
import { describe, it, expect } from 'vitest';
import { resultFixture, resultHttp, context } from './fixtures/taskResults.js';
describe('saved task result API', { timeout: 30000 }, () => {
    it('serves actual admitted run and group results under the panel epoch without GET writes', async () => {
        const f = await resultFixture();
        await f.capture([f.manifest()]);
        const http = await resultHttp(f);
        try {
            const changes = Number(f.store.db.prepare('SELECT total_changes() AS n').get()!.n);
            const artifactRoot = join(f.store.stateDir, 'artifacts');
            const files = (await readdir(artifactRoot, { recursive: true })).sort();
            const before = await Promise.all(files.filter(p => p.endsWith('/data')).map(p => readFile(join(artifactRoot, p))));
            const run = await http.session.fetch(`/api/control/runs/${f.runId}/results`);
            expect(run.status).toBe(200);
            const body = await run.json();
            expect(body.schema).toBe('orca-run-results-v1');
            expect(body.epoch).toBe(context.epoch);
            expect(body.attempts[0].explanation.content.completedWork).toEqual(['Saved work']);
            const group = await http.session.fetch('/api/control/groups/g/results');
            expect(group.status).toBe(200);
            expect((await group.json()).tasks[0].runs[0].runId).toBe(f.runId);
            expect(Number(f.store.db.prepare('SELECT total_changes() AS n').get()!.n)).toBe(changes);
            expect((await readdir(artifactRoot, { recursive: true })).sort()).toEqual(files);
            expect(await Promise.all(files.filter(p => p.endsWith('/data')).map(p => readFile(join(artifactRoot, p))))).toEqual(before);
        }
        finally {
            await http.close();
            await f.dispose();
        }
    });
    it('serves inert HTML, attachment downloads and refuses arbitrary output/hash ids and unauthenticated reads', async () => {
        const f = await resultFixture();
        await f.capture([f.manifest()]);
        const http = await resultHttp(f);
        try {
            const r = await http.session.fetch(`/api/control/runs/${f.runId}/results`);
            expect(r.status).toBe(200);
            const id = (await r.json()).attempts[0].outputs[0].outputId;
            const route = `/api/control/runs/${f.runId}/results/outputs/${id}`;
            const preview = await http.session.fetch(route);
            expect(preview.status).toBe(200);
            expect(preview.headers.get('content-type')).toContain('application/json');
            expect((await preview.json()).content).toBe('<script>alert(1)</script>');
            const download = await http.session.fetch(route + '?download=1');
            expect(download.status).toBe(200);
            expect(download.headers.get('content-disposition')).toContain('attachment');
            expect(download.headers.get('x-content-type-options')).toBe('nosniff');
            expect(await download.text()).toBe('<script>alert(1)</script>');
            for (const id of ['output-1', f.output.artifactId, f.output.hash])
                expect((await http.session.fetch(`/api/control/runs/${f.runId}/results/outputs/${id}`)).status).toBe(423);
            expect((await fetch(http.url + route)).status).toBe(401);
            expect((await http.session.fetch(route + '?download=0')).status).toBe(400);
        }
        finally {
            await http.close();
            await f.dispose();
        }
    });
    it('missing admitted manifest refuses by name while healthy core evidence remains available', async () => {
        const f = await resultFixture();
        await f.capture([f.manifest()]);
        const http = await resultHttp(f);
        try {
            const r = await http.session.fetch(`/api/control/runs/${f.runId}/results`);
            const outputId = (await r.json()).attempts[0].outputs[0].outputId;
            const ref = readTaskResultState(f.store, f.runId)!.observations[0].manifestRef;
            await rm(join(f.store.stateDir, 'artifacts', ref.artifactId, 'data'));
            const response = await http.session.fetch(`/api/control/runs/${f.runId}/results/outputs/${outputId}`);
            expect(response.status).toBe(423);
            expect((await response.json()).error.code).toBe('recovery-blocked');
            expect((await http.session.fetch(`/api/control/runs/${f.runId}/evidence`)).status).toBe(200);
        }
        finally {
            await http.close();
            await f.dispose();
        }
    });
});
