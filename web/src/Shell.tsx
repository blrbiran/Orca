/**
 * Panel UI redesign spec §5.1 (ruling U2). Pure: App hands it everything. Every pane stays
 * mounted -- App-level criteria find Task control's buttons by role from the default
 * section, and `getByRole` skips anything `hidden` -- so only styles.css hides a pane.
 * Progress spec §4: browser preference controls live in GlobalSettings.
 */
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NAV_BANDS, hashFor } from "./sections.js";
import type { Section } from "./sections.js";
import { moreBand, moreEntry, moreToggle, navItem, navList, settingsBand, shellBox, sidebarBox, statusDot } from "./ui/classes.js";

export const NAV_KEY = { overview: "nav.overview", decisions: "nav.decisions", chains: "nav.chains", tasks: "nav.tasks", board: "nav.board", requirements: "nav.requirements", memory: "nav.memory", metrics: "nav.metrics", settings: "nav.settings" } as const satisfies Record<Section, string>;

/**
 * The four conditions that light the red nav dot. "No execution port" is a note, and "projection refetch
 * required" is an info-toned re-read that clears itself, so neither is an alert here.
 */
export interface ControlAlertInput {
  resetRequired: boolean;
  dispatchBlocked: boolean;
  blockers: number;
  refusal: boolean;
}

export function controlAlert(input: ControlAlertInput | null): boolean {
  if (input === null) return false;
  return (
    input.resetRequired ||
    input.dispatchBlocked ||
    input.blockers > 0 ||
    input.refusal
  );
}

export interface ShellBadges {
  unreviewed: number | null;
  chainRunning: boolean;
  controlAlert: boolean;
}

/** Ruling H6(a): the sidebar's bands. Tester #79: band 1 (the tools that read across the work) is folded under "More". */
const MORE_BAND = 1;

function Badge({ section, badges }: { section: Section; badges: ShellBadges }): JSX.Element | null {
  const { t } = useTranslation();
  if (section === "decisions") return <span className="nav-count" data-testid="nav-count-decisions" title={badges.unreviewed === null ? t("overview.status.unavailable") : undefined}>{badges.unreviewed ?? "—"}</span>;
  if (section === "chains" && badges.chainRunning) return <span className={`${statusDot} bg-ok shadow-glow-ok`} data-testid="nav-dot-chains" title={t("shell.chainRunning")} />;
  if (section === "tasks" && badges.controlAlert) return <span className={`${statusDot} bg-danger shadow-glow-danger`} data-testid="nav-dot-tasks" title={t("shell.needsAttention")} />;
  return null;
}

export function Shell(props: {
  active: Section;
  badges: ShellBadges;
  footer: readonly string[];
  /** Project registry spec §7 (§12 C5): the project control, at the top of the sidebar. */
  projectControl?: ReactNode;
  banners?: ReactNode;
  showAdvanced?: boolean;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const shown = (section: Section): boolean => section !== "chains" || props.showAdvanced === true || props.badges.chainRunning || props.active === "chains";
  const item = (section: Section, at: number, className: string | undefined): JSX.Element => (
    // Folded under "More": every entry stays mounted (a link by its #hash), only the closed group hides the ones that are not the open page.
    <li key={section} data-band={at} className={className}>
      <a className={navItem} href={hashFor(section)} aria-current={section === props.active ? "page" : undefined}>
        <span>{t(NAV_KEY[section])}</span>
        <Badge section={section} badges={props.badges} />
      </a>
    </li>
  );
  return (
    <div className={shellBox}>
      <button type="button" className="skip-link absolute -left-[9999px] top-2 z-[100] focus:left-2" onClick={() => document.getElementById("main-content")?.focus()}>{t("shell.skipToContent")}</button>
      <nav className={sidebarBox} aria-label={t("nav.sections")}>
        <div className="brand flex items-center gap-2 px-2 text-lg font-bold text-fg-strong" title={t("shell.brandTitle")}><span className="brand-dot h-[10px] w-[10px] rounded-full bg-accent" />Orca</div>
        {props.projectControl}
        {/* Ruling H6(a): one list in three bands; a band's first item draws the rule above it, Settings sits at the bottom. */}
        <ul className={navList}>
          {NAV_BANDS.flatMap((band, at) => {
            const entries = band.filter(shown);
            if (at !== MORE_BAND) {
              return entries.map((section, index) => item(section, at, index === 0 && at > 0 ? settingsBand : undefined));
            }
            if (entries.length === 0) return [];
            // Tester #79: Chains, Memory and Metrics sit under one "More" group. The open page's entry stays visible when the group is
            // closed (the page stays indicated), and the chain's running dot rides on the toggle so a closed group does not hide it.
            const hiddenEntries = moreOpen ? [] : entries.filter((section) => section !== props.active);
            return [
              <li key="more" data-band={at} className={moreBand}>
                <button type="button" className={moreToggle} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
                  <span>{t("nav.more")}</span>
                  <span className="flex items-center gap-2">
                    {props.badges.chainRunning && hiddenEntries.includes("chains") && <span className={`${statusDot} bg-ok shadow-glow-ok`} data-testid="nav-dot-more" title={t("shell.chainRunning")} />}
                    <span aria-hidden="true" className="text-muted">{moreOpen ? "▴" : "▾"}</span>
                  </span>
                </button>
              </li>,
              ...entries.map((section) => item(section, at, moreEntry(hiddenEntries.includes(section)))),
            ];
          })}
        </ul>
        <div className="sidebar-foot mt-auto px-2 text-xs text-muted wrap-anywhere max-md:mt-0 max-md:w-full narrow:hidden">
          {props.footer.map((line) => <p key={line}>{line}</p>)}
        </div>
      </nav>
      <main className="content min-h-0 min-w-0 overflow-y-auto p-6 max-md:p-4 narrow:overflow-visible" id="main-content" tabIndex={-1}>
        <div className="chain-banners mb-4 flex flex-col gap-2 empty:hidden">{props.banners}</div>
        {props.children}
      </main>
    </div>
  );
}

export function SectionPane(props: { section: Section; active: Section; children: ReactNode }): JSX.Element {
  return (
    <div className="section-pane" data-section={props.section} data-active={props.section === props.active ? "true" : "false"}>
      {props.children}
    </div>
  );
}
