import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot, ItemStack } from "@openroost/core";

import { registerAttackEntity } from "../tools/attackEntity.js";
import { registerDefend } from "../tools/defend.js";
import { registerEquipArmor } from "../tools/equipArmor.js";
import { registerUseItem } from "../tools/useItem.js";

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
  { name: "diamond_sword", count: 1, slot: 0 },
  { name: "diamond_helmet", count: 1, slot: 1 },
  { name: "iron_chestplate", count: 1, slot: 2 },
  { name: "diamond_leggings", count: 1, slot: 3 },
  { name: "leather_boots", count: 1, slot: 4 },
  { name: "ender_pearl", count: 16, slot: 5 },
  { name: "cooked_beef", count: 32, slot: 6 },
];

// --- Helpers ---
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

function createMockBot(overrides: Record<string, any> = {}) {
  const events = new EventManager();
  const tasks = new TaskManager();

  const mockEntity = {
    position: {
      x: 10,
      y: 64,
      z: 20,
      distanceTo: vi.fn(() => 3),
      offset: () => ({ x: 10, y: 63, z: 20 }),
    },
  };

  const zombieEntity = {
    name: "zombie",
    type: "mob",
    isValid: true,
    position: {
      x: 13,
      y: 64,
      z: 20,
      distanceTo: vi.fn(() => 3),
    },
  };

  const playerEntity = {
    name: "player",
    type: "player",
    username: "Steve",
    isValid: true,
    position: {
      x: 15,
      y: 64,
      z: 20,
      distanceTo: vi.fn(() => 5),
    },
  };

  const cowEntity = {
    name: "cow",
    type: "mob",
    isValid: true,
    position: {
      x: 8,
      y: 64,
      z: 20,
      distanceTo: vi.fn(() => 2),
    },
  };

  return {
    events,
    tasks,
    bot: {
      entity: mockEntity,
      entities: {
        0: mockEntity,
        1: zombieEntity,
        2: playerEntity,
        3: cowEntity,
        ...overrides.entities,
      } as Record<string, any>,
      health: overrides.health ?? 20,
      food: 18,
      inventory: {
        items: vi.fn(() => mockItems.map((i) => ({ ...i }))),
        slots: {} as Record<number, any>,
        emptySlotCount: vi.fn(() => 30),
      },
      equip: vi.fn(async () => {}),
      attack: vi.fn(),
      activateItem: vi.fn(),
      activateEntity: vi.fn(async () => {}),
      lookAt: vi.fn(async () => {}),
      chat: vi.fn(),
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
      on: vi.fn(),
      removeListener: vi.fn(),
      time: { age: 6000 },
      isRaining: false,
      experience: { points: 100 },
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

describe("Phase 3 Combat Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── attack_entity ──

  describe("attack_entity", () => {
    it("starts attack and returns a task ID", async () => {
      registerAttackEntity(server as any, bot);
      const handler = server.getHandler("attack_entity");
      const result = await handler({ target: "zombie", pursuit: true });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toBeDefined();
      expect(parsed.result.taskId).toMatch(/^task_/);
      expect(parsed.result.observation).toEqual(mockObservation);
    });

    it("returns error when target entity not found", async () => {
      registerAttackEntity(server as any, bot);
      const handler = server.getHandler("attack_entity");
      const result = await handler({ target: "dragon", pursuit: true });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("dragon");
    });

    it("equips weapon when specified", async () => {
      registerAttackEntity(server as any, bot);
      const handler = server.getHandler("attack_entity");
      await handler({ target: "zombie", weapon: "diamond_sword", pursuit: true });
      expect(bot.bot.equip).toHaveBeenCalled();
      const equipCall = bot.bot.equip.mock.calls[0];
      expect(equipCall[0].name).toBe("diamond_sword");
      expect(equipCall[1]).toBe("hand");
    });

    it("finds entities by username for players", async () => {
      registerAttackEntity(server as any, bot);
      const handler = server.getHandler("attack_entity");
      const result = await handler({ target: "Steve", pursuit: true });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toBeDefined();
    });
  });

  // ── defend ──

  describe("defend", () => {
    it("starts defense and returns a task ID", async () => {
      registerDefend(server as any, bot);
      const handler = server.getHandler("defend");
      const result = await handler({ radius: 8, fleeHealthThreshold: 4 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toBeDefined();
      expect(parsed.result.taskId).toMatch(/^task_/);

      // Clean up the interval by cancelling the task
      const taskId = parsed.result.taskId;
      bot.tasks.cancel(taskId);
    });

    it("attacks nearby hostile mobs on scan", async () => {
      registerDefend(server as any, bot);
      const handler = server.getHandler("defend");
      const result = await handler({ radius: 8, fleeHealthThreshold: 4 });
      const parsed = JSON.parse(result.content[0].text);

      // Advance time to trigger the interval
      vi.advanceTimersByTime(500);

      expect(bot.bot.attack).toHaveBeenCalled();

      bot.tasks.cancel(parsed.result.taskId);
    });

    it("flees when health drops below threshold", async () => {
      bot.bot.health = 3;
      registerDefend(server as any, bot);
      const handler = server.getHandler("defend");
      const result = await handler({ radius: 8, fleeHealthThreshold: 4 });
      const parsed = JSON.parse(result.content[0].text);
      const taskId = parsed.result.taskId;

      // Advance time to trigger the interval scan
      vi.advanceTimersByTime(500);

      // Task should complete with fled_low_health reason
      const task = bot.tasks.get(taskId);
      expect(task.status).toBe("complete");
      expect((task.result as any).reason).toBe("fled_low_health");
    });

    it("can be cancelled via task manager", async () => {
      registerDefend(server as any, bot);
      const handler = server.getHandler("defend");
      const result = await handler({ radius: 8, fleeHealthThreshold: 4 });
      const parsed = JSON.parse(result.content[0].text);
      const taskId = parsed.result.taskId;

      const cancelled = bot.tasks.cancel(taskId);
      expect(cancelled).toBe(true);

      const task = bot.tasks.get(taskId);
      expect(task.status).toBe("failed");
    });
  });

  // ── equip_armor ──

  describe("equip_armor", () => {
    it("equips best armor for all slots", async () => {
      registerEquipArmor(server as any, bot);
      const handler = server.getHandler("equip_armor");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.equipped).toHaveLength(4);

      const equippedNames = parsed.result.equipped.map((e: any) => e.name);
      expect(equippedNames).toContain("diamond_helmet");
      expect(equippedNames).toContain("iron_chestplate");
      expect(equippedNames).toContain("diamond_leggings");
      expect(equippedNames).toContain("leather_boots");
    });

    it("equips armor for a specific slot", async () => {
      registerEquipArmor(server as any, bot);
      const handler = server.getHandler("equip_armor");
      const result = await handler({ slot: "head" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.equipped).toHaveLength(1);
      expect(parsed.result.equipped[0].name).toBe("diamond_helmet");
    });

    it("returns empty equipped array when no armor available", async () => {
      bot.bot.inventory.items = vi.fn(() => [
        { name: "cobblestone", count: 64, slot: 0 },
      ]);
      registerEquipArmor(server as any, bot);
      const handler = server.getHandler("equip_armor");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.equipped).toHaveLength(0);
    });

    it("uses correct equip destinations", async () => {
      registerEquipArmor(server as any, bot);
      const handler = server.getHandler("equip_armor");
      await handler({ slot: "chest" });

      expect(bot.bot.equip).toHaveBeenCalledWith(
        expect.objectContaining({ name: "iron_chestplate" }),
        "torso"
      );
    });
  });

  // ── use_item ──

  describe("use_item", () => {
    it("uses an item without a target", async () => {
      registerUseItem(server as any, bot);
      const handler = server.getHandler("use_item");
      const result = await handler({ itemName: "cooked_beef" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.itemUsed).toBe("cooked_beef");
      expect(bot.bot.equip).toHaveBeenCalled();
      expect(bot.bot.activateItem).toHaveBeenCalled();
    });

    it("returns error when item not in inventory", async () => {
      registerUseItem(server as any, bot);
      const handler = server.getHandler("use_item");
      const result = await handler({ itemName: "golden_apple" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("golden_apple");
    });

    it("looks at position target before activating", async () => {
      registerUseItem(server as any, bot);
      const handler = server.getHandler("use_item");
      const result = await handler({
        itemName: "ender_pearl",
        target: { x: 100, y: 64, z: 200 },
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(bot.bot.lookAt).toHaveBeenCalled();
      expect(bot.bot.activateItem).toHaveBeenCalled();
    });

    it("activates entity when target is an entity name", async () => {
      registerUseItem(server as any, bot);
      const handler = server.getHandler("use_item");
      const result = await handler({ itemName: "cooked_beef", target: "cow" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(bot.bot.activateEntity).toHaveBeenCalled();
    });

    it("returns error when target entity not found", async () => {
      registerUseItem(server as any, bot);
      const handler = server.getHandler("use_item");
      const result = await handler({ itemName: "cooked_beef", target: "dragon" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("dragon");
    });
  });
});
