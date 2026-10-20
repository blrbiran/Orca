/** Panel UI redesign spec §5.1 (ruling U2). The active section lives in the URL hash, so a reload stays put. */
// Human request 2026-10-03 (session 9d95e6c8): ordered along the work -- an idea is clarified and split (requirements),
// its tasks run (tasks), their choices are reviewed (decisions); memory and metrics read across; chains, which develop
// Orca itself, come last. The first section is the default.
// Kanban spec 2026-10-20 §4: the board is its own tab, right after Task control (the list stays; decide later from usage).
export const SECTIONS = ["overview", "requirements", "tasks", "board", "decisions", "memory", "metrics", "chains", "global-settings", "project-settings"] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = "overview";

export function sectionFromHash(hash: string): Section {
  const name = hash.replace(/^#/, "");
  return (SECTIONS as readonly string[]).includes(name) ? (name as Section) : DEFAULT_SECTION;
}

export const hashFor = (section: Section): string => `#${section}`;
