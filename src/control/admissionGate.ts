import { ControlError } from "./errors.js";

export interface AdmissionGate {
  enter(): () => void;
  beginDrain(): { beforeWriterTransaction: Promise<void> };
  readonly draining: boolean;
}

/**
 * Linearization boundary between ordinary writers and process shutdown.
 * JavaScript executes enter/beginDrain synchronously, so an operation is
 * either counted before draining becomes visible or rejected afterwards.
 */
export function createAdmissionGate(): AdmissionGate {
  let active = 0;
  let draining = false;
  let resolveBarrier: (() => void) | undefined;
  let beforeWriterTransaction: Promise<void> | undefined;

  const finishDrainIfReady = (): void => {
    if (draining && active === 0) resolveBarrier?.();
  };

  return {
    get draining() { return draining; },
    enter() {
      if (draining) throw new ControlError("panel-draining");
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        finishDrainIfReady();
      };
    },
    beginDrain() {
      if (!beforeWriterTransaction) {
        draining = true;
        beforeWriterTransaction = new Promise<void>((resolve) => { resolveBarrier = resolve; });
        finishDrainIfReady();
      }
      return { beforeWriterTransaction };
    },
  };
}
