import { describe, expect, it } from "vitest";
import { readProjectionState, recordProjectionChange } from "../../src/control/projectionJournal.js";
import { controlSummarySchema } from "../../src/control/webProtocol.js";
import { readControlGroup, readControlSummary } from "../../src/panel/controlViews.js";
import { updateRevision } from "../../src/control/commandLedger.js";
import { insertClarifyingGroup } from "../../src/control/requirementRecords.js";
import { clarifyingInput } from "../control/fixtures/requirement.js";
import { webFixture } from "../control/fixtures/web.js";

/**
 * Issue 94: one group whose stored body no longer parses (a hand-run `json_set(body,'$.stopped',false)` stores 0, not
 * false) made the whole summary refuse, so the requirements, tasks and board pages all went blank for every group.
 * The summary now lists that group as unreadable -- its id and the parse error -- and keeps every other group. The
 * group's own reads stay fail-closed: nothing is guessed from a body that does not parse.
 */
describe("a group whose stored body does not parse (issue 94)", () => {
  it("is listed as unreadable in the summary while the other groups are still summarised; its own read still refuses", async () => {
    const x = await webFixture();
    try {
      x.importDeferred("h");
      // Exactly the tester's statement: SQLite's json_set stores false as the integer 0.
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.stopped',false) WHERE id='h'").run();
      const since = readProjectionState(x.store).changeSeq;
      const complete = readControlSummary(x.store, "epoch", null);
      expect(complete.groups.map((group) => group.groupId)).toEqual(["g"]);
      // Review fix (important 1): each row says whether the body holds a requirement, so the Requirements page lists it.
      expect(complete.unreadable).toEqual([{ groupId: "h", reason: "group-body-invalid:Expected boolean, received number", requirement: false }]);
      expect(controlSummarySchema.safeParse(complete).success).toBe(true);
      // A sinceChangeSeq answer that names the broken group says the same, so a cached copy of it is not kept.
      recordProjectionChange(x.store, ["g", "h"]);
      const partial = readControlSummary(x.store, "epoch", since);
      expect(partial.groups.map((group) => group.groupId)).toEqual(["g"]);
      expect(partial.unreadable).toEqual(complete.unreadable);
      expect(() => readControlGroup(x.store, "epoch", "h")).toThrow(/group-body-invalid/);
    } finally { await x.dispose(); }
  });

  // Review fix (important 1): the Requirements page shows only requirement groups, and a CLI-opened requirement's id is
  // g-<uuid> like any group's, so whether a row is a requirement comes from the body itself (true), not from its id;
  // a body that is not JSON at all says nothing (null), and the page shows it rather than drop it.
  it("says which unreadable groups hold a requirement, from the stored body rather than the id", async () => {
    const x = await webFixture();
    try {
      x.store.transaction(() => { insertClarifyingGroup(x.store, clarifyingInput("g-1e36")); updateRevision(x.store, "g-1e36", 1); });
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.stopped',false) WHERE id='g-1e36'").run();
      x.importDeferred("h");
      x.store.db.prepare("UPDATE groups SET body='not json' WHERE id='h'").run();
      expect(readControlSummary(x.store, "epoch", null).unreadable).toEqual([
        { groupId: "g-1e36", reason: "group-body-invalid:Expected boolean, received number", requirement: true },
        { groupId: "h", reason: "group-body-invalid", requirement: null },
      ]);
    } finally { await x.dispose(); }
  });

  it("leaves a summary with no unreadable group byte-for-byte as before: no unreadable key at all", async () => {
    const x = await webFixture();
    try {
      expect("unreadable" in readControlSummary(x.store, "epoch", null)).toBe(false);
    } finally { await x.dispose(); }
  });
});
