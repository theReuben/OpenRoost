import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager } from "@openroost/core";
import { ContainerMemory, isNotable } from "../ContainerMemory.js";
import { registerRecallContainers } from "../tools/recallContainers.js";

type ToolHandler = (args: any) => Promise<any>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string): ToolHandler {
      const h = handlers.get(name);
      if (!h) throw new Error(`No handler registered for ${name}`);
      return h;
    },
  };
}

describe("ContainerMemory", () => {
  let memory: ContainerMemory;

  beforeEach(() => {
    memory = new ContainerMemory();
  });

  describe("recording and recall", () => {
    it("records and recalls a container with exact clarity", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [
          { name: "diamond", count: 5, slot: 0 },
          { name: "cobblestone", count: 64, slot: 1 },
        ],
        1000
      );

      const results = memory.recall(1000); // 0 ticks ago
      expect(results).toHaveLength(1);
      expect(results[0].clarity).toBe("exact");
      expect(results[0].blockName).toBe("chest");
      expect(results[0].items).toEqual([
        { name: "diamond", count: 5 },
        { name: "cobblestone", count: 64 },
      ]);
    });

    it("fading clarity makes counts approximate", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [
          { name: "diamond", count: 5, slot: 0 },
          { name: "cobblestone", count: 64, slot: 1 },
        ],
        1000
      );

      // 10000 ticks later (between 6000 and 24000 = fading)
      const results = memory.recall(11000);
      expect(results[0].clarity).toBe("fading");
      expect(results[0].items).toEqual([
        { name: "diamond", count: "some" },
        { name: "cobblestone", count: "some" },
      ]);
    });

    it("vague clarity only remembers notable items", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [
          { name: "diamond", count: 5, slot: 0 },
          { name: "cobblestone", count: 64, slot: 1 },
          { name: "netherite_ingot", count: 2, slot: 2 },
          { name: "dirt", count: 32, slot: 3 },
        ],
        1000
      );

      // 30000 ticks later (between 24000 and 72000 = vague)
      const results = memory.recall(31000);
      expect(results[0].clarity).toBe("vague");
      expect(results[0].items).toHaveLength(2);
      expect(results[0].items.map((i) => i.name)).toEqual([
        "diamond",
        "netherite_ingot",
      ]);
      // All counts become "some" in vague
      expect(results[0].items.every((i) => i.count === "some")).toBe(true);
    });

    it("forgotten clarity returns no items", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [
          { name: "diamond", count: 5, slot: 0 },
          { name: "cobblestone", count: 64, slot: 1 },
        ],
        1000
      );

      // 80000 ticks later (> 72000 = forgotten)
      const results = memory.recall(81000);
      expect(results[0].clarity).toBe("forgotten");
      expect(results[0].items).toHaveLength(0);
      // But still knows the container exists
      expect(results[0].blockName).toBe("chest");
      expect(results[0].position).toEqual({ x: 10, y: 64, z: -20 });
    });
  });

  describe("recallAt", () => {
    it("returns null for unknown position", () => {
      const result = memory.recallAt({ x: 99, y: 99, z: 99 }, 1000);
      expect(result).toBeNull();
    });

    it("returns specific container with decay applied", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "barrel",
        [{ name: "iron_ingot", count: 12, slot: 0 }],
        1000
      );

      const result = memory.recallAt({ x: 10, y: 64, z: -20 }, 1000);
      expect(result).not.toBeNull();
      expect(result!.clarity).toBe("exact");
      expect(result!.items[0].count).toBe(12);
    });
  });

  describe("updating memory", () => {
    it("overwrites previous contents when re-opened", () => {
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [{ name: "cobblestone", count: 64, slot: 0 }],
        1000
      );

      // Re-open the same chest later with different contents
      memory.record(
        { x: 10, y: 64, z: -20 },
        "chest",
        [{ name: "diamond", count: 3, slot: 0 }],
        5000
      );

      expect(memory.size).toBe(1);
      const result = memory.recallAt({ x: 10, y: 64, z: -20 }, 5000);
      expect(result!.items).toEqual([{ name: "diamond", count: 3 }]);
    });
  });

  describe("capacity limit", () => {
    it("evicts oldest container when over max", () => {
      // Fill to capacity + 1
      for (let i = 0; i < 51; i++) {
        memory.record(
          { x: i, y: 64, z: 0 },
          "chest",
          [{ name: "dirt", count: 1, slot: 0 }],
          i * 100
        );
      }

      expect(memory.size).toBe(50);
      // Oldest (x=0) should be evicted
      const oldest = memory.recallAt({ x: 0, y: 64, z: 0 }, 10000);
      expect(oldest).toBeNull();
      // Newest should still exist
      const newest = memory.recallAt({ x: 50, y: 64, z: 0 }, 10000);
      expect(newest).not.toBeNull();
    });
  });

  describe("clarity thresholds", () => {
    it("returns correct clarity for boundary values", () => {
      expect(memory.getClarity(0)).toBe("exact");
      expect(memory.getClarity(5999)).toBe("exact");
      expect(memory.getClarity(6000)).toBe("fading");
      expect(memory.getClarity(23999)).toBe("fading");
      expect(memory.getClarity(24000)).toBe("vague");
      expect(memory.getClarity(71999)).toBe("vague");
      expect(memory.getClarity(72000)).toBe("forgotten");
    });
  });

  describe("sorting", () => {
    it("returns most recently checked containers first", () => {
      memory.record({ x: 1, y: 64, z: 0 }, "chest", [], 1000);
      memory.record({ x: 2, y: 64, z: 0 }, "chest", [], 5000);
      memory.record({ x: 3, y: 64, z: 0 }, "chest", [], 3000);

      const results = memory.recall(6000);
      expect(results[0].position.x).toBe(2); // 1000 ticks ago
      expect(results[1].position.x).toBe(3); // 3000 ticks ago
      expect(results[2].position.x).toBe(1); // 5000 ticks ago
    });
  });
});

