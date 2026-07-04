import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, SkillLibrary } from "@openroost/core";
import { registerSaveSkill } from "../tools/saveSkill.js";
import { registerRecallSkills } from "../tools/recallSkills.js";

type ToolHandler = (args: any) => Promise<any>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    registerTool: vi.fn((name: string, _config: any, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string): ToolHandler {
      const h = handlers.get(name);
      if (!h) throw new Error(`No handler registered for ${name}`);
      return h;
    },
  };
}

function parseResult(result: any) {
  return JSON.parse(result.content[0].text).result;
}

describe("SkillLibrary", () => {
  let lib: SkillLibrary;

  beforeEach(() => {
    lib = new SkillLibrary();
  });

  it("saves a new skill with defaults and stats", () => {
    const skill = lib.save({
      name: "branch-mine-diamonds",
      description: "Efficient diamond mining at y=-58",
      strategy: "Dig a trunk corridor, branch every 3 blocks, torch as you go",
      tags: ["mining", "diamonds"],
      outcome: "success",
    });
    expect(skill.timesUsed).toBe(1);
    expect(skill.successes).toBe(1);
    expect(skill.failures).toBe(0);
    expect(lib.size).toBe(1);
  });

  it("upserts by name, preserving unspecified fields", () => {
    lib.save({
      name: "shelter-at-dusk",
      description: "Quick dirt shelter before night",
      strategy: "Dig into a hillside, seal with dirt, place torch",
      outcome: "success",
    });
    const updated = lib.save({
      name: "shelter-at-dusk",
      outcome: "failure",
      note: "Creeper was already inside the hillside cavity — check first",
    });
    expect(updated.description).toBe("Quick dirt shelter before night");
    expect(updated.timesUsed).toBe(2);
    expect(updated.successes).toBe(1);
    expect(updated.failures).toBe(1);
    expect(updated.notes).toHaveLength(1);
    expect(lib.size).toBe(1);
  });

  it("recalls skills by keyword relevance", () => {
    lib.save({
      name: "branch-mine-diamonds",
      description: "Diamond mining at y=-58",
      tags: ["mining", "diamonds"],
    });
    lib.save({
      name: "wheat-farm",
      description: "Automated wheat farming",
      tags: ["farming", "food"],
    });
    const results = lib.recall("mine some diamonds");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].skill.name).toBe("branch-mine-diamonds");
    expect(results.find((r) => r.skill.name === "wheat-farm")).toBeUndefined();
  });

  it("ranks proven skills above failing ones on equal keyword match", () => {
    lib.save({
      name: "mine-a",
      description: "mining approach A",
      tags: ["mining"],
      outcome: "failure",
    });
    lib.save({
      name: "mine-b",
      description: "mining approach B",
      tags: ["mining"],
      outcome: "success",
    });
    const results = lib.recall("mining");
    expect(results[0].skill.name).toBe("mine-b");
  });

  it("returns empty for a query with no matches", () => {
    lib.save({ name: "wheat-farm", description: "farming", tags: ["farming"] });
    expect(lib.recall("nether fortress raid")).toHaveLength(0);
  });

  it("caps notes at 10, keeping the most recent", () => {
    for (let i = 0; i < 12; i++) {
      lib.save({ name: "s", note: `note ${i}` });
    }
    const skill = lib.get("s")!;
    expect(skill.notes).toHaveLength(10);
    expect(skill.notes[9]).toBe("note 11");
    expect(skill.notes[0]).toBe("note 2");
  });

  it("round-trips through export/import", () => {
    lib.save({
      name: "shelter-at-dusk",
      description: "Quick shelter",
      strategy: "Dig in",
      tags: ["night", "safety"],
      outcome: "success",
    });
    const other = new SkillLibrary();
    other.importSkills(lib.exportSkills());
    expect(other.size).toBe(1);
    expect(other.get("shelter-at-dusk")?.successes).toBe(1);
  });

  it("ignores malformed entries on import", () => {
    const other = new SkillLibrary();
    other.importSkills([
      { name: "valid", description: "", strategy: "", tags: null, notes: null } as any,
      { description: "no name" } as any,
      null as any,
    ]);
    expect(other.size).toBe(1);
    expect(other.get("valid")?.tags).toEqual([]);
  });

  it("removes skills by name", () => {
    lib.save({ name: "temp" });
    expect(lib.remove("temp")).toBe(true);
    expect(lib.remove("temp")).toBe(false);
    expect(lib.size).toBe(0);
  });
});

describe("skill tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: { skills: SkillLibrary; events: EventManager };

  beforeEach(() => {
    server = createMockServer();
    bot = { skills: new SkillLibrary(), events: new EventManager() };
    registerSaveSkill(server as any, bot as any);
    registerRecallSkills(server as any, bot as any);
  });

  it("save_skill stores a skill and reports library size", async () => {
    const result = await server.getHandler("save_skill")({
      name: "tower-up-safely",
      description: "Pillar up without falling",
      strategy: "Jump and place block below, sneak at edges",
      tags: ["building", "safety"],
      outcome: "success",
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.librarySize).toBe(1);
    expect(parsed.skill.name).toBe("tower-up-safely");
    // Structured output mirrors the text payload for typed clients
    expect(result.structuredContent.result.skill.name).toBe("tower-up-safely");
  });

  it("recall_skills returns scored matches for a query", async () => {
    bot.skills.save({
      name: "tower-up-safely",
      description: "Pillar up without falling",
      tags: ["building", "safety"],
    });
    const result = await server.getHandler("recall_skills")({
      query: "build a tower",
      limit: 5,
    });
    const parsed = parseResult(result);
    expect(parsed.matches).toHaveLength(1);
    expect(parsed.matches[0].name).toBe("tower-up-safely");
    expect(parsed.matches[0].score).toBeGreaterThan(0);
  });

  it("recall_skills lists all skills when no query given", async () => {
    bot.skills.save({ name: "a" });
    bot.skills.save({ name: "b" });
    const result = await server.getHandler("recall_skills")({ limit: 5 });
    const parsed = parseResult(result);
    expect(parsed.skills).toHaveLength(2);
  });
});
