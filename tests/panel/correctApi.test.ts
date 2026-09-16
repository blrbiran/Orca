import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { correctionRowFrom } from "../../src/corrections/record.js";
import { CORRECTION_ROW_INVALID } from "../../src/corrections/record.js";
import { CORRECTION_ALREADY_RECORDED, readCorrections } from "../../src/corrections/store.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { appendEvent } from "../../src/ledger/writer.js";
import { CORRECTIONS_STORE_BUSY, acquireStoreLock } from "../../src/corrections/storeLock.js";
import { DECISION_NOT_FOUND } from "../../src/panel/listProjection.js";
import { PANEL_BAD_REQUEST } from "../../src/panel/rejection.js";
import { REVIEWS_STORE_BUSY, acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { readReviews } from "../../src/panel/reviewsStore.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import type { PanelOptions, StartedPanel } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { ORIGINAL, git, makeTargetRepo, withCorrectionsDir } from "../corrections/harness.js";

/**
 * task 7 ruling J2: neither GOLDEN_ID nor its input is exported from
 * tests/corrections/injectableClock.test.ts, and importing a `*.test.ts` file
 * directly would register ITS `describe` blocks a second time inside this
 * file's own run (measured: doing so made this file report 15 tests instead
 * of 11). Duplicated here instead, per J2's other option, with a comment
 * naming the exact file and lines the literal is copied from.
 *
 * tests/corrections/injectableClock.test.ts:16 (`INSTANT`) and :40
 * (`GOLDEN_ID`), read at commit 248f03a (this task's BASE, unmodified by
 * this task).
 */
const GOLDEN_INSTANT = "2026-09-01T12:34:56.000Z";
const GOLDEN_ID = "c_ed266d26d170dd27";

/**
 * task 7 ruling J7: every `it` starts its own server, its own
 * ORCA_CORRECTIONS_DIR and its own target repo(s), closed in `finally`.
 * File-local HTTP helpers, same shape as tests/panel/decisionsApi.test.ts's
 * (ruling H7 there) -- this file stays isolated from that one.
 */
const get = async (started: StartedPanel, path: string, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, { headers: { "x-orca-token": token ?? started.token } });

const post = async (started: StartedPanel, path: string, body: unknown, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, {
    method: "POST",
    headers: { "x-orca-token": token ?? started.token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Final review I-2: raw node:http, never fetch -- fetch would set a
 * content-type of its own for a string body, and this criterion is about what
 * happens when a client does NOT send one.
 */
function rawPost(
  started: StartedPanel,
  path: string,
  body: string,
  contentType: string | undefined,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const u = new URL(started.url);
  const headers: Record<string, string> = {
    "x-orca-token": started.token,
    "content-length": String(Buffer.byteLength(body)),
  };
  if (contentType !== undefined) headers["content-type"] = contentType;
  Object.assign(headers, extraHeaders);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path, method: "POST", headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

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

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * task 7 ruling J4: the "nothing happened" half of "records and does NOT
 * close the loop" needs a POSITIVE snapshot to diff against -- sorted file
 * NAMES (a close-the-loop write may append to a NEW run file) AND the sha256
 * of every file's CONTENTS (it may instead append to an EXISTING one).
 */
async function snapshotDecisionsDir(dir: string): Promise<Record<string, string>> {
  const names = (await readdir(dir).catch(() => [])).sort();
  const out: Record<string, string> = {};
  for (const name of names) out[name] = await sha256File(join(dir, name));
  return out;
}

const validBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  projectKey: "proj",
  decisionId: "orca-dev-1/1",
  kind: "wrong",
  because: "那个前提当时就不成立",
  ...overrides,
});

describe("recording a correction from the panel (spec sections 2.1, 2.3 and 4.4)", () => {
  it("answers a row the seam would refuse with the seam's OWN named refusal (an unknown kind)", async () => {
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
          // ⛔ SUPERSEDED (brief's original wording, both review seats): "derives
          // the SAME correction id the CLI derives" can never go red under C-13
          // because deriveCorrectionId is pure -- see the GOLDEN_ID criterion
          // below, which restores §2.3's actual claim. What a seam bypass MUST
          // lose instead is the seam's own named refusal: an unknown `kind`
          // ("bogus" is not in CORRECTION_KINDS) makes correctionSchema refuse,
          // and only a handler that calls recordNewCorrection (not a bypass that
          // skips its safeParse and lets appendCorrectionLocked's bare
          // `correctionSchema.parse` throw an uncoded ZodError) can translate
          // that into 400 correction-row-invalid instead of 500.
          const res = await post(started, "/api/corrections", validBody({ kind: "bogus" }));
          expect(res.status).toBe(400);
          const body = (await res.json()) as { code: string };
          expect(body.code).toBe(CORRECTION_ROW_INVALID);
          expect(await readCorrections(dir)).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("refuses an empty optional field by name instead of dumping Zod at the person", async () => {
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
          // `kind` is "wrong", explicitly NOT "not_my_taste": schema.ts's
          // superRefine only forces chose_instead for not_my_taste, so with
          // that kind this would pass by way of the refinement and pin
          // nothing about the seam. With "wrong", chose_instead is
          // z.string().min(1).optional() -- the ONLY thing that refuses "" is
          // the seam itself (normalising "" to absent, mutation E-7, would
          // make this a legal, silently-recorded row instead).
          const res = await post(started, "/api/corrections", validBody({ chose_instead: "" }));
          expect(res.status).toBe(400);
          const body = (await res.json()) as { code: string; message: string };
          expect(body.code).toBe(CORRECTION_ROW_INVALID);
          expect(body.message).toContain("chose_instead");
          expect(await readCorrections(dir)).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("records and does NOT close the loop", async () => {
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
          // task 7 ruling J4: a positive snapshot BEFORE the POST, so the
          // "nothing happened" half below has something concrete to diff
          // against -- sorted names AND sha256 of every file (an append into a
          // NEW run file changes the name set; an append into an EXISTING one
          // changes a hash without changing any name).
          const beforeFiles = await snapshotDecisionsDir(repo.decisionsDir);
          const beforeHead = await git(repo.path, ["rev-parse", "HEAD"]);

          const res = await post(started, "/api/corrections", validBody());
          // Positive observation FIRST: "does not do something" needs proof
          // the thing it did NOT close was ever reachable at all.
          expect(res.status).toBe(200);
          expect(await readCorrections(dir)).toHaveLength(1);

          // A' §4.1: a web application holding commit rights on every
          // repository is the thing being refused -- one function call away
          // in code, a whole security model away in fact. Not `git status`
          // alone (ruling J4): the closing path COMMITS, which leaves status
          // clean too, so status alone cannot tell "never touched" from
          // "touched then committed".
          expect(await git(repo.path, ["status", "--porcelain"])).toBe("");
          expect(await git(repo.path, ["rev-parse", "HEAD"])).toBe(beforeHead);
          expect(await snapshotDecisionsDir(repo.decisionsDir)).toEqual(beforeFiles);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("writes its OWN message for a second correction, with no `--again` in it", async () => {
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
          const first = await post(started, "/api/corrections", validBody());
          expect(first.status).toBe(200);

          // The store's dedupe key is (projectKey, decisionId, by) and does
          // NOT include `kind` (src/corrections/store.ts) -- the panel's `by`
          // is constant per process, so a second correction on the SAME
          // decision collides even with a different `kind` below.
          const second = await post(started, "/api/corrections", validBody({ kind: "stale", because: "过时了" }));
          expect(second.status).toBe(409);
          const body = (await second.json()) as { code: string; message: string; retry_field: string };
          expect(body.code).toBe(CORRECTION_ALREADY_RECORDED);
          // The CLI's own words are "Pass --again to record another one on
          // purpose", and there is no --again to pass on a web page
          // (mutation C-14: piping err.message straight through would fail
          // this).
          expect(body.message).not.toContain("--again");
          expect(body.retry_field).toBe("again");
          expect(await readCorrections(dir)).toHaveLength(1);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("records another one when the page asks for it on purpose", async () => {
    // Negative control (brief's own framing): without this, a handler that
    // refuses EVERY second correction would pass the criterion above and the
    // capability A' §4.4 grants would be quietly missing.
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
          const first = await post(started, "/api/corrections", validBody());
          expect(first.status).toBe(200);

          const retried = await post(started, "/api/corrections", validBody({ again: true }));
          expect(retried.status).toBe(200);
          expect(await readCorrections(dir)).toHaveLength(2);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("does NOT write `reviewed` when the correction was refused", async () => {
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
          const res = await post(started, "/api/corrections", validBody({ kind: "bogus" }));
          // Positive observation the refusal really happened.
          expect(res.status).toBe(400);
          expect(await readCorrections(dir)).toHaveLength(0);

          // spec §4.4 third row: that act produced no correction, so it must
          // not produce a `reviewed` mark either (mutation V-5: appending
          // `reviewed` BEFORE calling recordNewCorrection would write this
          // row regardless of whether the correction itself was refused).
          const reviewed = (await readReviews(dir)).filter(
            (r) => r.decisionId === "orca-dev-1/1" && r.action === "reviewed",
          );
          expect(reviewed).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("writes `reviewed` when the correction lands, and when the person clicks agreed", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const fixedNow = (): Date => new Date("2026-09-10T00:00:00.000Z");
      try {
        // A second listed decision, so the /api/reviews half below has its
        // own decision to click "agreed" on, independent of the one
        // corrected above.
        const second: DecisionEvent = { ...ORIGINAL, id: "orca-dev-1/2", at: "2026-09-01T00:01:00.000Z" };
        await appendEvent(repo.decisionsDir, "orca-dev-1", second);

        const opts: PanelOptions = {
          ...parsePanelArgs(["--by", "amy", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
          now: fixedNow,
        };
        const started = await createPanelServer(opts);
        try {
          const res = await post(started, "/api/corrections", validBody());
          expect(res.status).toBe(200);

          // mutation V-1 (no reviewed append) and K-7-adjacent (wrong clock)
          // both land here.
          const rowsA = (await readReviews(dir)).filter(
            (r) => r.decisionId === "orca-dev-1/1" && r.action === "reviewed",
          );
          expect(rowsA).toHaveLength(1);
          expect(rowsA[0]).toMatchObject({ by: "amy", at: fixedNow().toISOString() });

          const res2 = await post(started, "/api/reviews", { projectKey: "proj", decisionId: "orca-dev-1/2" });
          expect(res2.status).toBe(200);
          const body2 = (await res2.json()) as { result: string };
          expect(body2.result).toBe("written");

          // mutation V-2 (writes "opened" instead of "reviewed") lands here.
          const rowsB = (await readReviews(dir)).filter(
            (r) => r.decisionId === "orca-dev-1/2" && r.action === "reviewed",
          );
          expect(rowsB).toHaveLength(1);
          expect(rowsB[0]).toMatchObject({ by: "amy", at: fixedNow().toISOString() });
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("lets a failed `reviewed` write reach the person on POST /api/reviews, unlike `opened`", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const held = await acquireReviewsLock(dir);
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          // spec §4.3.1's asymmetry, stated as a criterion: hold the reviews
          // lock, post an explicit agreement, require a non-2xx (mutation
          // V-3: catching the append failure and answering 200 would leave
          // someone believing they reviewed something the ledger never heard
          // of).
          const res = await post(started, "/api/reviews", { projectKey: "proj", decisionId: "orca-dev-1/1" });
          expect(res.status).toBe(409);
          const body = (await res.json()) as { code: string };
          expect(body.code).toBe(REVIEWS_STORE_BUSY);

          const reviewed = (await readReviews(dir)).filter(
            (r) => r.decisionId === "orca-dev-1/1" && r.action === "reviewed",
          );
          expect(reviewed).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await held.release();
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("tells the person the correction landed even when the reviewed mark could not be written", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const held = await acquireReviewsLock(dir);
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          // mutation V-4 (catches the reviewed-append failure and answers 200
          // with the stored row) lands here: the correction really landed,
          // but the person must be told the review mark did NOT.
          const res = await post(started, "/api/corrections", validBody());
          expect(res.status).toBe(409);
          const body = (await res.json()) as { code: string; correction?: { id: string } };
          expect(body.code).toBe(REVIEWS_STORE_BUSY);
          expect(body.correction?.id).toEqual(expect.any(String));
          expect(await readCorrections(dir)).toHaveLength(1);

          const reviewed = (await readReviews(dir)).filter(
            (r) => r.decisionId === "orca-dev-1/1" && r.action === "reviewed",
          );
          expect(reviewed).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await held.release();
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("answers 404 for a decision the panel does not list, and records nothing (both endpoints)", async () => {
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
          // ruling J1 / mutation M-7: a real decision id, but under a
          // projectKey the panel never configured -- membership requires
          // BOTH to match a currently-discovered row.
          const corrRes = await post(
            started,
            "/api/corrections",
            validBody({ projectKey: "some-other-project" }),
          );
          expect(corrRes.status).toBe(404);
          expect(((await corrRes.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);

          const reviewRes = await post(started, "/api/reviews", {
            projectKey: "some-other-project",
            decisionId: "orca-dev-1/1",
          });
          expect(reviewRes.status).toBe(404);
          expect(((await reviewRes.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);

          expect(await readCorrections(dir)).toHaveLength(0);
          expect(await readReviews(dir)).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("derives the same correction id the CLI derives for the same input and clock (E3 spec §2.3)", async () => {
    // task 7 ruling J2 (restoring the brief's original, correctly-scoped
    // C-13 landing): posts the EXACT input tests/corrections/injectableClock.test.ts
    // uses for its GOLDEN_ID (that file's `recordArgs`, lines 24-27: `--by
    // amy --decision orca-dev-1/1 --kind wrong --because <literal>`, no
    // --chose-instead) under the SAME injected clock (that file's `INSTANT`,
    // line 16), and asserts the stored id equals that file's `GOLDEN_ID`
    // (line 40) -- duplicated as GOLDEN_INSTANT/GOLDEN_ID above rather than
    // imported (see that constant's own comment for why).
    //
    // Sanity check on `correctionRowFrom` directly, independent of the HTTP
    // round-trip, pinning that this file's literal duplicate really does
    // match the golden fixture's row before trusting the HTTP assertion below:
    const sanityRow = correctionRowFrom(
      {
        projectKey: "github.com/biran/orca",
        decisionId: "orca-dev-1/1",
        kind: "wrong",
        because: "那个前提当时就不成立",
        by: "amy",
      },
      () => new Date(GOLDEN_INSTANT),
    );
    expect(sanityRow.at).toBe(GOLDEN_INSTANT);

    await withCorrectionsDir(async (dir) => {
      // makeTargetRepo()'s default remote is https://github.com/biran/orca.git
      // (tests/corrections/harness.ts) -- the same repository
      // injectableClock.test.ts's recordArgs points `orca correct` at. The
      // panel's own --repo labelling (not a remote-derived projectKeyOf,
      // ruling J1) is set to the literal "github.com/biran/orca" so the
      // decision it discovers carries the exact projectKey GOLDEN_ID was
      // hashed against.
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const opts: PanelOptions = {
          ...parsePanelArgs(
            ["--by", "amy", "--repo", `github.com/biran/orca=${repo.path}`, "--dist", dist.dir],
            { ORCA_CORRECTIONS_DIR: dir },
          ),
          now: () => new Date(GOLDEN_INSTANT),
        };
        const started = await createPanelServer(opts);
        try {
          const res = await post(started, "/api/corrections", {
            projectKey: "github.com/biran/orca",
            decisionId: "orca-dev-1/1",
            kind: "wrong",
            because: "那个前提当时就不成立",
          });
          expect(res.status).toBe(200);
          const body = (await res.json()) as { correction: { id: string } };
          expect(body.correction.id).toBe(GOLDEN_ID);
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

/**
 * Final review I-2 / ruling R65: a client mistake is a 4xx by name, never
 * `500 panel-internal-error` with a TypeError or SyntaxError in it. Each `it`
 * owns its store, repo and server (ruling J7).
 */
describe("the panel's error mapping for client mistakes (final review I-2)", () => {
  const withPanel = async (fn: (started: StartedPanel, dir: string) => Promise<void>): Promise<void> => {
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
          await fn(started, dir);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  };

  const bothPosts = ["/api/reviews", "/api/corrections"] as const;
  const wellFormed = JSON.stringify(validBody());

  const expectBadRequest = async (res: { status: number; body: string }): Promise<void> => {
    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body) as { code: string; message: string };
    expect(parsed.code).toBe(PANEL_BAD_REQUEST);
    expect(parsed.message.length).toBeGreaterThan(0);
  };

  it("refuses a POST with no content-type as a bad request (Express leaves the body undefined)", async () => {
    await withPanel(async (started, dir) => {
      for (const path of bothPosts) await expectBadRequest(await rawPost(started, path, wellFormed, undefined));
      expect(await readCorrections(dir)).toHaveLength(0);
      expect(await readReviews(dir)).toHaveLength(0);
    });
  });

  it("refuses a malformed JSON body as a bad request (the body parser's own error)", async () => {
    await withPanel(async (started, dir) => {
      for (const path of bothPosts) {
        await expectBadRequest(await rawPost(started, path, "{not json", "application/json"));
      }
      expect(await readCorrections(dir)).toHaveLength(0);
      expect(await readReviews(dir)).toHaveLength(0);
    });
  });

  it("refuses a JSON body that is not an object (an array) as a bad request, before reading any field", async () => {
    await withPanel(async (started, dir) => {
      for (const path of bothPosts) {
        await expectBadRequest(await rawPost(started, path, `[${wellFormed}]`, "application/json"));
      }
      expect(await readCorrections(dir)).toHaveLength(0);
      expect(await readReviews(dir)).toHaveLength(0);
    });
  });

  // Final review Minor N-3. The body-parser arm named the cause in the message
  // and then flattened every one of the parser's 4xx statuses to 400, so a
  // client that sent too much, or an encoding nobody can read, was told it had
  // sent a malformed request. The parser already determined the status; the
  // two criteria below pin that it reaches the client.
  it("answers a body over the parser's 64kb limit with 413, not a flat 400", async () => {
    await withPanel(async (started, dir) => {
      // 70,000 bytes inside one JSON string: valid JSON, over the limit, so
      // the parser refuses on size and not on syntax.
      const tooLarge = JSON.stringify({ because: "x".repeat(70_000) });
      for (const path of bothPosts) {
        const res = await rawPost(started, path, tooLarge, "application/json");
        expect(res.status).toBe(413);
        const parsed = JSON.parse(res.body) as { code: string; message: string };
        expect(parsed.code).toBe(PANEL_BAD_REQUEST);
        expect(parsed.message.length).toBeGreaterThan(0);
      }
      expect(await readCorrections(dir)).toHaveLength(0);
      expect(await readReviews(dir)).toHaveLength(0);
    });
  });

  it("answers a content-encoding nothing can decode with 415, not a flat 400", async () => {
    await withPanel(async (started, dir) => {
      for (const path of bothPosts) {
        const res = await rawPost(started, path, wellFormed, "application/json", {
          "content-encoding": "x-nonesuch",
        });
        expect(res.status).toBe(415);
        const parsed = JSON.parse(res.body) as { code: string; message: string };
        expect(parsed.code).toBe(PANEL_BAD_REQUEST);
        expect(parsed.message.length).toBeGreaterThan(0);
      }
      expect(await readCorrections(dir)).toHaveLength(0);
      expect(await readReviews(dir)).toHaveLength(0);
    });
  });

  it("answers a busy corrections store with 409 by name, not 400 (a transient conflict, not a client error)", async () => {
    await withPanel(async (started, dir) => {
      const held = await acquireStoreLock(dir);
      try {
        const res = await post(started, "/api/corrections", validBody());
        expect(res.status).toBe(409);
        expect(((await res.json()) as { code: string }).code).toBe(CORRECTIONS_STORE_BUSY);
        expect(await readCorrections(dir)).toHaveLength(0);
      } finally {
        await held.release();
      }
      // Positive control: the SAME request with the lock released lands, so
      // the 409 above was the lock and not something else about the request.
      const again = await post(started, "/api/corrections", validBody());
      expect(again.status).toBe(200);
      expect(await readCorrections(dir)).toHaveLength(1);
    });
  });
});
