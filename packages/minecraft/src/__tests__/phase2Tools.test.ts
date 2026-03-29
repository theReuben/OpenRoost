import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot, ItemStack } from "@openroost/core";

import { registerScanArea } from "../tools/scanArea.js";
import { registerGetRecipe } from "../tools/getRecipe.js";
import { registerCraftItem } from "../tools/craftItem.js";
import { registerPlaceBlock } from "../tools/placeBlock.js";

// Mock minecraft-data at top level (hoisted by vitest)
const mockMcData = {
  itemsByName: {
    stick: { id: 280 },
    oak_planks: { id: 5 },
  },
  items: {
    5: { name: "oak_planks" },
    280: { name: "stick" },
  } as Record<number, { name: string }>,
  recipes: {
    280: [
      {
        inShape: [[5], [5]],
        result: { count: 4 },
      },
    ],
  } as Record<number, any[]>,
  blocksByName: {
    crafting_table: { id: 58 },
  },
};

vi.mock("minecraft-data", () => ({
  default: () => mockMcData,
}));

// --- Mock observation ---
const mockObservation: ObservationSnapshot = {
  position: { x: 10, y: 64, z: 20 },
  health: 20,
  food: 18,
  experience: 100,
  gameTime: 6000,
  biome: "plains",
  isRaining: false,
  lightLevel: 15,
  nearbyBlocks: [{ name: "grass_block", position: { x: 10, y: 63, z: 20 } }],
  nearbyEntities: [],
  activeEffects: [],
};

const mockItems: ItemStack[] = [
  { name: "diamond_pickaxe", count: 1, slot: 0 },
  { name: "cobblestone", count: 64, slot: 1 },
];

// --- Helpers to build mock server and bot ---
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

