import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECISION_KINDS, DECISION_SCOPES } from "../../src/ledger/types.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import type { DecisionKind, DecisionScope } from "../../src/ledger/types.js";
import { appendEvent } from "../../src/ledger/writer.js";
import { isHighTier } from "../../src/metrics/highTier.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import { unreviewedHighTier } from "../../src/panel/coverage.js";
import { LIST_FIELDS } from "../../src/panel/listProjection.js";
import { readReviews } from "../../src/panel/reviewsStore.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { ORIGINAL, git, makeTargetRepo, withCorrectionsDir } from "../corrections/harness.js";

/**
 * task 8 ruling K5. `unreviewedHighTier` is the pure classifier
 * (src/panel/coverage.ts); `GET /api/todo` (src/panel/api.ts) is the HTTP
 * shell over it. File-local HTTP helpers, same shape as
 * tests/panel/decisionsApi.test.ts's (ruling H7 there) -- this file stays
 * isolated from that one.
 */
const get = async (started: StartedPanel, path: string, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, { headers: { "x-orca-token": token ?? started.token } });

const post = async (started: StartedPanel, path: string, body: unknown, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, {
    method: "POST",
    headers: { "x-orca-token": token ?? started.token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function makeDistFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "orca-panel-dist-"));
  const dist = join(root, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  return { dir: dist, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/**
 * K5: "choose them by calling isHighTier, do not hard-code a table." Walks
 * DECISION_SCOPES x DECISION_KINDS looking for a combination that classifies
 * the way `want` asks, so this file never repeats highTier.ts's own table.
 */
function findScopeKind(want: boolean): { scope: DecisionScope; kind: DecisionKind } {
  for (const scope of DECISION_SCOPES) {
    for (const kind of DECISION_KINDS) {
      if (isHighTier(scope, kind) === want) return { scope, kind };
    }
  }
  throw new Error(`no scope/kind combination classifies as ${want ? "high" : "low"} tier`);
}

const HIGH = findScopeKind(true);
const LOW = findScopeKind(false);

function decision(overrides: Partial<DecisionObservation> = {}): DecisionObservation {
  return {
    projectKey: "proj",
    id: "run/1",
    at: "2026-09-01T00:00:00.000Z",
    kind: HIGH.kind,
    scope: HIGH.scope,
    verdict: "ok",
    ...overrides,
  };
}

function reviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    decisionId: "run/1",
    projectKey: "proj",
    action: "reviewed",
    by: "amy",
    at: "2026-09-01T00:01:00.000Z",
    ...overrides,
  };
}

describe("unreviewedHighTier (task 8 ruling K5, pure)", () => {
  it("(a) excludes a high-tier decision that carries a `reviewed` row", () => {
    const decisions = [decision()];
    const reviews = [reviewRow()];
    expect(unreviewedHighTier(decisions, reviews)).toEqual([]);
  });

  it("(b) keeps a high-tier decision whose only row is `opened`", () => {
    const decisions = [decision()];
    const reviews = [reviewRow({ action: "opened" })];
    expect(unreviewedHighTier(decisions, reviews)).toEqual(decisions);
  });

  it("(c) excludes a low-tier decision even with no review row at all", () => {
    const decisions = [decision({ kind: LOW.kind, scope: LOW.scope })];
    expect(unreviewedHighTier(decisions, [])).toEqual([]);
  });

  it("(d) a `reviewed` row for the same id under another projectKey does not exclude it", () => {
    const decisions = [decision({ projectKey: "proj-a" })];
    const reviews = [reviewRow({ projectKey: "proj-b" })];
    expect(unreviewedHighTier(decisions, reviews)).toEqual(decisions);
  });
});

describe("GET /api/todo (task 8 ruling K5, HTTP)", () => {
  it("(e) answers with exactly the unreviewed high-tier decision, deep-equal to its LIST_FIELDS projection, and records nothing", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        // ORIGINAL (harness.ts) is scope "repo" / kind "interface" -- confirmed
        // high tier by the same classifier under test, not by re-typing a table.
        expect(isHighTier(ORIGINAL.scope, ORIGINAL.kind)).toBe(true);

        const second: DecisionEvent = { ...ORIGINAL, id: "orca-dev-1/2", at: "2026-09-01T00:01:00.000Z" };
        await appendEvent(repo.decisionsDir, "orca-dev-1", second);
        await git(repo.path, ["add", "-A"]);
        await git(repo.path, ["commit", "-m", "seed a second high-tier decision"]);

        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const reviewed = await post(started, "/api/reviews", { projectKey: "proj", decisionId: ORIGINAL.id });
          expect(reviewed.status).toBe(200);

          const res = await get(started, "/api/todo");
          expect(res.status).toBe(200);
          const body = (await res.json()) as { rows: unknown[] };

          // Built by hand from LIST_FIELDS, NOT by calling projectForList --
          // same tautology guard as decisionsApi.test.ts's comment explains.
          const expectedRow = Object.fromEntries(
            LIST_FIELDS.map((field) => {
              const value: Record<string, unknown> = {
                projectKey: "proj",
                id: second.id,
                at: second.at,
                kind: second.kind,
                scope: second.scope,
                verdict: "ok",
              };
              return [field, value[field]];
            }),
          );
          expect(body.rows).toStrictEqual([expectedRow]);

          const rows = await readReviews(dir);
          expect(rows.filter((r) => r.action === "reviewed")).toHaveLength(1);
          expect(rows.filter((r) => r.action === "reviewed")[0]?.decisionId).toBe(ORIGINAL.id);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });
});
