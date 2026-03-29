import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot, ItemStack } from "@openroost/core";

import { registerFollowPlayer } from "../tools/followPlayer.js";
import { registerWhisper } from "../tools/whisper.js";
import { registerGetPlayerInfo } from "../tools/getPlayerInfo.js";
import { registerInteractBlock } from "../tools/interactBlock.js";
import { registerTransferItems } from "../tools/transferItems.js";
import { registerSmeltItem } from "../tools/smeltItem.js";
import { registerCancelTask } from "../tools/cancelTask.js";
import { registerStopMovement } from "../tools/stopMovement.js";
import { registerLookAt } from "../tools/lookAt.js";

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
        items: vi.fn(() => [
          { name: "cobblestone", count: 64, slot: 0 },
          { name: "coal", count: 32, slot: 1 },
          { name: "iron_ore", count: 16, slot: 2 },
        ]),
        slots: {} as Record<number, any>,
        emptySlotCount: vi.fn(() => 30),
      },
      heldItem: null,
      players: {
        Steve: {
          username: "Steve",
          ping: 42,
          entity: {
            position: {
              x: 15,
              y: 64,
              z: 25,
              distanceTo: vi.fn(() => 7.07),
            },
            health: 20,
          },
        },
      } as Record<string, any>,
      entities: {
        0: {
          position: {
            x: 10, y: 64, z: 20,
            distanceTo: vi.fn(() => 0),
            offset: (dx: number, dy: number, dz: number) => ({
              x: 10 + dx, y: 64 + dy, z: 20 + dz,
            }),
          },
        },
      },
      entity: {
        position: {
          x: 10,
          y: 64,
          z: 20,
          distanceTo: vi.fn(() => 0),
          offset: (dx: number, dy: number, dz: number) => ({
            x: 10 + dx, y: 64 + dy, z: 20 + dz,
          }),
        },
      },
      pathfinder: {
        setMovements: vi.fn(),
        setGoal: vi.fn(),
      },
      blockAt: vi.fn(() => ({
        name: "chest",
        biome: { name: "plains" },
        light: 15,
      })),
      activateBlock: vi.fn(async () => {}),
      openContainer: vi.fn(async () => ({
        items: vi.fn(() => [{ name: "cobblestone", count: 64, type: 1, slot: 0 }]),
        containerItems: vi.fn(() => [{ name: "diamond", count: 3, type: 264, slot: 0 }]),
        deposit: vi.fn(async () => {}),
        withdraw: vi.fn(async () => {}),
        close: vi.fn(),
      })),
      openFurnace: vi.fn(async () => ({
        putFuel: vi.fn(async () => {}),
        putInput: vi.fn(async () => {}),
        outputItem: vi.fn(() => ({ count: 1, name: "iron_ingot" })),
        takeOutput: vi.fn(async () => {}),
        close: vi.fn(),
      })),
      lookAt: vi.fn(async () => {}),
      on: vi.fn(),
      removeListener: vi.fn(),
      time: { age: 6000 },
      isRaining: false,
      experience: { points: 100 },
      health: 20,
      food: 18,
      currentWindow: null,
    },
    getObservation: vi.fn(() => mockObservation),
    getInventoryItems: vi.fn(() => []),
    getNearbyBlocks: vi.fn(() => mockObservation.nearbyBlocks),
    getNearbyEntities: vi.fn(() => []),
    getMovements: vi.fn(() => ({ allowSprinting: true })),
    Goals: {
      GoalNear: class {
        constructor(public x: number, public y: number, public z: number, public range: number) {}
      },
    },
    isConnected: true,
  } as any;
}

