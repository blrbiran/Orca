/**
 * Panel UI redesign spec §5.1 (ruling U2). Pure: App hands it everything. Every pane stays
 * mounted -- App-level criteria find Task control's buttons by role from the default
 * section, and `getByRole` skips anything `hidden` -- so only styles.css hides a pane.
 * Progress spec §4: browser preference controls live in GlobalSettings.
 */
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NAV_BANDS, hashFor } from "./sections.js";
import { ShortcutsHelp } from "./ShortcutsHelp.js";
import type { Section } from "./sections.js";

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

function Badge({ section, badges }: { section: Section; badges: ShellBadges }): JSX.Element | null {
  const { t } = useTranslation();
  if (section === "decisions") return <span className="nav-count" data-testid="nav-count-decisions" title={badges.unreviewed === null ? t("overview.status.unavailable") : undefined}>{badges.unreviewed ?? "—"}</span>;
  if (section === "chains" && badges.chainRunning) return <span className="dot dot-ok" data-testid="nav-dot-chains" title={t("shell.chainRunning")} />;
  if (section === "tasks" && badges.controlAlert) return <span className="dot dot-danger" data-testid="nav-dot-tasks" title={t("shell.needsAttention")} />;
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
  return (
    <div className="shell">
      <button type="button" className="skip-link" onClick={() => document.getElementById("main-content")?.focus()}>{t("shell.skipToContent")}</button>
      <nav className="sidebar" aria-label={t("nav.sections")}>
        <div className="brand" title={t("shell.brandTitle")}><span className="brand-dot" />Orca</div>
        {props.projectControl}
        {/* Ruling H6(a): one list in three bands; a band's first item draws the rule above it, Settings sits at the bottom. */}
        <ul className="nav">
          {NAV_BANDS.flatMap((band, at) => band
            .filter((section) => section !== "chains" || props.showAdvanced === true || props.badges.chainRunning || props.active === "chains")
            .map((section, index) => (
              <li key={section} data-band={at} className={index === 0 && at > 0 ? "nav-band-start" : undefined}>
                <a className="nav-item" href={hashFor(section)} aria-current={section === props.active ? "page" : undefined}>
                  <span>{t(NAV_KEY[section])}</span>
                  <Badge section={section} badges={props.badges} />
                </a>
              </li>
            )))}
        </ul>
        <div className="sidebar-foot">
          {props.footer.map((line) => <p key={line}>{line}</p>)}
          <ShortcutsHelp />
        </div>
      </nav>
      <main className="content" id="main-content" tabIndex={-1}>
        <div className="chain-banners">{props.banners}</div>
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
