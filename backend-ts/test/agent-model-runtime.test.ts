import { describe, expect, it } from "vitest";
import { createAgentModelBinding } from "../src/agent/providers/bailian.js";
import { validateEnvironment } from "../src/config/environment.js";

describe("Agent model runtime", () => {
  it("reuses the generation API key when the Agent key is absent", async () => {
    const environment = validateEnvironment({
      AIVISTA_AGENT_BAILIAN_BASE_URL: "https://workspace.example/compatible-mode/v1",
      AIVISTA_BAILIAN_API_KEY: "shared-key",
    });

    const binding = await createAgentModelBinding(environment);

    expect(binding.model.id).toBe("qwen3.8-flash");
  });

  it("requires at least one Bailian API key", async () => {
    const environment = validateEnvironment({
      AIVISTA_AGENT_BAILIAN_BASE_URL: "https://workspace.example/compatible-mode/v1",
    });

    await expect(createAgentModelBinding(environment)).rejects.toThrow(
      "app.agent.model.api-key or app.generation.bailian.api-key",
    );
  });
});
