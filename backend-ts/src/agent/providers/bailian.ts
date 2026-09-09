import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Environment } from "../../config/environment.js";

const PROVIDER_ID = "aivista-bailian";

export interface AgentModelBinding {
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
}

export type AgentModelConfig = Pick<Environment,
  "AIVISTA_AGENT_BAILIAN_BASE_URL" | "AIVISTA_AGENT_BAILIAN_API_KEY" | "AIVISTA_BAILIAN_API_KEY"
  | "AIVISTA_AGENT_MODEL" | "AIVISTA_AGENT_THINKING_ENABLED">;

export async function createAgentModelBinding(environment: AgentModelConfig): Promise<AgentModelBinding> {
  const baseUrl = required(environment.AIVISTA_AGENT_BAILIAN_BASE_URL, "app.agent.model.base-url");
  const apiKey = required(
    environment.AIVISTA_AGENT_BAILIAN_API_KEY ?? environment.AIVISTA_BAILIAN_API_KEY,
    "app.agent.model.api-key or app.generation.bailian.api-key",
  );
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });

  modelRuntime.registerProvider(PROVIDER_ID, {
    name: "AiVista Bailian",
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    api: "openai-completions",
    models: [{
      id: environment.AIVISTA_AGENT_MODEL,
      name: environment.AIVISTA_AGENT_MODEL,
      api: "openai-completions",
      reasoning: environment.AIVISTA_AGENT_THINKING_ENABLED,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 131_072,
    }],
  });

  const model = modelRuntime.getModel(PROVIDER_ID, environment.AIVISTA_AGENT_MODEL);
  if (!model) throw new Error(`Agent model was not registered: ${environment.AIVISTA_AGENT_MODEL}`);
  return { modelRuntime, model };
}

function required(value: string | undefined, property: string): string {
  if (!value) throw new Error(`Missing Agent model configuration: ${property}`);
  return value;
}
