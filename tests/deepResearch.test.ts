import test from "node:test";
import assert from "node:assert/strict";
import {
  stripDuplicateReferences,
  outputsToText,
  extractInteractionResult,
  formatUptime,
  formatErrorDetail,
  runStartDeepResearch,
  runCheckDeepResearch,
  startDeepResearchInput,
  checkDeepResearchInput
} from "../src/tools/deepResearch.js";

test("startDeepResearchInput validation", () => {
  assert.throws(() => startDeepResearchInput.parse({ prompt: "" }));
  const valid = startDeepResearchInput.parse({ prompt: "Research AI" });
  assert.equal(valid.prompt, "Research AI");
});

test("checkDeepResearchInput validation", () => {
  assert.throws(() => checkDeepResearchInput.parse({ job_id: "" }));
  const valid = checkDeepResearchInput.parse({ job_id: "int_123" });
  assert.equal(valid.job_id, "int_123");
  assert.equal(valid.include_citations, true);
});

test("stripDuplicateReferences removes references section with cite markers", () => {
  const input = `
# Summary
Quantum computing is advancing [cite: 1].

### References
[cite: 1] Quantum Computing in 2026. Description.
[cite: 2] Another citation.

## Sources:
- https://example.com/source1
`;
  const result = stripDuplicateReferences(input);
  assert.ok(!result.includes("### References"));
  assert.ok(!result.includes("[cite: 2] Another citation"));
  assert.ok(result.includes("Quantum computing is advancing [cite: 1]."));
  assert.ok(result.includes("## Sources:"));
});

test("outputsToText concatenates text outputs", () => {
  const outputs = [
    { type: "text", text: "Hello" },
    { type: "text", text: "World" },
    { type: "tool", text: "" },
    { type: "text", text: "  " }
  ];
  assert.equal(outputsToText(outputs), "Hello\n\nWorld");
});

test("extractInteractionResult extracts from modern steps", async () => {
  const interaction = {
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: "Modern step report" }]
      }
    ]
  };
  const result = await extractInteractionResult(interaction, false);
  assert.equal(result, "Modern step report");
});

test("extractInteractionResult extracts from output_text property", async () => {
  const interaction = {
    status: "completed",
    output_text: "Modern output_text report"
  };
  const result = await extractInteractionResult(interaction, false);
  assert.equal(result, "Modern output_text report");
});

test("formatUptime calculates human readable durations", () => {
  const now = Date.now();
  const fiveMinAgoIso = new Date(now - 5 * 60 * 1000 - 15 * 1000).toISOString();
  const uptime = formatUptime(fiveMinAgoIso);
  assert.ok(uptime);
  assert.ok(uptime.includes("5m"));
  assert.ok(uptime.includes("15s"));
});

test("formatErrorDetail extracts error code and message", () => {
  const interaction = {
    error: {
      code: 403,
      message: "Insufficient credits for deep research"
    }
  };
  const errorMsg = formatErrorDetail(interaction);
  assert.equal(errorMsg, "Error 403 - Insufficient credits for deep research");
});

test("runStartDeepResearch invokes interactions.create and returns job_id", async () => {
  const mockAi: any = {
    interactions: {
      create: async (params: any) => {
        assert.equal(params.input, "Research topic");
        assert.equal(params.background, true);
        assert.equal(params.store, true);
        return { id: "job_xyz", status: "in_progress" };
      }
    }
  };

  const result = await runStartDeepResearch({
    ai: mockAi,
    agent: "deep-research-preview-04-2026",
    input: { prompt: "Research topic" }
  });

  assert.deepEqual(result, {
    job_id: "job_xyz",
    status: "in_progress"
  });
});

test("runCheckDeepResearch handles completed interaction", async () => {
  const mockAi: any = {
    interactions: {
      get: async (jobId: string) => {
        assert.equal(jobId, "job_xyz");
        return {
          id: jobId,
          status: "completed",
          output_text: "# Final Report\n\nAll goals completed."
        };
      }
    }
  };

  const result = await runCheckDeepResearch({
    ai: mockAi,
    input: { job_id: "job_xyz", include_citations: false }
  });

  assert.deepEqual(result, {
    job_id: "job_xyz",
    status: "completed",
    report_text: "# Final Report\n\nAll goals completed."
  });
});

test("runCheckDeepResearch handles in_progress interaction with uptime", async () => {
  const created = new Date(Date.now() - 120 * 1000).toISOString();
  const mockAi: any = {
    interactions: {
      get: async (jobId: string) => {
        return {
          id: jobId,
          status: "in_progress",
          created
        };
      }
    }
  };

  const result = await runCheckDeepResearch({
    ai: mockAi,
    input: { job_id: "job_xyz" }
  });

  assert.equal(result.job_id, "job_xyz");
  assert.equal(result.status, "in_progress");
  assert.ok(result.uptime?.includes("2m"));
});

test("runCheckDeepResearch handles failed interaction with error", async () => {
  const mockAi: any = {
    interactions: {
      get: async (jobId: string) => {
        return {
          id: jobId,
          status: "failed",
          error: { code: 500, message: "Internal server error" }
        };
      }
    }
  };

  const result = await runCheckDeepResearch({
    ai: mockAi,
    input: { job_id: "job_xyz" }
  });

  assert.equal(result.job_id, "job_xyz");
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Error 500 - Internal server error");
});
