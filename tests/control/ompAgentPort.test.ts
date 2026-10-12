import { expect, it } from "vitest";
import { agentPreviewSchema } from "../../src/control/agentInstallationProtocol.js";

it("accepts a guarded OMP candidate reason across the Orca control boundary", () => {
  const parsed = agentPreviewSchema.parse({
    schema: "orca-agent-detection-preview-v1", previewId: "preview-omp", baseTableHash: "a".repeat(64), observedAt: "2026-10-12T00:00:00.000Z", installed: [],
    changes: [{ changeId: "omp-add", kind: "addition", installationId: "omp", command: ["/tmp/omp"], realpath: "/tmp/omp", version: "1.0", unavailableReason: "omp-default-model-unresolved" }],
  });
  expect(parsed.changes[0]?.unavailableReason).toBe("omp-default-model-unresolved");
});
