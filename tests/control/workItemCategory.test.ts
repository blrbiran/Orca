import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { WORK_ITEM_CATEGORIES, workItemCategory } from "../../src/control/workItemCategory.js";

const at = (status: string, currentRunBlocked = false, dependenciesDone = true) => workItemCategory({ status, currentRunBlocked, dependenciesDone });

/**
 * Issue-fixes spec §6.1: one server-side mapping from a work item to what the panel shows, used by the summary counts and
 * sent in the view. A terminally failed run is `blocked` on its run while its item still reads `running`; showing it as
 * running is the bug of issue 16 this table fixes.
 */
describe("workItemCategory (spec §6.1)", () => {
  it("names exactly the five categories of the table", () => {
    expect([...WORK_ITEM_CATEGORIES]).toEqual(["idle", "running", "waiting", "blocked", "done"]);
  });

  it("blocked: the item is blocked", () => {
    expect(at("blocked")).toBe("blocked");
  });

  it("blocked: the item is held waiting for a person to continue it", () => {
    expect(at("held")).toBe("blocked");
  });

  it("blocked: an item `running` whose current run is blocked (a terminal failure today displays as active)", () => {
    expect(at("running", true)).toBe("blocked");
    expect(at("starting", true)).toBe("blocked");
  });

  it("running: running, continuing, starting, start-unknown (and the view's active) with a current run that is not blocked", () => {
    for (const status of ["running", "continuing", "starting", "start-unknown", "active"]) expect(at(status), status).toBe("running");
  });

  it("waiting: ready while some dependency is not done", () => {
    expect(at("ready", false, false)).toBe("waiting");
  });

  it("idle: ready with every dependency done, or draft", () => {
    expect(at("ready", false, true)).toBe("idle");
    expect(at("draft", false, false)).toBe("idle");
  });

  it("done: done (and the view's completed)", () => {
    expect(at("done")).toBe("done");
    expect(at("completed")).toBe("done");
  });

  it("refuses a status the table does not know by name rather than guessing a category", () => {
    expect(() => at("mystery")).toThrow(ControlError);
    expect(() => at("mystery")).toThrow(/work-item-category:mystery/);
  });
});
