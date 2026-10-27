/** Panel UI redesign spec §5.1 (ruling U2). The active section lives in the URL hash, so a reload stays put. */
// Human request 2026-10-03 (session 9d95e6c8): ordered along the work -- an idea is clarified and split (requirements),
// its tasks run (tasks), their choices are reviewed (decisions); memory and metrics read across; chains, which develop
// Orca itself, come last. The first section is the default.
// Kanban spec 2026-10-20 §4: the board is its own tab, right after Task control (the list stays; decide later from usage).
import { DETAIL_REGIONS, type DetailRegion } from "./detailRegion.js";

// Ruling H6 (2026-10-27, session 7753e97d): the sidebar has three bands -- the work, the tools that read across it, and
// one Settings entry at the bottom; global and project settings are one Settings page with a category nav.
export const SECTIONS = ["overview", "requirements", "tasks", "board", "decisions", "memory", "metrics", "chains", "settings"] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = "overview";
/** H6(a): the sidebar's bands, in SECTIONS order; Settings stands alone at the bottom. */
export const NAV_BANDS: readonly (readonly Section[])[] = [["overview", "requirements", "tasks", "board", "decisions"], ["memory", "metrics", "chains"], ["settings"]];

/** H6(b): the Settings page's categories, in nav order; every one but `project` is a global (shared or browser) setting. */
export const SETTINGS_CATEGORIES = ["appearance", "account", "orchestration", "checks", "flows", "agents", "project"] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export const DEFAULT_SETTINGS_CATEGORY: SettingsCategory = "appearance";
/** H6(b): the two settings hashes from before the merge keep working; each opens the category that holds what it showed first. */
const LEGACY_SETTINGS: Readonly<Record<string, SettingsCategory>> = { "global-settings": "appearance", "project-settings": "project" };

/**
 * Tester round 2 spec §9.2 (ruling H11): the parsed URL hash. A section alone, or one owner inside it: a group (with its
 * detail region and open task), a requirement, a decision, the Corrections list, or a flow run.
 */
export type Route =
  | { kind: "section"; section: Section }
  | { kind: "group"; section: "tasks"; groupId: string; region: DetailRegion | null; taskId: string | null }
  | { kind: "requirement"; section: "requirements"; groupId: string }
  | { kind: "decision"; section: "decisions"; projectKey: string; decisionId: string }
  | { kind: "corrections"; section: "decisions" }
  | { kind: "flow-run"; section: "board"; flowRunId: string }
  | { kind: "settings"; section: "settings"; category: SettingsCategory };

const bare = (section: Section): Route => ({ kind: "section", section });

/** Each part of the hash, decoded; null when one is empty or does not decode (a malformed tail). */
function decodeParts(parts: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const part of parts) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { return null; }
    // Review minor 6: "." and ".." are path steps, never an id; a hash carrying one is malformed.
    if (decoded === "" || decoded === "." || decoded === "..") return null;
    out.push(decoded);
  }
  return out;
}

/** Never throws: an unknown section is Overview, a known section with a malformed tail is that section alone. */
export function parseRoute(hash: string): Route {
  const [head = "", ...rest] = hash.replace(/^#/, "").split("/");
  const legacy = Object.hasOwn(LEGACY_SETTINGS, head) ? LEGACY_SETTINGS[head] : undefined;
  if (legacy !== undefined) return { kind: "settings", section: "settings", category: legacy };
  if (!(SECTIONS as readonly string[]).includes(head)) return bare(DEFAULT_SECTION);
  const section = head as Section;
  if (rest.length === 0) return bare(section);
  const parts = decodeParts(rest);
  if (parts === null) return bare(section);
  if (section === "tasks" && parts.length <= 3) {
    const [groupId, region = null, taskId = null] = parts;
    if (region !== null && !(DETAIL_REGIONS as readonly string[]).includes(region)) return bare(section);
    return { kind: "group", section, groupId: groupId!, region: region as DetailRegion | null, taskId };
  }
  if (section === "requirements" && parts.length === 1) return { kind: "requirement", section, groupId: parts[0]! };
  if (section === "decisions" && parts.length === 1 && rest[0] === "corrections") return { kind: "corrections", section };
  if (section === "decisions" && parts.length === 2) return { kind: "decision", section, projectKey: parts[0]!, decisionId: parts[1]! };
  if (section === "board" && parts.length === 2 && rest[0] === "flow") return { kind: "flow-run", section, flowRunId: parts[1]! };
  if (section === "settings" && parts.length === 1 && (SETTINGS_CATEGORIES as readonly string[]).includes(rest[0]!)) {
    return { kind: "settings", section, category: rest[0] as SettingsCategory };
  }
  return bare(section);
}

export function formatRoute(route: Route): string {
  const e = encodeURIComponent;
  switch (route.kind) {
    case "section": return `#${route.section}`;
    case "group": {
      // A task needs a region before it in the grammar; with none, the task is not written.
      const tail = route.region === null ? [] : route.taskId === null ? [route.region] : [route.region, route.taskId];
      return ["#tasks", e(route.groupId), ...tail.map(e)].join("/");
    }
    case "requirement": return `#requirements/${e(route.groupId)}`;
    case "decision": return `#decisions/${e(route.projectKey)}/${e(route.decisionId)}`;
    case "corrections": return "#decisions/corrections";
    case "flow-run": return `#board/flow/${e(route.flowRunId)}`;
    case "settings": return `#settings/${route.category}`;
  }
}

export function sectionFromHash(hash: string): Section {
  return parseRoute(hash).section;
}

export const hashFor = (section: Section): string => `#${section}`;

/**
 * Review minor 5: the hashes the page itself assigned, oldest first. `rememberOwnHash` adds one; `consumeOwnHash` answers,
 * for a hashchange to `hash`, the list left after it when the hash is the page's own (that entry and every older one are
 * dropped: a browser may coalesce their events), or null when it is not (a person's own navigation).
 */
export const rememberOwnHash = (own: readonly string[], hash: string): string[] => [...own, hash];
export function consumeOwnHash(own: readonly string[], hash: string): string[] | null {
  const at = own.indexOf(hash);
  return at === -1 ? null : own.slice(at + 1);
}
