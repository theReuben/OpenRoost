import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot, ItemStack } from "@openroost/core";

// We will import the register functions and capture the handlers they register
import { registerGetObservation } from "../tools/getObservation.js";
import { registerCheckInventory } from "../tools/checkInventory.js";
import { registerSendChat } from "../tools/sendChat.js";
import { registerGetEvents } from "../tools/getEvents.js";
import { registerGetTaskStatus } from "../tools/getTaskStatus.js";
import { registerMineBlock } from "../tools/mineBlock.js";
import { registerGoTo } from "../tools/goTo.js";

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
      chat: vi.fn(),
      inventory: {
        items: vi.fn(() => mockItems.map((i) => ({ ...i }))),
        slots: {
          5: null,
          6: null,
          7: null,
          8: null,
        } as Record<number, any>,
        emptySlotCount: vi.fn(() => 30),
      },
      heldItem: { name: "diamond_pickaxe", count: 1, slot: 0 },
      pathfinder: {
        setMovements: vi.fn(),
        setGoal: vi.fn(),
        bestHarvestTool: vi.fn(() => null),
      },
      blockAt: vi.fn(() => ({
        name: "stone",
        biome: { name: "plains" },
        light: 15,
      })),
      dig: vi.fn(async () => {}),
      equip: vi.fn(async () => {}),
      entity: {
        position: { x: 10, y: 64, z: 20, distanceTo: () => 0, offset: () => ({ x: 10, y: 63, z: 20 }) },
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

describe("Minecraft Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
  });

  describe("get_observation", () => {
    it("returns the observation snapshot", async () => {
      registerGetObservation(server as any, bot);
      const handler = server.getHandler("get_observation");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result).toEqual(mockObservation);
    });

    it("includes urgent events if present", async () => {
      bot.events.push({ tick: 1, type: "death", data: {}, summary: "died" });
      registerGetObservation(server as any, bot);
      const handler = server.getHandler("get_observation");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.urgentEvents).toBeDefined();
      expect(parsed.urgentEvents).toHaveLength(1);
    });
  });

  describe("check_inventory", () => {
    it("returns inventory items, armor, held item, and empty slots", async () => {
      registerCheckInventory(server as any, bot);
      const handler = server.getHandler("check_inventory");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.items).toHaveLength(2);
      expect(parsed.result.heldItem.name).toBe("diamond_pickaxe");
      expect(parsed.result.emptySlots).toBe(30);
      expect(parsed.result.armor).toEqual([]);
    });
  });

  describe("send_chat", () => {
    it("sends a chat message and returns observation", async () => {
      registerSendChat(server as any, bot);
      const handler = server.getHandler("send_chat");
      const result = await handler({ message: "Hello world" });
      expect(bot.bot.chat).toHaveBeenCalledWith("Hello world");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.observation).toEqual(mockObservation);
    });
  });

  describe("get_events", () => {
    it("returns recent events when no since parameter", async () => {
      bot.events.push({ tick: 1, type: "chat", data: { msg: "hi" }, summary: "hi" });
      bot.events.push({ tick: 2, type: "sunrise", data: {}, summary: "sunrise" });
      registerGetEvents(server as any, bot);
      const handler = server.getHandler("get_events");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events).toHaveLength(2);
    });

    it("returns events since a given tick", async () => {
      bot.events.push({ tick: 5, type: "chat", data: {}, summary: "a" });
      bot.events.push({ tick: 10, type: "chat", data: {}, summary: "b" });
      registerGetEvents(server as any, bot);
      const handler = server.getHandler("get_events");
      const result = await handler({ since: 10 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].tick).toBe(10);
    });
  });

  describe("get_task_status", () => {
    it("returns task info for a known task", async () => {
      const taskId = bot.tasks.create("test navigation");
      registerGetTaskStatus(server as any, bot);
      const handler = server.getHandler("get_task_status");
      const result = await handler({ taskId });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.status).toBe("running");
      expect(parsed.result.description).toBe("test navigation");
    });

    it("returns error for unknown task", async () => {
      registerGetTaskStatus(server as any, bot);
      const handler = server.getHandler("get_task_status");
      const result = await handler({ taskId: "nonexistent" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.error).toContain("No task found");
    });
  });

  describe("mine_block", () => {
    it("mines a block and returns result", async () => {
      // Mock blockAt to return a real block
      bot.bot.blockAt = vi.fn(() => ({ name: "stone" }));
      // After mining, inventory gains a cobblestone
      let callCount = 0;
      bot.getInventoryItems = vi.fn(() => {
        callCount++;
        if (callCount <= 1) return [{ name: "cobblestone", count: 64, slot: 1 }];
        return [{ name: "cobblestone", count: 65, slot: 1 }];
      });

      registerMineBlock(server as any, bot);
      const handler = server.getHandler("mine_block");
      const result = await handler({ x: 10, y: 63, z: 20 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.blockMined).toBe("stone");
    });

    it("returns error when no block at position", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "air" }));
      registerMineBlock(server as any, bot);
      const handler = server.getHandler("mine_block");
      const result = await handler({ x: 0, y: 0, z: 0 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("No block");
    });
  });

  describe("go_to", () => {
    it("starts navigation and returns a task ID", async () => {
      registerGoTo(server as any, bot);
      const handler = server.getHandler("go_to");
      const result = await handler({ x: 100, y: 64, z: 200, sprint: true, range: 1 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toBeDefined();
      expect(parsed.result.taskId).toMatch(/^task_/);
      expect(parsed.result.observation).toEqual(mockObservation);
    });

    it("returns error on pathfinding failure", async () => {
      bot.getMovements = vi.fn(() => { throw new Error("No pathfinder"); });
      registerGoTo(server as any, bot);
      const handler = server.getHandler("go_to");
      const result = await handler({ x: 100, y: 64, z: 200, sprint: true, range: 1 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("No pathfinder");
    });
  });
});
