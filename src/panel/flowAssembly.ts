/**
 * Flow engine spec §6.2-§6.3, §8.2 (plan Task 10; Task 8 deferral (b)): the flow kernel's production ports, built from
 * what the panel's control plane already holds. Only a panel with an execution driver has them (nothing could run a
 * flow's calls or children without one).
 *
 * - `calls`: flow single calls claimed on the parent group, run by the driver (flow/calls.ts).
 * - `children`: `work` steps as hidden child groups the driver runs on the vault (flow/childPort.ts).
 * - `confirmParent`: what a new run's parent is confirmed with (writer's call, ledgered): its single calls take the
 *   panel's estimator profile and the starting person's estimator layer (as a requirement's calls do); its children take
 *   that same profile for worker, handoff and goal review, the panel's estimate mode as their budget mode, and a context
 *   handoff at the worker profile's window. A panel with no estimator profile, or a profile that does not serve every
 *   kind, refuses the start `flow-profiles-unresolved`.
 * - `agents`: the installations ccloop's table names, in its order (the first is today's default selection), read at
 *   each pump pass before the kernel runs; every one is treated as `high` tier until settings carry tiers (Task 12).
 */
import { resolveGroupSelections } from "../control/agentFreeze.js";
import type { AdmissionGate } from "../control/admissionGate.js";
import { singleCallOutputBound } from "../control/estimator.js";
import type { ExecutionPort } from "../control/executionPort.js";
import { ORCHESTRATION_ACTOR } from "../control/orchestration.js";
import { estimatorSlotFor, type ImportDeps } from "../control/planImport.js";
import type { ExecutionProfileRouter } from "../control/profiles.js";
import type { ControlStore } from "../control/store.js";
import { createFlowCallPort } from "../flow/calls.js";
import { createDriverChildPort } from "../flow/childPort.js";
import { FlowRefusal, type AgentCandidate, type FlowDeps } from "../flow/kernel.js";
import type { FlowParentConfirmation } from "../flow/parent.js";

export interface PanelFlowInput {
  store: ControlStore;
  env: NodeJS.ProcessEnv;
  router: ExecutionProfileRouter;
  port: ExecutionPort;
  admissionGate: AdmissionGate;
  importDeps: Omit<ImportDeps, "estimatorObservation" | "estimatorSlot">;
  confirm(command: unknown): Promise<unknown>;
  /** The driver's kick: a claimed call or a confirmed child is the driver's to start. */
  kick(): void;
}

export interface PanelFlow { deps: FlowDeps; refreshAgents(): Promise<void> }

export function createPanelFlow(input: PanelFlowInput): PanelFlow {
  const { store, router } = input;
  let agents: AgentCandidate[] = [];
  const confirmParent = async (run: { flowRunId: string; groupId: string; projectId: string | null; by?: string }): Promise<FlowParentConfirmation> => {
    const defaults = input.importDeps.defaults();
    if (defaults?.estimatorProfileId == null || defaults.estimatorProfileHash === null) throw new FlowRefusal("flow-profiles-unresolved", "the panel has no estimator profile");
    let profile: ReturnType<ExecutionProfileRouter["resolve"]>, worker: ReturnType<ExecutionProfileRouter["resolve"]>;
    try {
      profile = router.resolve("budget-estimate", defaults.estimatorProfileId, defaults.estimatorProfileHash);
      worker = router.resolve("task", defaults.estimatorProfileId, defaults.estimatorProfileHash);
      router.resolve("handoff", defaults.estimatorProfileId, defaults.estimatorProfileHash);
      router.resolve("goal-review", defaults.estimatorProfileId, defaults.estimatorProfileHash);
    } catch (error) { throw new FlowRefusal("flow-profiles-unresolved", (error as Error).message); }
    const slot = await estimatorSlotFor({ store, profileRouter: router }, run.by ?? ORCHESTRATION_ACTOR, {}, profile);
    if (slot.outcome.kind !== "frozen") throw new FlowRefusal("flow-profiles-unresolved", `call agent: ${slot.outcome.code}`);
    const preflight = profile.snapshot.profile.estimatorPreflight;
    if (!preflight) throw new FlowRefusal("flow-profiles-unresolved", "the estimator profile has no single-call preflight");
    const binding = { profileId: profile.snapshot.profile.profileId, profileHash: profile.profileHash };
    return {
      call: { profile: binding, agentSlot: slot.outcome.slot, maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution) },
      children: {
        budgetMode: defaults.estimateMode, profiles: { estimator: binding, worker: binding, handoff: binding, goalReview: binding },
        contextPolicy: { handoffAtContextTokens: worker.snapshot.profile.capabilities.contextWindowTokens },
      },
    };
  };
  const deps: FlowDeps = {
    store, env: input.env, now: () => store.now(),
    calls: createFlowCallPort({ store, now: () => store.now(), admissionGate: input.admissionGate, kick: input.kick }),
    agents: () => agents,
    children: createDriverChildPort({
      store, env: input.env, importDeps: input.importDeps, confirm: input.confirm, admissionGate: input.admissionGate,
      selectionsHash: async (groupId) => (await resolveGroupSelections({ store, port: input.port }, groupId, ORCHESTRATION_ACTOR)).selectionsHash,
    }),
    confirmParent,
  };
  return {
    deps,
    async refreshAgents() {
      const view = await input.port.listAgents();
      agents = view.installations.map((installation) => ({ agent: installation.id, model: installation.defaults.model, tier: "high" as const }));
    },
  };
}
