/**
 * Flow engine spec §5.4 (review finding I3): copy-back into a person's folder is serialised per folder, across runs. Two
 * runs on one folder (they share its vault) must never write it at the same time: each copy-back reads the folder's bytes
 * to decide add / modify / three-way merge / delete, and an interleaved write would make that read stale.
 *
 * In-process only: one panel drives every flow run (§8.2); the key is the folder's real path, NFC.
 */
const tails = new Map<string, Promise<void>>();

export async function withDirLock<T>(realDir: string, act: () => Promise<T>): Promise<T> {
  const key = realDir.normalize("NFC");
  const before = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = before.then(() => mine);
  tails.set(key, tail);
  await before;
  try { return await act(); }
  finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
