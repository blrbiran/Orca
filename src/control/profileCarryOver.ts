/**
 * #381 (session 3ba26002, human ruling 6, approved as an alias: 「同意」): groups, runs and estimate requests bound before
 * the binding hash (profiles.ts profileBindingHash) froze the whole-snapshot hash, often inside bodies whose own hash is
 * recorded (an estimate request -> requestHash, its contract -> contractHash, a confirmed group's execution snapshot ->
 * snapshotHash). Rewriting those would break their hash chains, so nothing is rewritten: at panel start each loaded
 * profile's legacy hash is recorded in `meta` as an alias of its binding hash, and resolution accepts either
 * (profiles.ts sameProfileHash). The same pass notes, once, a profile whose secret values changed since the last start
 * (ruling 4: they are out of the binding hash, so nothing else would say so).
 *
 * Writes (Rule 17, registered in the 2026-09-19 spec's #381 Correction): rows `profileHashAlias:<legacy hash>` and
 * `profileSecretsSeen:<profileId>` in the control database's `meta` table -- no schema change -- each preceded by one
 * consistent copy `control.sqlite.bak.<epoch ms>` (0600) beside the database. Idempotent: a start that has nothing new to
 * record writes nothing and copies nothing.
 */
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalBytes } from "./canonicalJson.js";
import { legacyProfileHash, type FrozenProfile, type ProfileHashAliases } from "./profiles.js";
import type { ControlStore } from "./store.js";

const ALIAS = "profileHashAlias:";
const SECRETS = "profileSecretsSeen:";

export interface ProfileCarryOver {
  /** Every alias recorded on this store (this start's and earlier ones'), for the router. */
  aliases: ProfileHashAliases;
  /** The copy taken before this start's writes; null when nothing was written. */
  backup: string | null;
  /** One line per profile whose secret values changed since the last start that recorded them. */
  notes: string[];
}

type SecretEntry = { name: string; valueHash: string };

function changedNames(before: SecretEntry[], after: SecretEntry[]): string[] {
  const old = new Map(before.map((entry) => [entry.name, entry.valueHash]));
  const now = new Map(after.map((entry) => [entry.name, entry.valueHash]));
  return [...new Set([...old.keys(), ...now.keys()])].filter((name) => old.get(name) !== now.get(name)).sort();
}

/** A consistent copy beside the database, under a name never reused (a numeric suffix finds a free one). */
function backupControlDb(store: ControlStore, at: number): string {
  const base = join(store.stateDir, `control.sqlite.bak.${at}`);
  let path = base;
  for (let n = 1; existsSync(path); n++) path = `${base}-${n}`;
  store.db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  chmodSync(path, 0o600);
  return path;
}

export function carryProfileBindings(store: ControlStore, profiles: readonly FrozenProfile[], now: () => number = store.now): ProfileCarryOver {
  const read = (key: string): string | undefined => {
    const row = store.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row === undefined ? undefined : String(row.value);
  };
  const writes: Array<[string, string]> = [];
  const notes: string[] = [];
  for (const profile of profiles) {
    const legacy = ALIAS + legacyProfileHash(profile.snapshot);
    // A legacy hash is a function of the whole file, the binding hash of a part of it: one legacy hash has one binding.
    if (read(legacy) === undefined) writes.push([legacy, profile.profileHash]);
    const id = profile.snapshot.profile.profileId;
    const secrets = profile.snapshot.resolved.secretValueHashes;
    const recorded = canonicalBytes(secrets).toString("utf8");
    const seen = read(SECRETS + id);
    if (seen === recorded) continue;
    if (seen !== undefined) {
      notes.push(`orca-control: profile ${id}: secret values changed since the last start: ${changedNames(JSON.parse(seen) as SecretEntry[], secrets).join(", ")}`);
    }
    writes.push([SECRETS + id, recorded]);
  }
  let backup: string | null = null;
  if (writes.length > 0) {
    backup = backupControlDb(store, now());
    store.transaction(() => {
      for (const [key, value] of writes) store.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)").run(key, value);
    });
  }
  const aliases = new Map<string, string>();
  for (const row of store.db.prepare("SELECT key, value FROM meta WHERE key LIKE ?").all(`${ALIAS}%`)) {
    aliases.set(String(row.key).slice(ALIAS.length), String(row.value));
  }
  return { aliases, backup, notes };
}
