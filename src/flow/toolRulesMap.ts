/**
 * Flow engine spec §16.2 and the ccloop per-contract tool rules spec §2/§9: a template step's `tools` in ccloop's
 * spelling. Every key is filled (ccloop's schema has no defaults, so one rule set has one spelling and one contract
 * hash); what the step leaves out is the closed value -- no commands, no network, no secrets. Nothing is widened.
 */
import type { ToolRules } from "../control/toolRules.js";
import type { FlowTools } from "./template/schema.js";

export function stepToolsToToolRules(tools: FlowTools): ToolRules {
  return {
    commands: (tools.commands ?? []).map((rule) => "exact" in rule ? { kind: "exact" as const, value: rule.exact } : { kind: "prefix" as const, value: rule.prefix }),
    network: tools.network ?? false,
    secretEnv: [...(tools.secrets ?? [])],
  };
}
