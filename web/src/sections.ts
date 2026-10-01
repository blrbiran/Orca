/** Panel UI redesign spec §5.1 (ruling U2). The active section lives in the URL hash, so a reload stays put. */
export const SECTIONS = ["decisions", "chains", "tasks", "requirements", "metrics"] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = "decisions";

export function sectionFromHash(hash: string): Section {
  const name = hash.replace(/^#/, "");
  return (SECTIONS as readonly string[]).includes(name) ? (name as Section) : DEFAULT_SECTION;
}

export const hashFor = (section: Section): string => `#${section}`;
