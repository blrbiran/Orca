/** Minimal block layout. Inline HTML, URLs, links and images always remain React text nodes. */
import type { JSX, ReactNode } from "react";
export function SafeMarkdown({ text }: { text: string }): JSX.Element {
 const lines = text.replace(/\r\n?/g, "\n").split("\n"); const blocks: ReactNode[] = [];
 for (let i = 0; i < lines.length;) {
  const line = lines[i]!; const key = i;
  if (line.trim() === "") { i++; continue; }
  if (/^```/.test(line)) {
   const code: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!);
   if (i < lines.length) i++; blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>); continue;
  }
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) { const Tag = `h${heading[1]!.length}` as keyof JSX.IntrinsicElements; blocks.push(<Tag key={key}>{heading[2]}</Tag>); i++; continue; }
  const list = /^\s*(?:[-*+] |\d+[.)] )/.exec(line);
  if (list) {
   const ordered = /^\s*\d/.test(line); const items: ReactNode[] = [];
   const pattern = ordered ? /^\s*\d+[.)] (.*)$/ : /^\s*[-*+] (.*)$/;
   while (i < lines.length) { const match = pattern.exec(lines[i]!); if (!match) break; items.push(<li key={i}>{match[1]}</li>); i++; }
   blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
  }
  const paragraph: string[] = [line]; i++;
  while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,6}\s|```|\s*[-*+] |\s*\d+[.)] )/.test(lines[i]!)) paragraph.push(lines[i++]!);
  blocks.push(<p key={key}>{paragraph.join("\n")}</p>);
 }
 return <div className="saved-markdown">{blocks}</div>;
}
