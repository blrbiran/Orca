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
  // Lines 17-22 pin the remaining skip and class branches: a re-export source, a quoted key and an indexed key are
  // never sites; a two-word `case` label is code; a plain template literal is listed like a string; punctuation alone
  // (" · ") is no site at all.
  'export { thing as other } from "./other words.js";',
  'const TABLE = { "two key words": 1 };',
  'const pick = TABLE["two key words"];',
  'switch (KEY) { case "two case words": break; }',
  "const NOSUB = `plain template words`;",
  'export const Dot = () => <i>{" · "}</i>;',
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
      'code\tweb/src/Sample.tsx:20\tcase\t"two case words"',
      'ui\tweb/src/Sample.tsx:21\tconst:NOSUB\t"plain template words"',
      "",
    ]);
  });

  it("prints only the ui rows with --ui", () => {
    const { rc, out } = scan(["--ui"]);
    expect(rc).toBe(0);
    expect(out.split("\n").filter((line) => line !== "").every((line) => line.startsWith("ui\t"))).toBe(true);
    expect(out.split("\n").filter((line) => line !== "").length).toBe(9);
  });
});

/**
 * Panel i18n spec §6.5, §8 (drafter finding F18): once every area is converted, the scan finds nothing a person reads in
 * web/src but this allow-list -- the brand, two class names, the HTTP-method-and-path part of the web's own messages and
 * a developer error that is never rendered. A literal left in a branch no fixture renders is caught here, not by §6.5.
 */
const ALLOWED = [
  "web/src/Shell.tsx\tOrca",
  'web/src/TaskDetail.tsx\t"label label-custom"',
  'web/src/TaskDetail.tsx\t"label label-system"',
  "web/src/api.ts\t`GET ${path}`",
  "web/src/api.ts\t`POST ${path}`",
  "web/src/controlApi.ts\t`GET ${entry.downloadUrl}`",
  "web/src/controlApi.ts\t`GET ${entry.downloadUrl}`",
  "web/src/controlApi.ts\t`GET ${path}`",
  "web/src/controlApi.ts\t`GET ${path}`",
  "web/src/controlApi.ts\t`POST ${path}`",
  "web/src/controlApi.ts\t`POST ${path}`",
  'web/src/main.tsx\t"orca panel: #root is missing from index.html"',
];

describe("nothing left to translate (spec §6.5 backstop)", () => {
  it("leaves nothing in web/src for a person to read but the allow-list", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--ui", process.cwd()], { encoding: "utf8" });
    expect(run.status).toBe(0);
    const rows = run.stdout.split("\n").filter((line) => line !== "").map((line) => {
      const [, where, , text] = line.split("\t");
      return `${where!.replace(/:\d+$/, "")}\t${text}`;
    });
    expect(rows.sort()).toEqual([...ALLOWED].sort());
  });
});
