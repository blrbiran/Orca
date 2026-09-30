import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Panel i18n spec §3, §8: the inventory of text the panel shows comes from a TypeScript parse of web/src, not grep, and
 * every site is classified: `ui` is text a person reads (JSX text, a text attribute, a literal rendered directly, any
 * other literal of two words, a template whose static text has a word next to a space), `code` is the rest. The
 * resources themselves (web/src/i18n.ts, web/src/locales/) are never scanned. Task 11 relies on this classifier to pin
 * that nothing but a named allow-list is left untranslated, so each rule here must be able to go red.
 */
const SCRIPT = join(process.cwd(), "scripts", "scan-panel-text.mjs");
const SAMPLE = [
  'import { thing } from "./thing words.js";',
  'const LABEL = "Two words";',
  'const KEY = "single";',
  'export function Sample(props: { id: string; kind: "a b" }) {',
  '  if (props.id === "not ui words") return null;',
  "  return (",
  '    <section aria-label="Region name" className="some class">',
  "      <h2>Heading text</h2>",
  "      <p title={`Item ${props.id}`}>{\"Literal child\"}{`Count ${props.id}`}</p>",
  '      <a href="/x y">{LABEL}{KEY}</a>',
  "      {`/api/path/${props.id}/tail`}",
  "    </section>",
  "  );",
  "}",
  "export const message = (status: number): string => `answered ${status}`;",
  "export const path = (id: string): string => `/api/${id}/x`;",
  "",
].join("\n");

function scan(args: string[]): { rc: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "scan-"));
  mkdirSync(join(root, "web", "src", "locales"), { recursive: true });
  writeFileSync(join(root, "web", "src", "Sample.tsx"), SAMPLE);
  writeFileSync(join(root, "web", "src", "i18n.ts"), 'export const inI18n = "never scanned words";\n');
  writeFileSync(join(root, "web", "src", "locales", "en.ts"), 'export const en = { a: "never scanned words" };\n');
  const run = spawnSync(process.execPath, [SCRIPT, ...args, root], { encoding: "utf8" });
  return { rc: run.status, out: run.stdout };
}

describe("the panel text scan (spec §3, §8)", () => {
  it("prints every text site of web/src with its class, and skips imports, literal types and the resources", () => {
    const { rc, out } = scan([]);
    expect(rc).toBe(0);
    expect(out.split("\n")).toEqual([
      'ui\tweb/src/Sample.tsx:2\tconst:LABEL\t"Two words"',
      'code\tweb/src/Sample.tsx:3\tconst:KEY\t"single"',
      'code\tweb/src/Sample.tsx:5\tcompare\t"not ui words"',
      'ui\tweb/src/Sample.tsx:7\tattr:aria-label\t"Region name"',
      'code\tweb/src/Sample.tsx:7\tattr:className\t"some class"',
      "ui\tweb/src/Sample.tsx:8\tjsx-text\tHeading text",
      "ui\tweb/src/Sample.tsx:9\tattr:title\t`Item ${props.id}`",
      'ui\tweb/src/Sample.tsx:9\tjsx-expr\t"Literal child"',
      "ui\tweb/src/Sample.tsx:9\tjsx-expr\t`Count ${props.id}`",
      'code\tweb/src/Sample.tsx:10\tattr:href\t"/x y"',
      "ui\tweb/src/Sample.tsx:11\tjsx-expr\t`/api/path/${props.id}/tail`",
      "ui\tweb/src/Sample.tsx:15\treturn\t`answered ${status}`",
      "code\tweb/src/Sample.tsx:16\treturn\t`/api/${id}/x`",
      "",
    ]);
  });

  it("prints only the ui rows with --ui", () => {
    const { rc, out } = scan(["--ui"]);
    expect(rc).toBe(0);
    expect(out.split("\n").filter((line) => line !== "").every((line) => line.startsWith("ui\t"))).toBe(true);
    expect(out.split("\n").filter((line) => line !== "").length).toBe(8);
  });
});
