/**
 * Progress spec §4: browser preferences and shared panel-operator defaults, composed from existing controls.
 * Ruling H6(b): one category of them is shown at a time (SettingsPage); the rest stay mounted, hidden by styles.css only.
 */
import { ChecksSettings } from "./ChecksSettings.js";
import { FlowSettings } from "./FlowSettings.js";
import { OrchestrationSettings } from "./OrchestrationSettings.js";
import { RefusalNotice } from "./RefusalNotice.js";
import type { ControlRefusal } from "./controlState.js";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccountSettings } from "./AuthGate.js";
import { AgentSettings } from "./AgentSettings.js";
import type { AgentSettingsProps } from "./AgentSettings.js";
import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText } from "./i18n.js";
import type { PanelLanguage } from "./i18n.js";
import { THEME_PREFS } from "./theme.js";
import type { ThemePref } from "./theme.js";
import type { SettingsCategory } from "./sections.js";
import { inlinePick, settingsRegion } from "./ui/classes.js";

/** One category's content, under its own page title; only the active one shows. */
export function SettingsCategoryPane(props: { category: SettingsCategory; active: SettingsCategory; title?: boolean; children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="settings-category" data-category={props.category} data-active={props.category === props.active ? "true" : "false"}>
      {props.title !== false && <h2>{t(`settings.category.${props.category}` as const)}</h2>}
      {props.children}
    </div>
  );
}

export function GlobalSettings(props: {
  category: SettingsCategory;
  refusal?: ControlRefusal | null;
  theme: ThemePref; onTheme: (pref: ThemePref) => void;
  language: PanelLanguage; onLanguage: (lang: PanelLanguage) => void;
  showAdvanced?: boolean; onAdvanced?: (show: boolean) => void;
  agents: AgentSettingsProps | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className={`settings ${settingsRegion}`} aria-label={t("nav.globalSettings")} data-active={props.category === "project" ? "false" : "true"}>
      {props.refusal && <RefusalNotice refusal={props.refusal} testId="global-settings-refusal" />}
      <SettingsCategoryPane category="appearance" active={props.category}>
        <p>{t("settings.browserScope")}</p>
        <div className="mb-4 flex flex-wrap gap-4">
          <label className={inlinePick}>{t("shell.theme")}
            <select name="theme" value={props.theme} onChange={(e) => props.onTheme(e.currentTarget.value as ThemePref)}>
              {THEME_PREFS.map((pref) => <option key={pref} value={pref}>{enumText("theme", pref)}</option>)}
            </select>
          </label>
          <label className={inlinePick}>{t("shell.language")}
            <select name="language" value={props.language} onChange={(e) => props.onLanguage(e.currentTarget.value as PanelLanguage)}>
              {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}
            </select>
          </label>
          <label className={inlinePick}><input type="checkbox" checked={props.showAdvanced ?? false}
            onChange={(event) => props.onAdvanced?.(event.currentTarget.checked)} />{t("settings.showAdvanced")}</label>
        </div>
      </SettingsCategoryPane>
      <SettingsCategoryPane category="account" active={props.category}><AccountSettings /></SettingsCategoryPane>
      <SettingsCategoryPane category="orchestration" active={props.category}><OrchestrationSettings /></SettingsCategoryPane>
      <SettingsCategoryPane category="checks" active={props.category}><ChecksSettings scope="global" /></SettingsCategoryPane>
      <SettingsCategoryPane category="flows" active={props.category}><FlowSettings scope="global" /></SettingsCategoryPane>
      <SettingsCategoryPane category="agents" active={props.category}>
        <p>{t("settings.agentScope")}</p>
        {props.agents === null ? <p role="status">{t("settings.agentsUnavailable")}</p> : <AgentSettings {...props.agents} />}
      </SettingsCategoryPane>
    </section>
  );
}
