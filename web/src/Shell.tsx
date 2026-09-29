/**
 * Panel UI redesign spec §5.1 (ruling U2). Pure: App hands it everything. Every pane stays
 * mounted -- App-level criteria find Task control's buttons by role from the default
 * section, and `getByRole` skips anything `hidden` -- so only styles.css hides a pane.
 */
import type { JSX, ReactNode } from "react";
import { SECTIONS, hashFor } from "./sections.js";
import type { Section } from "./sections.js";
import { THEME_PREFS } from "./theme.js";
import type { ThemePref } from "./theme.js";

const LABELS: Record<Section, string> = { decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" };

/** The six conditions under which ControlPanel renders a role="alert" line. */
export interface ControlAlertInput {
  executionPort: string;
  resetRequired: boolean;
  refetchRequired: boolean;
  dispatchBlocked: boolean;
  blockers: number;
  refusal: boolean;
}

export function controlAlert(input: ControlAlertInput | null): boolean {
  if (input === null) return false;
  return (
    input.executionPort === "unconfigured" ||
    input.resetRequired ||
    input.refetchRequired ||
    input.dispatchBlocked ||
    input.blockers > 0 ||
    input.refusal
  );
}

export interface ShellBadges {
  unreviewed: number;
  chainRunning: boolean;
  controlAlert: boolean;
}

function Badge({ section, badges }: { section: Section; badges: ShellBadges }): JSX.Element | null {
  if (section === "decisions") return <span className="nav-count" data-testid="nav-count-decisions">{badges.unreviewed}</span>;
  if (section === "chains" && badges.chainRunning) return <span className="dot dot-ok" data-testid="nav-dot-chains" title="a chain is running" />;
  if (section === "tasks" && badges.controlAlert) return <span className="dot dot-danger" data-testid="nav-dot-tasks" title="needs attention" />;
  return null;
}

export function Shell(props: {
  active: Section;
  badges: ShellBadges;
  footer: readonly string[];
  theme: ThemePref;
  onTheme?: (pref: ThemePref) => void;
  banners?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand" title="Leave it to Orca — every idea, made real."><span className="brand-dot" />Orca</div>
        <ul className="nav">
          {SECTIONS.map((section) => (
            <li key={section}>
              <a className="nav-item" href={hashFor(section)} aria-current={section === props.active ? "page" : undefined}>
                <span>{LABELS[section]}</span>
                <Badge section={section} badges={props.badges} />
              </a>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          {props.footer.map((line) => <p key={line}>{line}</p>)}
          <label className="theme-pick">
            Theme
            <select name="theme" value={props.theme} onChange={(e) => props.onTheme?.(e.currentTarget.value as ThemePref)}>
              {THEME_PREFS.map((pref) => <option key={pref} value={pref}>{pref}</option>)}
            </select>
          </label>
        </div>
      </nav>
      <main className="content">
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
