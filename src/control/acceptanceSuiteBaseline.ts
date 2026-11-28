import type { ControlStore } from "./store.js";

export interface SuiteCountBaselineKey {
  repoId: string;
  base: string;
  command: string;
  setupDigest: string;
  reporter: "node-test-tap-v1";
}

export interface SuiteCountBaseline {
  state: "counted" | "unavailable";
  tests: number | null;
  exit: string;
  source: "base-suite" | "failure-baseline";
  observedAt: number;
}

export type SuiteCountBaselineObservation = SuiteCountBaselineKey & SuiteCountBaseline;

function exactKeyQuery(): string {
  return `SELECT state, tests, exit, source, observed_at FROM acceptance_suite_baselines
    WHERE repo_id=? AND base=? AND command=? AND setup_digest=? AND reporter=?`;
}

function exactKeyValues(key: SuiteCountBaselineKey): [string, string, string, string, string] {
  return [key.repoId, key.base, key.command, key.setupDigest, key.reporter];
}

function baselineOf(row: Record<string, unknown>): SuiteCountBaseline {
  return {
    state: String(row.state) as SuiteCountBaseline["state"],
    tests: row.tests === null ? null : Number(row.tests),
    exit: String(row.exit),
    source: String(row.source) as SuiteCountBaseline["source"],
    observedAt: Number(row.observed_at),
  };
}

function legacyBaseline(store: ControlStore, key: SuiteCountBaselineKey): SuiteCountBaseline | null {
  const rows = store.db.prepare(`SELECT tests, exit, last_seen_at FROM acceptance_failure_baselines
    WHERE repo_id=? AND base=? AND command=? AND setup_digest=? AND reporter=?`).all(...exactKeyValues(key));
  if (rows.length === 0 || rows.some((row) => row.tests === null || row.exit === null || !Number.isSafeInteger(Number(row.tests)) || Number(row.tests) < 0)) return null;
  const tests = new Set(rows.map((row) => Number(row.tests)));
  const exits = new Set(rows.map((row) => String(row.exit)));
  if (tests.size !== 1 || exits.size !== 1) return null;
  return {
    state: "counted",
    tests: [...tests][0]!,
    exit: [...exits][0]!,
    source: "failure-baseline",
    observedAt: Math.max(...rows.map((row) => Number(row.last_seen_at))),
  };
}

export function readSuiteCountBaseline(store: ControlStore, key: SuiteCountBaselineKey): SuiteCountBaseline | null {
  const row = store.db.prepare(exactKeyQuery()).get(...exactKeyValues(key));
  return row === undefined ? legacyBaseline(store, key) : baselineOf(row);
}

export function recordSuiteCountBaseline(store: ControlStore, observation: SuiteCountBaselineObservation): void {
  if ((observation.state === "counted" && (!Number.isSafeInteger(observation.tests) || observation.tests! < 0))
    || (observation.state === "unavailable" && observation.tests !== null)
    || !Number.isSafeInteger(observation.observedAt)) {
    throw new Error("acceptance-suite-baseline-invalid");
  }

  const existing = store.db.prepare(exactKeyQuery()).get(...exactKeyValues(observation));
  const value: SuiteCountBaseline = {
    state: observation.state,
    tests: observation.tests,
    exit: observation.exit,
    source: observation.source,
    observedAt: observation.observedAt,
  };
  if (existing !== undefined) {
    const current = baselineOf(existing);
    if (JSON.stringify(current) !== JSON.stringify(value)) throw new Error("acceptance-suite-baseline-conflict");
    return;
  }

  store.db.prepare(`INSERT INTO acceptance_suite_baselines
    (repo_id,base,command,setup_digest,reporter,state,tests,exit,source,observed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      ...exactKeyValues(observation), observation.state, observation.tests, observation.exit, observation.source, observation.observedAt,
    );
}

const inFlight = new WeakMap<ControlStore, Map<string, Promise<SuiteCountBaseline | null>>>();

/** Share the first exact-key base run in this store; only completed observations enter the durable table. */
export async function loadSuiteCountBaselineOnce(
  store: ControlStore,
  key: SuiteCountBaselineKey,
  load: () => Promise<SuiteCountBaseline | null>,
): Promise<{ baseline: SuiteCountBaseline | null; loaded: boolean }> {
  const cached = readSuiteCountBaseline(store, key);
  if (cached !== null) return { baseline: cached, loaded: false };

  const map = inFlight.get(store) ?? new Map<string, Promise<SuiteCountBaseline | null>>();
  inFlight.set(store, map);
  const id = JSON.stringify(exactKeyValues(key));
  const pending = map.get(id);
  if (pending !== undefined) return { baseline: await pending, loaded: false };

  const running = (async () => {
    const observation = await load();
    if (observation !== null) recordSuiteCountBaseline(store, { ...key, ...observation });
    return observation;
  })();
  map.set(id, running);
  try { return { baseline: await running, loaded: true }; }
  finally { if (map.get(id) === running) map.delete(id); }
}
