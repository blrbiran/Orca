export const ADVANCED_KEY = "orca.showAdvanced";

export function readShowAdvanced(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try { return storage?.getItem(ADVANCED_KEY) === "true"; } catch { return false; }
}

export function writeShowAdvanced(storage: Pick<Storage, "setItem"> | undefined, value: boolean): void {
  try { storage?.setItem(ADVANCED_KEY, String(value)); } catch { /* This browser cannot remember preferences. */ }
}
