import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ControlError,
  durableCommandErrorStatus,
  durableCommandErrorStatuses,
  nonDurableControlErrorClassifications,
  v1WebErrorCodes,
  type KnownControlErrorCode,
} from "../../src/control/errors.js";

// Compiled by the root typecheck, without executing deliberately invalid calls.
function constructionContract(externalCode: string, code: KnownControlErrorCode) {
  new ControlError(code);
  // @ts-expect-error A new literal must be classified before construction.
  new ControlError("unclassified-control-error");
  // @ts-expect-error Helpers cannot forward arbitrary strings to ControlError.
  new ControlError(externalCode);
  // @ts-expect-error External exit/status strings cannot manufacture codes.
  new ControlError(`control-peer-exit-${externalCode}`);
}
void constructionContract;

describe("control error classification", () => {
  it("closes construction over the exactly-once classified code union", () => {
    type DurableCode = keyof typeof durableCommandErrorStatuses;
    type NonDurableCode = keyof typeof nonDurableControlErrorClassifications;
    expectTypeOf<ConstructorParameters<typeof ControlError>[0]>().toEqualTypeOf<KnownControlErrorCode>();
    expectTypeOf<ControlError["code"]>().toEqualTypeOf<KnownControlErrorCode>();
    expectTypeOf<KnownControlErrorCode>().toEqualTypeOf<DurableCode | NonDurableCode>();
    expectTypeOf<Extract<DurableCode, NonDurableCode>>().toEqualTypeOf<never>();
    expectTypeOf<string>().not.toExtend<KnownControlErrorCode>();

    const durable = Object.keys(durableCommandErrorStatuses) as DurableCode[];
    const nonDurable = Object.keys(nonDurableControlErrorClassifications) as NonDurableCode[];
    expect(durable.filter((code) => Object.hasOwn(nonDurableControlErrorClassifications, code))).toEqual([]);
    for (const code of [...durable, ...nonDurable]) {
      expect(new ControlError(code).code).toBe(code);
      expect(Number(Object.hasOwn(durableCommandErrorStatuses, code)) + Number(Object.hasOwn(nonDurableControlErrorClassifications, code))).toBe(1);
    }
    for (const code of durable) expect(durableCommandErrorStatus(code)).toBe(durableCommandErrorStatuses[code]);
    for (const code of nonDurable) expect(durableCommandErrorStatus(code)).toBeNull();
    expect(v1WebErrorCodes.every((code) => Object.hasOwn(durableCommandErrorStatuses, code) || Object.hasOwn(nonDurableControlErrorClassifications, code))).toBe(true);
    expect(new Set(v1WebErrorCodes).size).toBe(v1WebErrorCodes.length);
    expect([...v1WebErrorCodes].sort()).toEqual(v1WebErrorCodes);
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the agents table replaced the
  // adapter config (spec §6.6), so its path refusal is the helper-mediated internal code now.
  it.each(["control-binary-invalid", "control-agents-table-invalid"])("classifies helper-mediated %s as internal", (code) => {
    expect(Reflect.get(nonDurableControlErrorClassifications, code)).toBe("internal");
    expect(durableCommandErrorStatus(code)).toBeNull();
  });

  // Agent selection spec §7 (W6-11/W6-12): the port rethrows ccloop's named refusals of a selection or table under
  // their own names, and Orca's own agent-unselected joins them. Each is a state a person is told about -- a command
  // that is understood and cannot be performed as asked -- so it is durable at 422, never an internal failure.
  it.each(["agent-installation-missing", "agent-context-unsupported", "agent-selection-invalid", "agent-version-drift", "agents-table-invalid", "agent-unselected"])(
    "records the agent selection refusal %s durably at 422", (code) => {
      expect(durableCommandErrorStatus(code)).toBe(422);
      expect(Object.hasOwn(nonDurableControlErrorClassifications, code)).toBe(false);
    });
});
