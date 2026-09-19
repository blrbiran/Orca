import { describe, expect, it } from "vitest";
import { createAdmissionGate } from "../../src/control/admissionGate.js";

describe("admission gate", () => {
  it("makes a claim either visible before shutdown or inadmissible after it", async () => {
    const gate = createAdmissionGate();
    const release = gate.enter();
    const drain = gate.beginDrain();
    expect(gate.draining).toBe(true);

    let crossed = false;
    void drain.beforeWriterTransaction.then(() => { crossed = true; });
    await Promise.resolve();
    expect(crossed).toBe(false);

    release();
    await drain.beforeWriterTransaction;
    expect(crossed).toBe(true);
    expect(() => gate.enter()).toThrowError("panel-draining");
  });

  it("makes release and beginDrain idempotent without resolving ahead of admitted operations", async () => {
    const gate = createAdmissionGate();
    const first = gate.enter();
    const second = gate.enter();
    const one = gate.beginDrain();
    const two = gate.beginDrain();
    expect(two.beforeWriterTransaction).toBe(one.beforeWriterTransaction);
    first(); first();
    let settled = false;
    void one.beforeWriterTransaction.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    second(); second();
    await one.beforeWriterTransaction;
    expect(settled).toBe(true);
  });

  it("crosses an empty gate immediately", async () => {
    const gate = createAdmissionGate();
    await gate.beginDrain().beforeWriterTransaction;
    expect(() => gate.enter()).toThrowError("panel-draining");
  });
});
