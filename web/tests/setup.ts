/**
 * Panel i18n spec §6.1: every web criterion renders in English unless it switches the language itself, and a criterion
 * that switches is put back to English afterwards.
 */
import { afterEach } from "vitest";
import i18n, { initI18n } from "../src/i18n.js";

initI18n({ lng: "en" });
afterEach(async () => {
  await i18n.changeLanguage("en");
});
