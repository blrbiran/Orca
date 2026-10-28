/**
 * Issue 96: the markdown subset the requirement document is written in (src/control/requirementDocument.ts) --
 * headings, bullet lists nested by indentation, bold, and pipe tables. Everything else (HTML, links, images, code) stays
 * the characters it is: every piece of the document becomes a React text node, never markup.
 *
 * Kept apart from SafeMarkdown (saved task results), which has no bold or tables and no nesting; the two are candidates
 * to merge once one of them is changed for its own reasons.
 */
import type { JSX, ReactNode } from "react";
import { documentSectionTitle, documentSubTitle, documentTitle } from "./ui/requirementClasses.js";

const indentOf = (line: string): number => line.length - line.trimStart().length;
const BULLET = /^( *)[-*] (.*)$/;
const TABLE_RULE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

/** Bold is the one inline construct; an unclosed `**` stays text. */
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part)).filter((part) => part !== "");
}

/** A table row's cells: split on unescaped pipes, `\|` kept as a pipe inside its cell. */
function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

interface Item { lines: string[]; children: ReactNode[] }

/** One list at `indent`, from `start`: its items, their later lines, and lists nested deeper. */
function list(lines: readonly string[], start: number, indent: number): { node: JSX.Element; next: number } {
  const items: Item[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const current = items.at(-1);
    if (line.trim() === "") {
      // A blank line stays inside the item when the item goes on below it, indented.
      const after = lines[i + 1];
      if (current === undefined || after === undefined || after.trim() === "" || indentOf(after) <= indent) break;
      current.lines.push("");
      i++;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null && bullet[1]!.length === indent) { items.push({ lines: [bullet[2]!], children: [] }); i++; continue; }
    if (current === undefined || indentOf(line) <= indent) break;
    if (bullet !== null) {
      const nested = list(lines, i, bullet[1]!.length);
      current.children.push(nested.node);
      i = nested.next;
      continue;
    }
    current.lines.push(line.slice(Math.min(indentOf(line), indent + 2)));
    i++;
  }
  const node = (
    <ul key={start}>
      {items.map((item, index) => <li key={index}>{inline(item.lines.join("\n"))}{item.children}</li>)}
    </ul>
  );
  return { node, next: i };
}

export function RequirementMarkdown(props: { text: string }): JSX.Element {
  const lines = props.text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }
    const heading = /^#{1,6} +(.*)$/.exec(line);
    if (heading !== null) {
      const depth = /^#+/.exec(line)![0].length;
      blocks.push(depth === 1 ? <h4 key={i} className={documentTitle}>{inline(heading[1]!)}</h4>
        : depth === 2 ? <h5 key={i} className={documentSectionTitle}>{inline(heading[1]!)}</h5>
        : <h6 key={i} className={documentSubTitle}>{inline(heading[1]!)}</h6>);
      i++; continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) { const parsed = list(lines, i, bullet[1]!.length); blocks.push(parsed.node); i = parsed.next; continue; }
    // A block's key is the index of its first line: the index after its last line is the next block's key.
    const start = i;
    if (line.trimStart().startsWith("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push(
        <table key={start}>
          <thead><tr>{head.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, index) => <td key={index}>{inline(cell)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    // A paragraph runs to a blank line or to the next construct.
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !/^#{1,6} /.test(lines[i]!) && !BULLET.test(lines[i]!) && !lines[i]!.trimStart().startsWith("|")) paragraph.push(lines[i++]!);
    blocks.push(<p key={start}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="requirement-markdown whitespace-pre-wrap wrap-anywhere">{blocks}</div>;
}
