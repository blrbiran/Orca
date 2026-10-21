import { describe, expect, it } from "vitest";
import { correctionSchema } from "../../src/corrections/schema.js";

function correction(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "c_01J9X",
    projectKey: "github.com/blrbiran/ccloop",
    decisionId: "run-7c/3",
    kind: "not_my_taste",
    chose_instead: "把检查 5 提升到目录级",
    because: "同一文件那个约束不是 id 的语义要求",
    at: "2026-09-05T18:04:11Z",
    by: "biran",
    ...over,
  };
}

describe("correction — spec §4 (DB side, migratable)", () => {
  it("accepts a complete not_my_taste correction", () => {
    expect(correctionSchema.safeParse(correction()).success).toBe(true);
  });

  // Seven, not eight: chose_instead is conditional and is covered on its own
  // below. Listing it here would contradict that.
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9). Six now: flow engine spec §13.1 (W-COR) makes a row with no
  // decisionId the repository-only shape (projectKey + one sentence), so decisionId left the required list; the
  // replacement assertion below pins that its absence is accepted only as that shape.
  it("accepts a correction missing decisionId as the repository-only shape", () => {
    const value = correction();
    delete value.decisionId;
    expect(correctionSchema.safeParse(value).success).toBe(true);
    expect(correctionSchema.safeParse({ ...value, pendingId: "pending-r-0" }).success).toBe(false);
  });
  for (const field of ["id", "projectKey", "kind", "because", "at", "by"]) {
    it(`rejects a correction missing ${field}`, () => {
      const value = correction();
      delete value[field];
      expect(correctionSchema.safeParse(value).success).toBe(false);
    });
  }

  // Ruling orca-dev-c1c3c2ec/12: only "the human wants a different one" has to
  // name the different one.
  it("rejects a not_my_taste correction with no chose_instead", () => {
    const value = correction();
    delete value.chose_instead;
    expect(correctionSchema.safeParse(value).success).toBe(false);
  });

  for (const kind of ["wrong", "stale"]) {
    it(`accepts a ${kind} correction with no chose_instead — it may have no alternative to name`, () => {
      const value = correction({ kind });
      delete value.chose_instead;
      expect(correctionSchema.safeParse(value).success).toBe(true);
    });
  }

  it("rejects an unknown kind", () => {
    expect(correctionSchema.safeParse(correction({ kind: "dunno" })).success).toBe(false);
  });
});
