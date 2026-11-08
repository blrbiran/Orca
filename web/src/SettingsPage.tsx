/**
 * Ruling H6(b) (2026-10-27, session 7753e97d; tester issues #39, #41, #59): global and project settings are one page with
 * a category nav, each category its own hash (#settings/<category>) -- a wrapping row of tabs above the content since tester
 * #64 (spec §24, human revision in session 3cd8fb02), still links with aria-current, not an ARIA tablist. Every
 * category stays mounted -- App-level criteria find settings controls by role -- and only styles.css hides the others.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, SettingsCategoryPane } from "./GlobalSettings.js";
import { ProjectSettings } from "./ProjectSettings.js";
import { SETTINGS_CATEGORIES, formatRoute, type SettingsCategory } from "./sections.js";
import { projectName, type ProjectV1 } from "./project.js";
import { tabItem, tabRow } from "./ui/classes.js";

type GlobalProps = Omit<Parameters<typeof GlobalSettings>[0], "category">;
type ProjectProps = Parameters<typeof ProjectSettings>[0];
/**
 * Tester #69 (spec §24): the panel's one project scope (the sidebar switcher's state), not a page-local choice.
 * `project` is null under All projects; `projects` null while the list is unread or failed (no select then).
 */
export type ProjectPick = { projects: readonly ProjectV1[] | null; project: string | null; onProject: (projectKey: string) => void };

/** Settings describes the sidebar's scope without offering a second scope control. */
function ProjectIdentity(props: ProjectPick): JSX.Element | null {
  const { t } = useTranslation();
  if (props.projects === null) return null;
  const current = props.projects.find((entry) => entry.projectKey === props.project);
  return (
    <div data-testid="settings-workspace-identity" className="mb-4 rounded-card border border-line bg-well p-3">
      {props.projects.length === 0 ? <p>{t("project.none")} · {t("project.add")}</p> : current === undefined ? <p>{t("settings.projectPick.allIdentity")}</p> : (
        <dl>
          <dt>{t("settings.projectPick.name")}</dt><dd>{projectName(current)}</dd>
          <dt>{t("settings.projectPick.kind")}</dt><dd>{current.kind === "multi" ? t("settings.projectPick.multi") : t("settings.projectPick.directory")}</dd>
          <dt>{t("settings.projectPick.root")}</dt><dd>{current.path ?? t("common.na")}</dd>
        </dl>
      )}
      {props.projects.length > 0 && <a href="#workspace-switcher" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-switcher")?.focus(); }}>
        {t("settings.projectPick.switch")}
      </a>}
    </div>
  );
}

/** `projectKey` remounts the project's settings when the project changes, so no draft of one is shown for another. */
export function SettingsPage(props: { category: SettingsCategory; global: GlobalProps; project: ProjectProps; projectKey: string; pick: ProjectPick }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("settings.categories")}>
        <ul className={tabRow}>
          {SETTINGS_CATEGORIES.map((category) => (
            <li key={category}>
              <a className={tabItem} href={formatRoute({ kind: "settings", section: "settings", category })}
                aria-current={category === props.category ? "page" : undefined}>{t(`settings.category.${category}` as const)}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <GlobalSettings {...props.global} category={props.category} />
        {/* The project's own heading names it (gaps spec §11), so this category adds none. */}
        <SettingsCategoryPane category="project" active={props.category} title={false}>
          <ProjectIdentity {...props.pick} />
          <ProjectSettings key={props.projectKey} {...props.project} />
        </SettingsCategoryPane>
      </div>
    </div>
  );
}
