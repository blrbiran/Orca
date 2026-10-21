// CLI v2 controller follow-ups to Tasks 9-11 (session b37f7ce9, ledgered), each through the real panel:
// (a) the old Web route POST /api/corrections/withdraw applies the verb's withdraw rule -- the requester's `by` (the
//     logged-in account) equals the row's recorded `by`, or the requester is the panel owner (its --by);
// (b) one command id reused for a different verb under @corrections answers the named conflict (409
//     command-id-conflict, web recoverable control spec §6 "same ID and different canonical raw request"), not a 500;
// (c) a withdrawal row records `via` (an optional field appended last), and an earlier row without it still reads.
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import { correctionsFile, withdrawalsFile } from "../../src/corrections/paths.js";
import { readCorrections } from "../../src/corrections/store.js";
import { readWithdrawals } from "../../src/corrections/withdrawals.js";
import { readWithdrawalsLeniently } from "../../src/metrics/lenientRead.js";
import { controlRepoKey, controlRoot } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { ORIGINAL, makeTargetRepo } from "../corrections/harness.js";
import { login, seedUser, sessionFor, type Session } from "../panel/fixtures/auth.js";
import { overSocket } from "../panel/fixtures/socketPanel.js";

const PANEL_KEY = "mykey";
const REPO_ID = controlRepoKey(PANEL_KEY);
const NOW = new Date("2026-10-22T00:00:00.000Z");
const RECORD = { repoId: REPO_ID, decisionId: ORIGINAL.id, kind: "wrong", because: "the premise was false" } as const;

