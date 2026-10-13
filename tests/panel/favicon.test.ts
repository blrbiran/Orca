import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadStaticFiles } from "../../src/panel/staticFiles.js";

// The panel's favicon (human request, 2026-10-13, Orca session 7f37d261): web/public/favicon.ico is the DoWhiz website's
// favicon, byte for byte; the build copies it to the top of web/dist, where the static map serves it without auth.
// Reads the real web/dist, so `npm run build --workspace web` must have run (as for the rest of tests/panel).
it("serves the built favicon as an icon and the page links it", async () => {
  const statics = await loadStaticFiles(undefined);
  const icon = statics.get("favicon.ico");
  expect(icon?.contentType).toBe("image/x-icon");
  expect(icon?.bytes.equals(readFileSync(fileURLToPath(new URL("../../web/public/favicon.ico", import.meta.url))))).toBe(true);
  expect(statics.indexHtml?.bytes.toString("utf8")).toContain('<link rel="icon" href="/favicon.ico" />');
});
