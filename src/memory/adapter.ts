/**
 * Memory tab spec §2. Types only, plus the one error class: this file imports no implementation, so a second memory
 * store implements MemoryAdapter without touching anything ccmem-specific. Read-only by construction (G9): there is
 * no write method, and `recordCorrection` is the literal `false` until a write spec changes the type.
 */

/** The repository a request is about. `repoPath` is only ever a path the panel already discovered. */
export interface MemoryScope {
  readonly projectKey: string; // the panel's key for the repo (--repo key=path, or --root discovery)
  readonly repoPath: string;
}

export interface MemoryCapabilities {
  readonly search: true;
  readonly get: true;
  /** G9: v1 is read-only. Typed as the literal `false` so no adapter can claim it until the write spec lands. */
  readonly recordCorrection: false;
}

export type MemoryErrorCode =
  | "ccmem-missing"
  | `ccmem-failed:${string}`   // exit code, or signal name
  | "ccmem-timeout"
  | "ccmem-output-too-large"
  | "ccmem-output-invalid";
// CORRECTION (memory tab spec §11, 2026-10-03): `ccmem-failed:` also carries the errno name of a spawn that failed to
// start (ENOTDIR, ENOEXEC...), not only an exit code or a signal name. The comment above is kept as published.

export type MemoryHealth =
  | { readonly status: "ok" }
  | { readonly status: "unavailable"; readonly code: MemoryErrorCode; readonly message: string };

/** Adapter-neutral. `kind`/`source` are strings here; each adapter validates its own closed sets at its boundary. */
export interface MemoryRecord {
  readonly ref: string;                   // opaque, adapter-scoped; ccmem: the decimal row id
  readonly scope: "global" | "project";
  readonly projectKey: string | null;     // as the store recorded it (ccmem's key, not the panel's)
  readonly kind: string;                  // ccmem: type
  readonly content: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly source: string;
  readonly trust: number | null;
  readonly createdAt: string;             // ISO 8601
  readonly updatedAt: string;
}

export interface MemorySearchOptions {
  readonly query: string;  // "" means list everything in scope
  readonly limit: number;  // 1..200
}

export interface MemoryPage {
  readonly records: readonly MemoryRecord[];
  readonly total: number;      // matches before `limit`
  readonly truncated: boolean; // total > records.length
}

export interface MemoryAdapter {
  readonly id: string; // "ccmem"
  capabilities(): MemoryCapabilities;
  /** Static checks only. Must NOT start the store (for ccmem: must not spawn it -- spawning opens the DB, §4). */
  health(): Promise<MemoryHealth>;
  search(scope: MemoryScope, options: MemorySearchOptions): Promise<MemoryPage>;
  /** null when the ref is not visible in this scope (not "does not exist anywhere"). */
  get(scope: MemoryScope, ref: string): Promise<MemoryRecord | null>;
}

export class MemoryError extends Error {
  constructor(readonly code: MemoryErrorCode, message: string) { super(message); }
}
