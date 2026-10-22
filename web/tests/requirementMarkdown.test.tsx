// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RequirementMarkdown } from "../src/RequirementMarkdown.js";

/**
 * Issue 96: the requirement document is markdown (src/control/requirementDocument.ts) and the panel showed its section
 * bodies as raw text. This is the subset that document uses -- headings, bullet lists (nested by indentation), bold and
 * pipe tables -- rendered as React elements. Everything else stays text: no HTML from the document ever becomes markup,
 * and a link or code span is shown as the characters it is.
 */
const html = (text: string): string => renderToStaticMarkup(<RequirementMarkdown text={text} />);

describe("the requirement document's markdown subset (issue 96)", () => {
  it("renders a heading without its hashes", () => {
    expect(html("### R1.ADR1 One output\n\n- context: Notes are independent.")).toContain("<h6>R1.ADR1 One output</h6>");
  });

  it("renders bullet lists, nested by indentation, as the rounds and consensus sections write them", () => {
    const text = ["- R1.Q1: Which Markdown flavour?", "  - answer: CommonMark (recommended)", "- R1.Q2: Are images exported?", "  - recommended: As links", "  - answer: As links"].join("\n");
    expect(html(text)).toBe('<div class="requirement-markdown"><ul>'
      + "<li>R1.Q1: Which Markdown flavour?<ul><li>answer: CommonMark (recommended)</li></ul></li>"
      + "<li>R1.Q2: Are images exported?<ul><li>recommended: As links</li><li>answer: As links</li></ul></li>"
      + "</ul></div>");
  });

  it("keeps an item's later lines inside it, the blank line between them included", () => {
    expect(html("- context: Notes are independent.\n\n  Even nested ones.\n- decision: Export each note."))
      .toBe('<div class="requirement-markdown"><ul><li>context: Notes are independent.\n\nEven nested ones.</li><li>decision: Export each note.</li></ul></div>');
  });

  it("renders bold, as the glossary writes its terms", () => {
    expect(html("- **参考实现**: 位于 /x 的并行实现")).toContain("<li><strong>参考实现</strong>: 位于 /x 的并行实现</li>");
  });

  it("renders a pipe table, an escaped pipe kept inside its cell", () => {
    const out = html(["| Criterion | Tasks |", "| --- | --- |", "| AC\\|1 | export\\|er, images |"].join("\n"));
    expect(out).toContain("<table><thead><tr><th>Criterion</th><th>Tasks</th></tr></thead><tbody><tr><td>AC|1</td><td>export|er, images</td></tr></tbody></table>");
  });

  it("keeps every other construct as escaped text: HTML, links, images, code and an unclosed bold", () => {
    const text = "A <b>note</b> <script>x()</script> [link](javascript:alert(1)) ![i](http://e/x.png) `code` **open";
    const out = html(text);
    expect(out).toBe(`<div class="requirement-markdown"><p>A &lt;b&gt;note&lt;/b&gt; &lt;script&gt;x()&lt;/script&gt; [link](javascript:alert(1)) ![i](http://e/x.png) \`code\` **open</p></div>`);
  });

  // Review fix (minor 5): a paragraph's or a table's key was the index after its last line -- the next block's start --
  // so "text\n- item" gave two siblings the same key.
  it.each([["a paragraph before a list", "text\n- item"], ["a table before a heading", "| a |\n| --- |\n| 1 |\n### x"]])("gives every block its own key: %s", (_name, text) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<RequirementMarkdown text={text} />);
      cleanup();
      expect(error.mock.calls.filter((call) => String(call[0]).includes("same key"))).toEqual([]);
    } finally { error.mockRestore(); }
  });
});
