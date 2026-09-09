import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";
import { createAgentModelBinding, type AgentModelBinding } from "./providers/bailian.js";

/** 全部短生命周期 Pi Session 共用一个不可变模型运行时。 */
@Injectable()
export class AgentModelService {
  private binding?: Promise<AgentModelBinding>;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  get(): Promise<AgentModelBinding> {
    this.binding ??= createAgentModelBinding({
      AIVISTA_AGENT_BAILIAN_BASE_URL: this.config.get("AIVISTA_AGENT_BAILIAN_BASE_URL", { infer: true }),
      AIVISTA_AGENT_BAILIAN_API_KEY: this.config.get("AIVISTA_AGENT_BAILIAN_API_KEY", { infer: true }),
      AIVISTA_BAILIAN_API_KEY: this.config.get("AIVISTA_BAILIAN_API_KEY", { infer: true }),
      AIVISTA_AGENT_MODEL: this.config.get("AIVISTA_AGENT_MODEL", { infer: true }),
      AIVISTA_AGENT_THINKING_ENABLED: this.config.get("AIVISTA_AGENT_THINKING_ENABLED", { infer: true }),
    });
    return this.binding;
  }
}
