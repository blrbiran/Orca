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

// Radix Select (spec 2026-10-29-radix-select-everywhere-design.md §3) calls these while its list is open; jsdom has
// neither. `??=` leaves a real one alone; detailRegions and memoryLayout swap scrollIntoView inside their own criteria to
// watch it. The node-environment criteria have no Element at all.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
}
