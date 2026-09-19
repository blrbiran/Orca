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

  it.each(["control-binary-invalid", "control-adapter-config-invalid"])("classifies helper-mediated %s as internal", (code) => {
    expect(Reflect.get(nonDurableControlErrorClassifications, code)).toBe("internal");
    expect(durableCommandErrorStatus(code)).toBeNull();
  });
});