function createMockBot() {
  const events = new EventManager();
  const tasks = new TaskManager();

  return {
    events,
    tasks,
    bot: {
      version: "1.20.4",
      chat: vi.fn(),
      inventory: {
        items: vi.fn(() => mockItems.map((i) => ({ ...i }))),
        slots: {} as Record<number, any>,
        emptySlotCount: vi.fn(() => 30),
      },
      heldItem: { name: "diamond_pickaxe", count: 1, slot: 0 },
      pathfinder: {
        setMovements: vi.fn(),
        setGoal: vi.fn(),
        bestHarvestTool: vi.fn(() => null),
      },
      blockAt: vi.fn((_pos: any) => ({
        name: "stone",
        biome: { name: "plains" },
        light: 15,
      })),
      findBlocks: vi.fn(() => []),
      dig: vi.fn(async () => {}),
      equip: vi.fn(async () => {}),
      placeBlock: vi.fn(async () => {}),
      craft: vi.fn(async () => {}),
      recipesFor: vi.fn(() => []),
      entity: {
        position: {
          x: 10,
          y: 64,
          z: 20,
          distanceTo: () => 0,
          offset: (dx: number, dy: number, dz: number) => ({
            x: 10 + dx,
            y: 64 + dy,
            z: 20 + dz,
          }),
        },
      },
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    getObservation: vi.fn(() => mockObservation),
    getInventoryItems: vi.fn(() => mockItems.map((i) => ({ ...i }))),
    getMovements: vi.fn(() => ({ allowSprinting: true })),
    Goals: {
      GoalNear: class MockGoalNear {
        constructor(public x: number, public y: number, public z: number, public range: number) {}
      },
    },
    isConnected: true,
  } as any;
}

describe("Phase 2 Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
  });

  describe("scan_area", () => {
    it("scans area with block type filter using findBlocks", async () => {
      bot.bot.findBlocks = vi.fn(() => [
        { x: 10, y: 63, z: 20 },
        { x: 11, y: 63, z: 20 },
      ]);
      bot.bot.blockAt = vi.fn(() => ({ name: "diamond_ore" }));

      registerScanArea(server as any, bot);
      const handler = server.getHandler("scan_area");
      const result = await handler({ radius: 8, blockTypes: ["diamond_ore"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.blocks).toHaveLength(2);
      expect(parsed.result.blocks[0].name).toBe("diamond_ore");
      expect(parsed.result.summary).toContain("diamond_ore");
      expect(bot.bot.findBlocks).toHaveBeenCalled();
    });

    it("scans area without filter for general survey", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "stone" }));

      registerScanArea(server as any, bot);
      const handler = server.getHandler("scan_area");
      const result = await handler({ radius: 4 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.blocks.length).toBeGreaterThan(0);
      expect(parsed.result.summary).toContain("stone");
    });

    it("handles errors gracefully", async () => {
      bot.bot.blockAt = vi.fn(() => {
        throw new Error("chunk not loaded");
      });

      registerScanArea(server as any, bot);
      const handler = server.getHandler("scan_area");
      const result = await handler({ radius: 4 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("Scan failed");
    });
  });

  describe("get_recipe", () => {
    it("returns recipe for a known item", async () => {
      registerGetRecipe(server as any, bot);
      const handler = server.getHandler("get_recipe");
      const result = await handler({ item: "stick" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.recipes).toBeDefined();
      expect(parsed.result.recipes.length).toBeGreaterThan(0);
      expect(parsed.result.recipes[0].ingredients).toBeDefined();
      expect(parsed.result.recipes[0].ingredients["oak_planks"]).toBe(2);
      expect(parsed.result.recipes[0].resultCount).toBe(4);
    });

    it("returns error for unknown item", async () => {
      registerGetRecipe(server as any, bot);
      const handler = server.getHandler("get_recipe");
      const result = await handler({ item: "nonexistent_item" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("Unknown item");
    });
  });

  describe("craft_item", () => {
    it("crafts an item successfully", async () => {
      bot.bot.recipesFor = vi.fn(() => [{ requiresTable: false }]);
      bot.bot.craft = vi.fn(async () => {});
      bot.bot.inventory.items = vi.fn(() => [
        { name: "stick", count: 4, slot: 2 },
      ]);

      registerCraftItem(server as any, bot);
      const handler = server.getHandler("craft_item");
      const result = await handler({ item: "stick", count: 1, useCraftingTable: false });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(true);
      expect(parsed.result.crafted.name).toBe("stick");
      expect(bot.bot.craft).toHaveBeenCalled();
    });

    it("returns error when no crafting table nearby and one is required", async () => {
      bot.bot.recipesFor = vi.fn(() => [{ requiresTable: true }]);
      bot.bot.findBlocks = vi.fn(() => []);

      registerCraftItem(server as any, bot);
      const handler = server.getHandler("craft_item");
      const result = await handler({ item: "stick", count: 1, useCraftingTable: true });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("crafting table");
    });

    it("returns error when no recipe available", async () => {
      bot.bot.recipesFor = vi.fn(() => []);

      registerCraftItem(server as any, bot);
      const handler = server.getHandler("craft_item");
      const result = await handler({ item: "stick", count: 1, useCraftingTable: false });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("No available recipe");
    });
  });

  describe("place_block", () => {
    it("places a block successfully", async () => {
      bot.bot.inventory.items = vi.fn(() => [
        { name: "cobblestone", count: 64, slot: 1 },
      ]);
      bot.bot.blockAt = vi.fn(() => ({ name: "stone" }));
      bot.bot.equip = vi.fn(async () => {});
      bot.bot.placeBlock = vi.fn(async () => {});

      registerPlaceBlock(server as any, bot);
      const handler = server.getHandler("place_block");
      const result = await handler({ blockName: "cobblestone", x: 10, y: 65, z: 20, face: "top" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(true);
      expect(parsed.result.placed).toBe("cobblestone");
      expect(bot.bot.equip).toHaveBeenCalled();
      expect(bot.bot.placeBlock).toHaveBeenCalled();
    });

    it("returns error when block not in inventory", async () => {
      bot.bot.inventory.items = vi.fn(() => []);

      registerPlaceBlock(server as any, bot);
      const handler = server.getHandler("place_block");
      const result = await handler({ blockName: "diamond_block", x: 10, y: 65, z: 20, face: "top" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("No diamond_block in inventory");
    });

    it("returns error when no solid reference block", async () => {
      bot.bot.inventory.items = vi.fn(() => [
        { name: "cobblestone", count: 64, slot: 1 },
      ]);
      bot.bot.blockAt = vi.fn(() => ({ name: "air" }));

      registerPlaceBlock(server as any, bot);
      const handler = server.getHandler("place_block");
      const result = await handler({ blockName: "cobblestone", x: 10, y: 65, z: 20, face: "top" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("No solid reference block");
    });
  });
});