describe("isNotable", () => {
  it("recognizes diamond items", () => {
    expect(isNotable("diamond")).toBe(true);
    expect(isNotable("diamond_pickaxe")).toBe(true);
    expect(isNotable("diamond_block")).toBe(true);
  });

  it("recognizes netherite items", () => {
    expect(isNotable("netherite_ingot")).toBe(true);
    expect(isNotable("netherite_sword")).toBe(true);
  });

  it("recognizes other valuable items", () => {
    expect(isNotable("emerald")).toBe(true);
    expect(isNotable("elytra")).toBe(true);
    expect(isNotable("totem_of_undying")).toBe(true);
    expect(isNotable("enchanted_golden_apple")).toBe(true);
  });

  it("does not flag mundane items", () => {
    expect(isNotable("cobblestone")).toBe(false);
    expect(isNotable("dirt")).toBe(false);
    expect(isNotable("oak_planks")).toBe(false);
    expect(isNotable("stick")).toBe(false);
  });
});

describe("recall_containers tool", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("returns empty when no containers remembered", async () => {
    const bot = {
      events: new EventManager(),
      bot: { time: { age: 1000 } },
      containerMemory: new ContainerMemory(),
    } as any;

    registerRecallContainers(server as any, bot);
    const handler = server.getHandler("recall_containers");
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.containers).toHaveLength(0);
    expect(parsed.result.totalRemembered).toBe(0);
  });

  it("returns all container memories", async () => {
    const cm = new ContainerMemory();
    cm.record(
      { x: 10, y: 64, z: -20 },
      "chest",
      [{ name: "diamond", count: 5, slot: 0 }],
      1000
    );

    const bot = {
      events: new EventManager(),
      bot: { time: { age: 2000 } },
      containerMemory: cm,
    } as any;

    registerRecallContainers(server as any, bot);
    const handler = server.getHandler("recall_containers");
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.containers).toHaveLength(1);
    expect(parsed.result.containers[0].clarity).toBe("exact");
    expect(parsed.result.containers[0].items[0].name).toBe("diamond");
  });

  it("recalls specific container by position", async () => {
    const cm = new ContainerMemory();
    cm.record(
      { x: 10, y: 64, z: -20 },
      "chest",
      [{ name: "iron_ingot", count: 12, slot: 0 }],
      1000
    );

    const bot = {
      events: new EventManager(),
      bot: { time: { age: 2000 } },
      containerMemory: cm,
    } as any;

    registerRecallContainers(server as any, bot);
    const handler = server.getHandler("recall_containers");
    const result = await handler({ x: 10, y: 64, z: -20 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.found).toBe(true);
    expect(parsed.result.container.blockName).toBe("chest");
  });

  it("returns not found for unknown position", async () => {
    const bot = {
      events: new EventManager(),
      bot: { time: { age: 1000 } },
      containerMemory: new ContainerMemory(),
    } as any;

    registerRecallContainers(server as any, bot);
    const handler = server.getHandler("recall_containers");
    const result = await handler({ x: 99, y: 99, z: 99 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.found).toBe(false);
  });
});
