import type { ControlStore } from "../../../src/control/store.js";

export type ReadCounters = {
  prepares: readonly { sql: string }[];
  executions: readonly { sql: string; method: "get" | "all" | "run"; rows: number }[];
  parses: ReadonlyMap<string, number>;
  /** Separate M6 group classification; M5 parses retains its original work/run meaning. */
  groupParses: ReadonlyMap<string, number>;
};

/** Install before the first measured view so its cached statements are wrapped too.
 * Identical fixture bytes share a bucket, preventing aliasing from multiplying total JSON parse counts.
 * Row-specific bounds use fixtures with unique bytes; methods preserve the projection store identity. */
export function installControlReadCounters(store: ControlStore) {
  const db = store.db;
  const prepare = db.prepare;
  const parse = JSON.parse;
  let prepares: { sql: string }[] = [];
  let executions: { sql: string; method: "get" | "all" | "run"; rows: number }[] = [];
  let parses = new Map<string, number>();
  let bodies = new Map<string, string>();
  let groupBodies = new Map<string, string>();
  let groupParses = new Map<string, number>();
  const restores: (() => void)[] = [];
  const collectBodies = () => {
    bodies = new Map();
    groupBodies = new Map();
    for (const row of prepare.call(db, "SELECT id,body FROM groups").all()) {
      const body = String(row.body), key = `groups:${row.id}`, prior = groupBodies.get(body);
      groupBodies.set(body, prior === undefined ? key : `${prior}|${key}`);
    }
    for (const table of ["work_items", "runs"] as const) {
      for (const row of prepare.call(db, `SELECT id,group_id,body FROM ${table}`).all()) {
        const body = String(row.body), key = `${table}:${row.group_id}:${row.id}`;
        const prior = bodies.get(body);
        bodies.set(body, prior === undefined ? key : `${prior}|${key}`);
      }
    }
  };
  db.prepare = function(sql: string) {
    prepares.push({ sql });
    const statement = prepare.call(db, sql);
    for (const method of ["get", "all", "run"] as const) {
      const original = statement[method];
      Object.defineProperty(statement, method, { configurable: true, value: (...args: any[]) => {
        const result = (original as Function).apply(statement, args);
        executions.push({ sql, method, rows: method === "all" ? result.length : method === "get" ? Number(result !== undefined) : Number(result.changes) });
        return result;
      } });
      // Large real-path benchmarks prepare many ephemeral canonical/proposal statements.
      // Keep cached live statements observable without retaining every transient native statement.
      const reference = new WeakRef(statement);
      restores.push(() => { const live = reference.deref(); if (live) Object.defineProperty(live, method, { configurable: true, value: original }); });
    }
    return statement;
  };
  JSON.parse = function(text: string, reviver?: any) {
    const key = bodies.get(text);
    if (key !== undefined) parses.set(key, (parses.get(key) ?? 0) + 1);
    const groupKey = groupBodies.get(text);
    if (groupKey !== undefined) groupParses.set(groupKey, (groupParses.get(groupKey) ?? 0) + 1);
    return parse(text, reviver);
  };
  collectBodies();
  return {
    store,
    reset() { collectBodies(); prepares = []; executions = []; parses = new Map(); groupParses = new Map(); },
    snapshot(): ReadCounters { return { prepares: [...prepares], executions: [...executions], parses: new Map(parses), groupParses: new Map(groupParses) }; },
    restore() { db.prepare = prepare; JSON.parse = parse; for (const restore of restores) restore(); },
  };
}
