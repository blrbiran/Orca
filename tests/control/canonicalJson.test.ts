import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";

describe("canonical JSON", () => {
  it("hashes safe-integer RFC 8785 values", () => {
    expect(canonicalBytes({ z: 1, a: "x" }).toString("utf8")).toBe('{"a":"x","z":1}');
    expect(sha256Canonical({ z: 1, a: "x" })).toBe(
      "8d6a75ac86d8b51bb56acfbb96108ed81474aa3504c317f77c0c576bde387cd3",
    );
  });

  it("orders properties by UTF-16 code units and preserves array order and explicit nulls", () => {
    const value = { "\ue000": 2, "😀": 1, values: [3, null, 1] };
    expect(canonicalBytes(value).toString("utf8")).toBe('{"values":[3,null,1],"😀":1,"":2}');
  });

  it.each([-0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the ambiguous number %s",
    (bad) => {
      expect(() => canonicalBytes({ bad })).toThrowError("control-non-canonical-json");
    },
  );

  it("rejects values outside the canonical protocol domain", () => {
    expect(() => canonicalBytes({ omitted: undefined })).toThrowError("control-non-canonical-json");
    expect(() => canonicalBytes({ bad: "\ud800" })).toThrowError("control-non-canonical-json");
    expect(() => canonicalBytes({ "\udfff": true })).toThrowError("control-non-canonical-json");
    expect(() => canonicalBytes(Object.create(null))).toThrowError("control-non-canonical-json");
  });
});
