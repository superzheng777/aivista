import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createSkillReadTool } from "../src/agent/tools/skill-read.js";

const cwd = resolve(fileURLToPath(new URL("../", import.meta.url)));

describe("project Skill resources", () => {
  it("discovers the poster-design Skill from its canonical SKILL.md", () => {
    const loaded = loadSkillsFromDir({ dir: resolve(cwd, ".pi", "skills"), source: "project" });
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills).toEqual([expect.objectContaining({
      name: "poster-design", disableModelInvocation: false,
    })]);
  });

  it("allows reading Skill content and rejects files outside the Skill root", async () => {
    const tool = createSkillReadTool(cwd);
    const allowed = await tool.execute("read-1", { path: ".pi/skills/poster-design/SKILL.md" },
      undefined, undefined, {} as never);
    expect(allowed.content[0]).toMatchObject({ type: "text" });
    await expect(tool.execute("read-2", { path: ".env.example" }, undefined, undefined, {} as never))
      .rejects.toThrow("read 只允许读取已发布的 Skill 文件");
  });
});