async function withPanel(fn: (t: { panel: StartedPanel; env: NodeJS.ProcessEnv; corrections: string }) => Promise<void>): Promise<void> {
  // A short root: the control socket's path must fit (control-socket-path-too-long otherwise).
  const root = await realpath(await mkdtemp(join(tmpdir(), "wf-")));
  const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
  try {
    const corrections = join(root, "corrections");
    await mkdir(corrections, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
    const panel = await createPanelServer({ ...parsePanelArgs(["--by", "panel-owner", "--repo", `${PANEL_KEY}=${repo.path}`, "--control-state-dir", join(root, "s")], env), now: () => NOW }, env);
    try { await fn({ panel, env, corrections }); } finally { await panel.close(); }
  } finally { await repo.cleanup(); await rm(root, { recursive: true, force: true }); }
}

const post = (s: Session, path: string, body: unknown) =>
  s.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const command = (s: Session, path: string, commandId: string, payload: unknown) => post(s, path, { commandId, expectedRevision: 0, payload });
/** The old routes answer `{code}`, the control routes `{error: {code}}`. */
const code = async (r: Response): Promise<[number, string]> => {
  if (r.status === 200) return [200, "ok"];
  const body = (await r.json()) as { code?: string; error?: { code: string } };
  return [r.status, body.error?.code ?? body.code ?? "(none)"];
};

describe("CLI v2 follow-ups to the correction verbs (controller, session b37f7ce9)", { timeout: 60_000 }, () => {
  it("(a) the old withdraw route lets the row's author and the panel owner withdraw, and refuses another account", async () => {
    await withPanel(async ({ panel, env, corrections }) => {
      // "tester" is a Web owner whose account name is not the panel's --by; "bob" is another owner account.
      const tester = await sessionFor(panel, env);
      seedUser(controlRoot(env), "bob", "owner");
      seedUser(controlRoot(env), "panel-owner", "owner");
      const [bob, owner] = [await login(panel.url, "bob"), await login(panel.url, "panel-owner")];
      expect((await command(tester, "/api/control/corrections", "rec-1", RECORD)).status).toBe(200);
      expect((await command(tester, "/api/control/corrections", "rec-2", { ...RECORD, because: "the premise was still false", again: true })).status).toBe(200);
      const [first, second] = await readCorrections(corrections);
      expect([first!.by, second!.by]).toEqual(["tester", "tester"]);
      expect({
        otherAccount: await code(await post(bob, "/api/corrections/withdraw", { correctionId: first!.id })),
        author: await code(await post(tester, "/api/corrections/withdraw", { correctionId: first!.id })),
        panelOwner: await code(await post(owner, "/api/corrections/withdraw", { correctionId: second!.id })),
      }).toEqual({ otherAccount: [409, "correction-not-yours"], author: [200, "ok"], panelOwner: [200, "ok"] });
      // Each withdrawal names who asked, not the panel's --by.
      expect((await readWithdrawals(corrections)).map((row) => [row.correctionId, row.by])).toEqual([[first!.id, "tester"], [second!.id, "panel-owner"]]);
    });
  });

  it("(b) one command id reused for another verb under @corrections answers 409 command-id-conflict and books nothing more", async () => {
    await withPanel(async ({ panel, env, corrections }) => {
      const tester = await sessionFor(panel, env);
      expect((await command(tester, "/api/control/corrections", "reuse-1", RECORD)).status).toBe(200);
      const [row] = await readCorrections(corrections);
      const reused = await command(tester, `/api/control/corrections/${row!.id}/withdraw`, "reuse-1", { correctionId: row!.id });
      expect(await code(reused)).toEqual([409, "command-id-conflict"]);
      // Over the socket too (a CLI agent's channel), and the same id for the same request still replays its answer.
      const socket = await overSocket(panel.socketPath!, "POST", `/api/control/corrections/${row!.id}/withdraw`, { "x-orca-client": "cli:test" }, { commandId: "reuse-1", expectedRevision: 0, payload: { correctionId: row!.id } });
      expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([409, "command-id-conflict"]);
      expect((await command(tester, "/api/control/corrections", "reuse-1", RECORD)).status).toBe(200);
      expect(await readWithdrawals(corrections)).toEqual([]);
    });
  });

  it("(c) a withdrawal row records via -- web for both Web routes, cli:<client> over the socket", async () => {
    await withPanel(async ({ panel, env, corrections }) => {
      const tester = await sessionFor(panel, env);
      for (const [id, because] of [["v-1", "one"], ["v-2", "two"], ["v-3", "three"]] as const) {
        expect((await command(tester, "/api/control/corrections", id, { ...RECORD, because, again: true })).status).toBe(200);
      }
      const [a, b, c] = await readCorrections(corrections);
      expect((await command(tester, `/api/control/corrections/${a!.id}/withdraw`, "w-1", { correctionId: a!.id })).status).toBe(200);
      expect((await post(tester, "/api/corrections/withdraw", { correctionId: b!.id })).status).toBe(200);
      // The socket is the panel owner's; it may withdraw tester's row (the owner may withdraw any).
      const socket = await overSocket(panel.socketPath!, "POST", `/api/control/corrections/${c!.id}/withdraw`, { "x-orca-client": "cli:test" }, { commandId: "w-3", expectedRevision: 0, payload: { correctionId: c!.id } });
      expect(socket.status).toBe(200);
      expect((await readWithdrawals(corrections)).map((row) => [row.correctionId, row.by, row.via])).toEqual([
        [a!.id, "tester", "web"], [b!.id, "tester", "web"], [c!.id, "panel-owner", "cli:test"],
      ]);
    });
  });

  it("(c) `via` is appended, optional: an earlier row without it still reads strictly and leniently, and correction ids stay put", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "wf-old-")));
    try {
      // A correction row and a withdrawal row as builds before this one wrote them (no `via` anywhere). The correction's
      // id is pinned as stored: the id is derived from the row, and a withdrawal never touches corrections.jsonl.
      const base = { projectKey: "github.com/o/r", decisionId: "orca-dev-1/1", kind: "wrong", because: "b", at: "2026-10-18T00:00:00.000Z", by: "amy" };
      // Measured from the unchanged code (deriveCorrectionId of `base`, before this commit).
      const STORED_ID = "c_0aa5d4b82ef9a62c";
      const correctionLine = `${JSON.stringify({ id: STORED_ID, ...base })}\n`;
      const oldWithdrawal = `${JSON.stringify({ correctionId: STORED_ID, projectKey: base.projectKey, by: "amy", at: "2026-10-18T01:00:00.000Z" })}\n`;
      await writeFile(correctionsFile(dir), correctionLine, { mode: 0o600 });
      await writeFile(withdrawalsFile(dir), oldWithdrawal, { mode: 0o600 });
      expect(await readWithdrawals(dir)).toEqual([JSON.parse(oldWithdrawal)]);
      const lenient = await readWithdrawalsLeniently(withdrawalsFile(dir));
      expect([lenient.rows.map((row) => row.correctionId), lenient.malformed]).toEqual([[STORED_ID], []]);
      const [stored] = await readCorrections(dir);
      expect([stored!.id, deriveCorrectionId(stored!)]).toEqual([STORED_ID, STORED_ID]);
      expect(await readFile(correctionsFile(dir), "utf8")).toBe(correctionLine);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
