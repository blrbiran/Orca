/** Progress spec §4: browser preferences and shared panel-operator defaults, composed from existing controls. */
import { ChecksSettings } from "./ChecksSettings.js";
import { OrchestrationSettings } from "./OrchestrationSettings.js";
import { RefusalNotice } from "./RefusalNotice.js";
import type { ControlRefusal } from "./controlState.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountSettings } from "./AuthGate.js";
import { AgentSettings } from "./AgentSettings.js";
import type { AgentSettingsProps } from "./AgentSettings.js";
import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText } from "./i18n.js";
import type { PanelLanguage } from "./i18n.js";
import { THEME_PREFS } from "./theme.js";
import type { ThemePref } from "./theme.js";

export function GlobalSettings(props: {
  refusal?: ControlRefusal | null;
  theme: ThemePref; onTheme: (pref: ThemePref) => void;
  language: PanelLanguage; onLanguage: (lang: PanelLanguage) => void;
  showAdvanced?: boolean; onAdvanced?: (show: boolean) => void;
  agents: AgentSettingsProps | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="settings" aria-label={t("nav.globalSettings")}>
      <h2>{t("nav.globalSettings")}</h2>
      {props.refusal && <RefusalNotice refusal={props.refusal} testId="global-settings-refusal" />}
      <p>{t("settings.browserScope")}</p>
      <div className="settings-browser">
        <label className="theme-pick">{t("shell.theme")}
          <select name="theme" value={props.theme} onChange={(e) => props.onTheme(e.currentTarget.value as ThemePref)}>
            {THEME_PREFS.map((pref) => <option key={pref} value={pref}>{enumText("theme", pref)}</option>)}
          </select>
        </label>
        <label className="theme-pick">{t("shell.language")}
          <select name="language" value={props.language} onChange={(e) => props.onLanguage(e.currentTarget.value as PanelLanguage)}>
            {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}
          </select>
        </label>
        <label className="theme-pick"><input type="checkbox" checked={props.showAdvanced ?? false}
          onChange={(event) => props.onAdvanced?.(event.currentTarget.checked)} />{t("settings.showAdvanced")}</label>
      </div>
      <AccountSettings />
      <OrchestrationSettings />
      <ChecksSettings scope="global" />
      <p>{t("settings.agentScope")}</p>
      {props.agents === null ? <p role="status">{t("settings.agentsUnavailable")}</p> : <AgentSettings {...props.agents} />}
    </section>
  );
}
