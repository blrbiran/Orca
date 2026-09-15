import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionDetail } from "../src/DecisionDetail.js";
import type { Decision } from "../src/DecisionDetail.js";

/**
 * task 8 ruling K7. Every field is a distinct literal, so no assertion can
 * pass by matching a different one.
 */
const decision: Decision = {
  id: "run/1",
  question: "distinct question text",
  chose: "distinct chose text",
  because: "distinct because text",
  alternatives: [{ option: "distinct alternative option text", why_not: "distinct why-not text" }],
};

describe("DecisionDetail (task 8 ruling K7)", () => {
  it("renders the question, the chosen option, the reasoning, and every alternative", () => {
    const html = renderToStaticMarkup(<DecisionDetail decision={decision} />);
    expect(html).toContain(decision.question);
    expect(html).toContain(decision.chose);
    expect(html).toContain(decision.because);
    expect(html).toContain(decision.alternatives[0]!.option);
    expect(html).toContain(decision.alternatives[0]!.why_not);
  });
});