describe("Phase 4 — Multiplayer Tools", () => {
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

  describe("follow_player", () => {
    it("starts following and returns a task ID", async () => {
      registerFollowPlayer(server as any, bot);
      const handler = server.getHandler("follow_player");
      const result = await handler({ playerName: "Steve", distance: 3 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toMatch(/^task_/);
      bot.tasks.cancel(parsed.result.taskId);
    });

    it("returns error when player not found", async () => {
      registerFollowPlayer(server as any, bot);
      const handler = server.getHandler("follow_player");
      const result = await handler({ playerName: "NonExistent", distance: 3 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("NonExistent");
    });
  });

  describe("whisper", () => {
    it("sends a /msg command", async () => {
      registerWhisper(server as any, bot);
      const handler = server.getHandler("whisper");
      const result = await handler({ playerName: "Steve", message: "hello" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(bot.bot.chat).toHaveBeenCalledWith("/msg Steve hello");
    });
  });

  describe("get_player_info", () => {
    it("returns info for online player", async () => {
      registerGetPlayerInfo(server as any, bot);
      const handler = server.getHandler("get_player_info");
      const result = await handler({ playerName: "Steve" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.online).toBe(true);
      expect(parsed.result.ping).toBe(42);
      expect(parsed.result.position).toBeDefined();
    });

    it("returns offline for unknown player", async () => {
      registerGetPlayerInfo(server as any, bot);
      const handler = server.getHandler("get_player_info");
      const result = await handler({ playerName: "Unknown" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.online).toBe(false);
    });
  });
});

describe("Phase 5 — Storage & Smelting Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
  });

  describe("interact_block", () => {
    it("interacts with a block", async () => {
      registerInteractBlock(server as any, bot);
      const handler = server.getHandler("interact_block");
      const result = await handler({ x: 10, y: 64, z: 20 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.blockInteracted).toBe("chest");
      expect(bot.bot.activateBlock).toHaveBeenCalled();
    });

    it("returns error for air block", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "air" }));
      registerInteractBlock(server as any, bot);
      const handler = server.getHandler("interact_block");
      const result = await handler({ x: 10, y: 64, z: 20 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
    });
  });

  describe("transfer_items", () => {
    it("withdraws items from a container", async () => {
      registerTransferItems(server as any, bot);
      const handler = server.getHandler("transfer_items");
      const result = await handler({
        containerX: 10, containerY: 64, containerZ: 20,
        items: [{ name: "diamond", count: 3 }],
        direction: "withdraw",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.transferred.length).toBeGreaterThan(0);
    });

    it("deposits items into a container", async () => {
      registerTransferItems(server as any, bot);
      const handler = server.getHandler("transfer_items");
      const result = await handler({
        containerX: 10, containerY: 64, containerZ: 20,
        items: [{ name: "cobblestone", count: 32 }],
        direction: "deposit",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
    });
  });

  describe("smelt_item", () => {
    it("starts smelting and returns a task ID", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "furnace" }));
      registerSmeltItem(server as any, bot);
      const handler = server.getHandler("smelt_item");
      const result = await handler({
        item: "iron_ore", fuel: "coal", count: 1,
        furnaceX: 10, furnaceY: 64, furnaceZ: 20,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.taskId).toMatch(/^task_/);
    });

    it("returns error for non-furnace block", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "stone" }));
      registerSmeltItem(server as any, bot);
      const handler = server.getHandler("smelt_item");
      const result = await handler({
        item: "iron_ore", fuel: "coal", count: 1,
        furnaceX: 10, furnaceY: 64, furnaceZ: 20,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("furnace");
    });
  });
});

describe("Phase 6 — Task Management Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
  });

  describe("cancel_task", () => {
    it("cancels a running task", async () => {
      const taskId = bot.tasks.create("Test task");
      registerCancelTask(server as any, bot);
      const handler = server.getHandler("cancel_task");
      const result = await handler({ taskId });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.cancelled).toBe(taskId);
    });

    it("returns error for unknown task", async () => {
      registerCancelTask(server as any, bot);
      const handler = server.getHandler("cancel_task");
      const result = await handler({ taskId: "nonexistent" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("nonexistent");
    });

    it("returns error for already completed task", async () => {
      const taskId = bot.tasks.create("Test task");
      bot.tasks.complete(taskId);
      registerCancelTask(server as any, bot);
      const handler = server.getHandler("cancel_task");
      const result = await handler({ taskId });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(false);
      expect(parsed.result.error).toContain("not running");
    });
  });

  describe("stop_movement", () => {
    it("stops pathfinder goal", async () => {
      registerStopMovement(server as any, bot);
      const handler = server.getHandler("stop_movement");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.success).toBe(true);
      expect(bot.bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    });
  });

  describe("look_at", () => {
    it("looks at a cardinal direction and returns structured view", async () => {
      registerLookAt(server as any, bot);
      const handler = server.getHandler("look_at");
      const result = await handler({ target: "north" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.description).toContain("north");
      expect(parsed.result.layers).toBeDefined();
      expect(parsed.result.layers).toHaveLength(3); // near, mid, far
      expect(parsed.result.visibleBlocks).toBeDefined();
      expect(parsed.result.visibleEntities).toBeDefined();
      expect(bot.bot.lookAt).toHaveBeenCalled();
    });

    it("returns ray-cast hit for directly ahead block", async () => {
      // blockAt returns stone for all positions, so ray-cast should hit
      bot.bot.blockAt = vi.fn(() => ({ name: "stone" }));
      registerLookAt(server as any, bot);
      const handler = server.getHandler("look_at");
      const result = await handler({ target: "north" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.lookingAt).toBeDefined();
      expect(parsed.result.lookingAt.block).toBe("stone");
      expect(parsed.result.lookingAt.distance).toBeGreaterThan(0);
      expect(parsed.result.description).toContain("Directly ahead: stone");
    });

    it("returns null ray-cast when looking into open air", async () => {
      bot.bot.blockAt = vi.fn(() => ({ name: "air" }));
      registerLookAt(server as any, bot);
      const handler = server.getHandler("look_at");
      const result = await handler({ target: "up" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.lookingAt).toBeNull();
      expect(parsed.result.description).toContain("clear view");
    });

    it("looks at a specific position", async () => {
      registerLookAt(server as any, bot);
      const handler = server.getHandler("look_at");
      const result = await handler({ target: { x: 100, y: 64, z: 200 } });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result.description).toContain("100");
      expect(parsed.result.layers).toHaveLength(3);
      expect(bot.bot.lookAt).toHaveBeenCalled();
    });

    it("filters entities by view cone direction", async () => {
      // Add an entity directly north of the bot
      bot.bot.entities = {
        0: bot.bot.entity,
        1: {
          name: "zombie",
          type: "mob",
          position: {
            x: 10, y: 64, z: 15, // north = negative z, but this is +z = south
            distanceTo: vi.fn(() => 5),
          },
        },
        2: {
          name: "skeleton",
          type: "mob",
          position: {
            x: 10, y: 64, z: -30, // far north
            distanceTo: vi.fn(() => 50),
          },
        },
      };

      registerLookAt(server as any, bot);
      const handler = server.getHandler("look_at");
      const result = await handler({ target: "south" }); // looking south
      const parsed = JSON.parse(result.content[0].text);

      // The zombie at z=15 (south) should be visible looking south
      // The skeleton at z=-30 (north) should NOT be visible looking south
      const visibleNames = parsed.result.visibleEntities.map((e: any) => e.name);
      expect(visibleNames).not.toContain("skeleton");
    });
  });
});
