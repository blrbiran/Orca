import { describe, expect, it } from "vitest";
import { isFollowupG } from "../../src/control/modelVersion.js";
import { driverHarness } from "./fixtures/driverHarness.js";

describe("the follow-up G model marker (spec §10.5, §11)", () => {
  // Parts 2 and 3 apply only to groups created after the release; the marker is how a group says which side it is on.
  it("a group created now carries the follow-up G marker; a body without it reads as created before", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      // mutation: drop the modelVersion stamp in planImport -> undefined, red
      expect(body.modelVersion).toBe("followup-g");
      expect(isFollowupG(body)).toBe(true);
      expect(isFollowupG({ ...body, modelVersion: undefined })).toBe(false);
      expect(isFollowupG({ ...body, modelVersion: "followup-h" })).toBe(false);
      expect(isFollowupG(null)).toBe(false);
    } finally { await t.h.dispose(); }
  });
});
