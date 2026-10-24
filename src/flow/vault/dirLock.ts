/**
 * Flow engine spec §5.4 (review finding I3): copy-back into a person's folder is serialised per folder, across runs. Two
 * runs on one folder (they share its vault) must never write it at the same time: each copy-back reads the folder's bytes
 * to decide add / modify / three-way merge / delete, and an interleaved write would make that read stale.
 *
 * In-process only: one panel drives every flow run (§8.2); the key is the folder's real path, NFC.
 */
const tails = new Map<string, Promise<void>>();
const holders = new Map<string, number>();

/** One lock event, for the criteria's ordered-event assertions (D8, D15). */
export interface DirLockEvent { readonly phase: "enter" | "exit"; readonly key: string; readonly held: number; readonly active: number }
/** Tests only: observes every enter and exit; unset in production, so recording costs nothing. */
export const dirLockProbe: { observe?: (event: DirLockEvent) => void } = {};

/** Tests only: how many callers hold `realDir` right now (0 when free). */
export const dirLockHeld = (realDir: string): number => holders.get(realDir.normalize("NFC")) ?? 0;

export async function withDirLock<T>(realDir: string, act: () => Promise<T>): Promise<T> {
  const key = realDir.normalize("NFC");
  const before = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = before.then(() => mine);
  tails.set(key, tail);
  await before;
  const held = (holders.get(key) ?? 0) + 1;
  holders.set(key, held);
  const active = [...holders.values()].reduce((a, b) => a + b, 0);
  dirLockProbe.observe?.({ phase: "enter", key, held, active });
  try { return await act(); }
  finally {
    const left = held - 1;
    if (left === 0) holders.delete(key); else holders.set(key, left);
    dirLockProbe.observe?.({ phase: "exit", key, held: left, active: [...holders.values()].reduce((a, b) => a + b, 0) });
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
