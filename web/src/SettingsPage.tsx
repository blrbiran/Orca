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

type GlobalProps = Omit<Parameters<typeof GlobalSettings>[0], "category">;
type ProjectProps = Parameters<typeof ProjectSettings>[0];

/** `projectKey` remounts the project's settings when the project changes, so no draft of one is shown for another. */
export function SettingsPage(props: { category: SettingsCategory; global: GlobalProps; project: ProjectProps; projectKey: string }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label={t("settings.categories")}>
        <ul>
          {SETTINGS_CATEGORIES.map((category) => (
            <li key={category}>
              <a className="nav-item" href={formatRoute({ kind: "settings", section: "settings", category })}
                aria-current={category === props.category ? "page" : undefined}>{t(`settings.category.${category}` as const)}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings-body">
        <GlobalSettings {...props.global} category={props.category} />
        {/* The project's own heading names it (gaps spec §11), so this category adds none. */}
        <SettingsCategoryPane category="project" active={props.category} title={false}>
          <ProjectSettings key={props.projectKey} {...props.project} />
        </SettingsCategoryPane>
      </div>
    </div>
  );
}
