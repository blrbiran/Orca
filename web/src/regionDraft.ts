/**
 * Ruling R1 (#219) inside a group: only the selected detail region is rendered (GroupDetailRegions.tsx), so a region's
 * unsent input would be lost on a region switch. The group view (ControlGroupView.tsx) holds this store for as long as the
 * group is open; a region's form keeps its unsent input here, under a key that names the group and the field, and reads it
 * back when the region is shown again. Outside a group view (a form rendered alone) it is plain component state.
 */
import { createContext, useCallback, useContext, useState } from "react";

export const RegionDrafts = createContext<Map<string, unknown> | null>(null);

export function useRegionDraft<T>(key: string, initial: () => T): [T, (next: T | ((current: T) => T)) => void] {
  const store = useContext(RegionDrafts);
  const [value, setValue] = useState<T>(() => (store?.has(key) === true ? store.get(key) as T : initial()));
  const set = useCallback((next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      store?.set(key, resolved);
      return resolved;
    });
  }, [store, key]);
  return [value, set];
}
