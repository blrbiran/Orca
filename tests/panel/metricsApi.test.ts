import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordCorrection } from "../../src/corrections/store.js";
import type { Correction } from "../../src/corrections/schema.js";
import type { DecisionKind, DecisionScope } from "../../src/ledger/types.js";
import { collect } from "../../src/metrics/collect.js";
import { computeMetrics } from "../../src/metrics/compute.js";
import { UNRESOLVED_PROJECT_KEYS } from "../../src/metrics/discover.js";
import { isHighTier } from "../../src/metrics/highTier.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import { computePanelCoverage } from "../../src/panel/coverage.js";
import { PANEL_HOST_NOT_ALLOWED } from "../../src/panel/bindGuard.js";
import { TOKEN_REQUIRED } from "../../src/panel/rejection.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import type { PanelOptions, StartedPanel } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { makeTargetRepo, withCorrectionsDir } from "../corrections/harness.js";

const get = async (started: StartedPanel, path: string, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, { headers: { "x-orca-token": token ?? started.token } });

interface RawResponse {
  status: number;
  contentType: string | undefined;
  body: string;
}

/**
 * task 5 ruling G4: node:http's raw `path`, never fetch. WHATWG URL parsing
 * collapses ".", ".." and "%2e%2e" dot segments on the CLIENT before the
 * request is even sent, so a fetch-based criterion would test the browser's
 * URL parser, not the server. This sends whatever string is handed to it,
 * unmodified, as the HTTP request-line path.
 */
