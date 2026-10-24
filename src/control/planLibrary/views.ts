/**
 * Scheduled flows and groups spec 2026-10-24 §13.1, §13.3: the plan library's reads -- a project's entries, one entry
 * with every version's provenance (`by`, `via`, `origin`, time: what the owner sees before pinning a version), and which
 * schedules pin it. Pure reads of the store; the routes are controlApi.ts's.
 */
import { ControlError } from "../errors.js";
import type { ControlStore } from "../store.js";
import { listEntries, listVersions, pinningSchedules, readEntry, readVersion, type LibraryEntry, type LibraryVersion } from "./store.js";

const versionView = (v: LibraryVersion) => ({ version: v.version, sha256: v.sha256, by: v.by, via: v.via, at: v.at, origin: v.origin });

function entryView(store: ControlStore, entry: LibraryEntry) {
  const versions = listVersions(store, entry.id);
  return {
    entryId: entry.id, projectId: entry.projectId, name: entry.name, state: entry.state,
    createdBy: entry.body.createdBy, createdVia: entry.body.createdVia, createdAt: entry.body.createdAt,
    ...(entry.state === "archived" ? { archivedBy: entry.body.archivedBy ?? null, archivedVia: entry.body.archivedVia ?? null, archivedAt: entry.body.archivedAt ?? null } : {}),
    head: versions.length === 0 ? null : versionView(versions[versions.length - 1]!),
    versionCount: versions.length,
    usedBy: pinningSchedules(store, entry.id),
  };
}

/** GET /api/control/plan-library?repoId=<id>[&archived=1]: the project's entries, oldest first. */
export function planLibraryListView(store: ControlStore, repoId: string, includeArchived: boolean) {
  return { schema: "orca-plan-library-v1" as const, repoId, entries: listEntries(store, repoId, includeArchived).map((entry) => entryView(store, entry)) };
}

/** GET /api/control/plan-library/:entryId: the entry and every version's provenance, oldest first. */
export function planLibraryEntryView(store: ControlStore, entryId: string) {
  const entry = readEntry(store, entryId);
  if (entry === null) throw new ControlError("plan-library-entry-not-found", entryId);
  return { schema: "orca-plan-library-entry-v1" as const, ...entryView(store, entry), versions: listVersions(store, entryId).map(versionView) };
}

/** GET /api/control/plan-library/:entryId/versions/:sha256: the version's canonical `orca-plan-v1` bytes, re-hashed. */
export function planLibraryVersionBytes(store: ControlStore, entryId: string, sha256: string): { bytes: string; fileName: string } {
  const version = readVersion(store, entryId, sha256);
  if (version === null) throw new ControlError("plan-library-entry-not-found", `${entryId}@${sha256}`);
  return { bytes: version.doc, fileName: `${entryId}-v${version.version}-${sha256.slice(0, 12)}.orca-plan.json` };
}
