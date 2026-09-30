#!/usr/bin/env node
// Panel i18n spec §3, §8: list every candidate text site in web/src (not grep: a TypeScript parse), one per line:
//   <class>\t<file>:<line>\t<context>\t<text>
// class "ui" is text a person reads (JSX text, a text attribute, a literal rendered directly, or any other literal with
// two words); "code" is everything else (keys, verbs, paths, comparisons). web/src/locales/ and web/src/i18n.ts are the
// resources themselves and are not scanned.
//   node scripts/scan-panel-text.mjs [--ui] [repo root]
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const uiOnly = args.includes("--ui");
const root = resolve(args.find((arg) => arg !== "--ui") ?? process.cwd());
const ts = createRequire(import.meta.url)("typescript");
const dir = join(root, "web", "src");
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && f !== "i18n.ts").sort();
const TEXT_ATTRS = new Set(["aria-label", "title", "label", "placeholder", "alt"]);
const letters = /[A-Za-z一-鿿]/;
const twoWords = /[A-Za-z]+[^A-Za-z]*\s[^A-Za-z]*[A-Za-z]+/;

function context(node) {
  const p = node.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return null;
  if (ts.isPropertyAssignment(p) && p.name === node) return null;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return null;
  const attr = ts.isJsxAttribute(p) ? p : ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) ? p.parent : null;
  if (attr) return `attr:${attr.name.getText()}`;
  if (ts.isJsxExpression(p)) return "jsx-expr";
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return "compare";
  if (ts.isCaseClause(p)) return "case";
  if (ts.isCallExpression(p)) return `arg:${p.expression.getText().slice(0, 40)}`;
  if (ts.isPropertyAssignment(p)) return `prop:${p.name.getText()}`;
  if (ts.isVariableDeclaration(p)) return `const:${p.name.getText()}`;
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return "return";
  if (ts.isConditionalExpression(p)) return "cond";
  if (ts.isBinaryExpression(p)) return `binary:${p.operatorToken.getText()}`;
  if (ts.isArrayLiteralExpression(p)) return "array";
  return ts.SyntaxKind[p.kind];
}

// A template's static text with a word next to a space ("answered ${status}") is a sentence around data.
const wordBySpace = /[A-Za-z]{2,}\s|\s[A-Za-z]{2,}/;

function classOf(ctx, staticText, isTemplate) {
  if (ctx === "jsx-text" || ctx === "jsx-expr") return "ui";
  if (ctx.startsWith("attr:")) return TEXT_ATTRS.has(ctx.slice(5)) ? "ui" : "code";
  if (ctx === "compare" || ctx === "case") return "code";
  return twoWords.test(staticText) || (isTemplate && wordBySpace.test(staticText)) ? "ui" : "code";
}

const out = [];
for (const file of files) {
  const path = join(dir, file);
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const emit = (node, ctx, staticText, shown, isTemplate = false) => {
    if (ctx === null || !letters.test(staticText)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    const cls = classOf(ctx, staticText, isTemplate);
    if (!uiOnly || cls === "ui") out.push(`${cls}\t${relative(root, path)}:${line + 1}\t${ctx}\t${shown}`);
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (text !== "") emit(node, "jsx-text", text, text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      emit(node, context(node), node.text, JSON.stringify(node.text));
    } else if (ts.isTemplateExpression(node)) {
      emit(node, context(node), [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(""), node.getText(), true);
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
process.stdout.write(out.length === 0 ? "" : `${out.join("\n")}\n`);