function rawGet(baseUrl: string, rawPath: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: rawPath, method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, contentType: res.headers["content-type"], body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Every in-process server a criterion starts needs a distDir fixture (task 5
 * ruling G1): there is no web/dist in this repo, and loadStaticFiles refuses
 * by name (panel-dist-missing) when the directory it is pointed at does not
 * exist. Also carries a symlink OUT of dist and a file outside it, mirroring
 * tests/panel/staticFiles.test.ts's fixture, for the traversal criterion below.
 */
async function makeDistFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "orca-panel-dist-"));
  const dist = join(root, "dist");
  const outside = join(root, "secret");
  await mkdir(dist, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "passwd.txt"), "root:x:0:0\n");
  await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  await writeFile(join(dist, "index.js"), "console.log(1)\n");
  await symlink(join(outside, "passwd.txt"), join(dist, "linked.txt"));
  return { dir: dist, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("the metrics endpoint (spec sections 4.1 and 5)", () => {
  it("passes E2's report through field for field, adding nothing and dropping nothing", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      // Fixed, injected clock (task 5 ruling G3): the ONE clock this
      // subsystem reads, so this criterion's own `collect()` call below sees
      // exactly the same `as_of` the server computed, and the deep-equal
      // below is not a coin flip against two different wall-clock reads.
      const fixedNow = (): Date => new Date("2026-09-10T00:00:00.000Z");
      try {
        const opts: PanelOptions = {
          ...parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
          now: fixedNow,
        };
        const started = await createPanelServer(opts);
        try {
          const res = await get(started, "/api/metrics");
          expect(res.status).toBe(200);
          const body = (await res.json()) as { report: unknown };

          const observations = await collect({
            root: opts.root,
            repos: opts.repos,
            correctionsDir: opts.correctionsDir,
            now: () => fixedNow().toISOString(),
          });
          const expectedReport = computeMetrics(observations, { bucket: "month" });

          // The panel is not allowed to compute a metric of its own: a
          // "helpful" derived field anywhere in this response is a red here,
          // not a silent extra, because this is a deep-equal against the
          // WHOLE report -- no stripping of as_of/as_of_mode (ruling G3).
          expect(body.report).toEqual(expectedReport);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("re-runs repository discovery and E2's gate on EVERY request", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const opts = parsePanelArgs(
          ["--by", "tester", "--repo", `known=${repo.path}`, "--dist", dist.dir],
          { ORCA_CORRECTIONS_DIR: dir },
        );
        const started = await createPanelServer(opts);
        try {
          expect((await get(started, "/api/metrics")).status).toBe(200);

          // 🔴 The fixture that breaks the gate is created AFTER the server
          // is up (ruling G11). Built beforehand, this criterion would pass
          // with the gate wired to startup, and mutation G-11 (computing
          // currentMetrics once and reusing it) could not go red.
          const ghost: Correction = {
            id: "ghost-correction-1",
            projectKey: "ghost-project",
            decisionId: "ghost-run/1",
            kind: "wrong",
            because: "unresolved on purpose, to prove the gate re-runs",
            at: "2026-09-05T00:00:00.000Z",
            by: "tester",
          };
          await recordCorrection(dir, ghost, { again: false });

          const second = await get(started, "/api/metrics");
          expect(second.status).toBe(409);
          const body = (await second.json()) as { code: string };
          expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("answers a broken gate with a first-class error, never with partial data", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const opts = parsePanelArgs(
          ["--by", "tester", "--repo", `known=${repo.path}`, "--dist", dist.dir],
          { ORCA_CORRECTIONS_DIR: dir },
        );
        const started = await createPanelServer(opts);
        try {
          const ghost: Correction = {
            id: "ghost-correction-2",
            projectKey: "another-ghost",
            decisionId: "ghost-run/1",
            kind: "wrong",
            because: "unresolved on purpose, to prove the error page carries no data",
            at: "2026-09-05T00:00:00.000Z",
            by: "tester",
          };
          await recordCorrection(dir, ghost, { again: false });

          const res = await get(started, "/api/metrics");
          expect(res.status).toBe(409);
          const body = (await res.json()) as Record<string, unknown>;
          // Named by the imported constant, not a retyped string literal:
          // review round 1 caught this assertion missing entirely (Rule 12).
          expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS);
          // Relaxing here voids E2's gate: a silently dropped repository
          // makes the correction rate silently higher and nothing says so.
          // Assert the body has NO `report` key at all, not merely that
          // status != 200.
          expect("report" in body).toBe(false);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("answers 401 without a token, and 401 with a wrong one", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `known=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const noToken = await fetch(`${started.url}/api/metrics`);
          expect(noToken.status).toBe(401);
          expect(((await noToken.json()) as { code: string }).code).toBe(TOKEN_REQUIRED);

          const wrongToken = await get(started, "/api/metrics", "0".repeat(64));
          expect(wrongToken.status).toBe(401);
          expect(((await wrongToken.json()) as { code: string }).code).toBe(TOKEN_REQUIRED);

          // Positive control, in the same criterion: without it, a middleware
          // that refuses EVERY request would pass the two assertions above
          // vacuously.
          const rightToken = await get(started, "/api/metrics");
          expect(rightToken.status).toBe(200);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("binds the literal 127.0.0.1 by default", async () => {
    await withCorrectionsDir(async (dir) => {
      const dist = await makeDistFixture();
      try {
        // 🔴 Goes through parsePanelArgs. Mutation P-2 mutates the
        // `?? "127.0.0.1"` INSIDE parsePanelArgs; calling createPanelServer
        // with a hand-built options object never executes that line.
        const started = await createPanelServer(
          parsePanelArgs(["--by", "amy", "--dist", dist.dir], { ORCA_CORRECTIONS_DIR: dir }),
        );
        try {
          expect(started.url.startsWith("http://127.0.0.1:")).toBe(true);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
      }
    });
  });
});

describe("static serving via HTTP (spec section 2.2)", () => {
  it("serves the token-injected index.html at / with no token header", async () => {
    await withCorrectionsDir(async (dir) => {
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--dist", dist.dir], { ORCA_CORRECTIONS_DIR: dir }),
        );
        try {
          const res = await rawGet(started.url, "/");
          expect(res.status).toBe(200);
          expect(res.contentType).toBe("text/html; charset=utf-8");
          // Exactly once: the anchor has to be consumed, and this is the
          // browser's very first request -- for the HTML that carries the
          // token -- which cannot present one.
          expect(res.body.split(started.token).length - 1).toBe(1);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
      }
    });
  });

  it("answers 404 for every traversal spelling over HTTP, with a positive control that resolves", async () => {
    await withCorrectionsDir(async (dir) => {
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--dist", dist.dir], { ORCA_CORRECTIONS_DIR: dir }),
        );
        try {
          for (const spelling of [
            "/../../etc/passwd",
            "/..%2f..%2fetc%2fpasswd",
            "/%2e%2e/",
            "/./index.js",
            "/subdir/index.js",
            "/linked.txt",
            "/nope.js",
          ]) {
            const res = await rawGet(started.url, spelling);
            expect(res.status, spelling).toBe(404);
          }
          // Positive control in the SAME criterion: a spelling that WOULD
          // resolve if the ones above were normalised really does resolve
          // when sent un-normalised, proving the 404s were not vacuous --
          // e.g. that the server's req.url really was the raw spelling and
          // not something a proxy or router had already collapsed.
          const positive = await rawGet(started.url, "/index.js");
          expect(positive.status).toBe(200);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
      }
    });
  });
});

/**
 * Final review I-4 / ruling R67: DNS rebinding. Loopback binding keeps other
 * machines out; it does not keep out a page in the person's own browser whose
 * hostname re-resolves to 127.0.0.1. The probe measured `GET /` with
 * `Host: evil.example:80` -> 200 with the token in the body. The Host header is
 * set by hand on a raw node:http request -- the TCP connection still goes to
 * 127.0.0.1, exactly as a rebound browser's would.
 */
describe("the Host allowlist (final review I-4, DNS rebinding)", () => {
  const withPanel = async (fn: (started: StartedPanel) => Promise<void>): Promise<void> => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          await fn(started);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  };

  it("refuses a foreign Host on the token-carrying page with 403 by name, and the body carries no token", async () => {
    await withPanel(async (started) => {
      // `evil.localhost` is in the list on purpose, with and without a port: a
      // suffix match on "localhost" (mutation HG-2) would let it through,
      // whether the match is on the parsed hostname or on the raw header.
      for (const host of [
        "evil.example",
        `evil.example:${started.port}`,
        "evil.localhost",
        `evil.localhost:${started.port}`,
      ]) {
        const res = await rawGet(started.url, "/", { host });
        expect(res.status, host).toBe(403);
        expect((JSON.parse(res.body) as { code: string }).code, host).toBe(PANEL_HOST_NOT_ALLOWED);
        expect(res.body.includes(started.token), host).toBe(false);
      }
    });
  });

  it("refuses a foreign Host on the API even with a valid token (the guard sits in front of /api too)", async () => {
    await withPanel(async (started) => {
      const res = await rawGet(started.url, "/api/metrics", {
        host: `evil.example:${started.port}`,
        "x-orca-token": started.token,
      });
      expect(res.status).toBe(403);
      expect((JSON.parse(res.body) as { code: string }).code).toBe(PANEL_HOST_NOT_ALLOWED);
      expect(res.body.includes(started.token)).toBe(false);
    });
  });

  it("uses the exact V1 envelope for a foreign Host on control routes while preserving legacy API errors", async () => {
    await withPanel(async (started) => {
      const headers = { host: `evil.example:${started.port}`, "x-orca-token": started.token };
      const control = await rawGet(started.url, "/api/control/config", headers);
      expect(control.status).toBe(403);
      expect(JSON.parse(control.body)).toEqual({
        error: {
          code: PANEL_HOST_NOT_ALLOWED,
          message: "this panel answers only to 127.0.0.1, localhost, ::1 or the address it was bound to",
          commandRevision: null,
          evidenceIds: [],
          retryable: false,
        },
      });

      const legacy = await rawGet(started.url, "/api/metrics", headers);
      expect(legacy.status).toBe(403);
      expect(JSON.parse(legacy.body)).toEqual({
        code: PANEL_HOST_NOT_ALLOWED,
        message: "this panel answers only to 127.0.0.1, localhost, ::1 or the address it was bound to",
      });
    });
  });

  it("answers the loopback names it was reached by: 127.0.0.1, localhost and [::1] (positive controls)", async () => {
    await withPanel(async (started) => {
      for (const host of [`127.0.0.1:${started.port}`, `localhost:${started.port}`, `[::1]:${started.port}`]) {
        const page = await rawGet(started.url, "/", { host });
        expect(page.status, host).toBe(200);
        expect(page.body.includes(started.token), host).toBe(true);
        const api = await rawGet(started.url, "/api/metrics", { host, "x-orca-token": started.token });
        expect(api.status, host).toBe(200);
      }
    });
  });
});

describe("panel review coverage (spec section 4.2)", () => {
  // A concrete high-tier and a concrete low-tier (scope, kind) pair, read off
  // isHighTier -- never hard-coded as a table (task 5 ruling G10).
  const HIGH_KIND: DecisionKind = "interface";
  const HIGH_SCOPE: DecisionScope = "repo";
  const LOW_SCOPE: DecisionScope = "file"; // same kind, low tier by scope alone
  if (!isHighTier(HIGH_SCOPE, HIGH_KIND) || isHighTier(LOW_SCOPE, HIGH_KIND)) {
    throw new Error("fixture assumption broke: expected one high-tier and one low-tier (scope, kind) pair");
  }

  const decision = (id: string, projectKey: string, scope: DecisionScope = HIGH_SCOPE): DecisionObservation => ({
    projectKey,
    id,
    at: "2026-09-01T00:00:00.000Z",
    kind: HIGH_KIND,
    scope,
    verdict: "ok",
  });
  const review = (
    decisionId: string,
    projectKey: string,
    action: ReviewRow["action"],
    by = "tester",
  ): ReviewRow => ({ decisionId, projectKey, action, by, at: "2026-09-02T00:00:00.000Z" });

  it("counts distinct reviewed high-tier decisions over high-tier total; reviewed twice counts once", () => {
    const decisions = [decision("run/1", "p")];
    const reviews = [review("run/1", "p", "reviewed"), review("run/1", "p", "reviewed", "amy")];
    const result = computePanelCoverage(decisions, reviews);
    expect(result.reviewed_high_tier).toBe(1);
    expect(result.high_tier_total).toBe(1);
    expect(result.rate).toBe(1);
  });

  it("keeps `opened` out of the numerator even when there are many of them", () => {
    const decisions = [decision("run/1", "p")];
    const reviews = Array.from({ length: 20 }, (_, i) => review("run/1", "p", "opened", `viewer-${i}`));
    const result = computePanelCoverage(decisions, reviews);
    expect(result.reviewed_high_tier).toBe(0);
    expect(result.high_tier_total).toBe(1);
    expect(result.rate).toBe(0);
  });

  it("a reviewed row on a LOW-tier decision adds zero, and that decision is not in the denominator", () => {
    const decisions = [decision("run/1", "p", LOW_SCOPE)];
    const reviews = [review("run/1", "p", "reviewed")];
    const result = computePanelCoverage(decisions, reviews);
    expect(result.high_tier_total).toBe(0);
    expect(result.reviewed_high_tier).toBe(0);
    expect(result.rate).toBeNull();
  });

  it("reports rate null, not 0, when there are no high-tier decisions", () => {
    const result = computePanelCoverage([], []);
    expect(result.high_tier_total).toBe(0);
    expect(result.reviewed_high_tier).toBe(0);
    expect(result.rate).toBeNull();
  });

  it("a reviewed row whose projectKey differs from the decision's (same decisionId) adds zero", () => {
    // E2's measured lesson: decision ids repeat across clones and forks, so
    // the join has to be (projectKey, id), not id alone.
    const decisions = [decision("run/1", "project-a")];
    const reviews = [review("run/1", "project-b", "reviewed")];
    const result = computePanelCoverage(decisions, reviews);
    expect(result.high_tier_total).toBe(1);
    expect(result.reviewed_high_tier).toBe(0);
    expect(result.rate).toBe(0);
  });
});
