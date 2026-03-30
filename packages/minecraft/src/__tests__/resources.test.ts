import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot, ItemStack } from "@openroost/core";
import { registerResources, wireResourceNotifications } from "../resources.js";

type ResourceCallback = (uri: URL) => Promise<any>;

function createMockServer() {
  const resources = new Map<string, ResourceCallback>();
  return {
    resource: vi.fn(
      (name: string, uri: string, _meta: any, callback: ResourceCallback) => {
        resources.set(uri, callback);
      }
    ),
    server: {
      sendResourceUpdated: vi.fn(async () => {}),
    },
    getResource(uri: string): ResourceCallback {
      const cb = resources.get(uri);
      if (!cb) throw new Error(`No resource registered for ${uri}`);
      return cb;
    },
  };
}

function createMockBot() {
  const events = new EventManager();
  const tasks = new TaskManager();
  const eventListeners = new Map<string, Function[]>();

  return {
    events,
    tasks,
    isConnected: true,
    bot: {
      username: "TestBot",
      health: 18,
      food: 16,
      experience: { points: 42 },
      game: {
        gameMode: "survival",
        difficulty: "normal",
        dimension: "minecraft:overworld",
        serverBrand: "vanilla",
      },
      entity: {
        position: {
          x: 100.5,
          y: 64.0,
          z: -200.3,
          distanceTo: vi.fn(() => 0),
          offset: (dx: number, dy: number, dz: number) => ({
            x: 100.5 + dx,
            y: 64.0 + dy,
            z: -200.3 + dz,
          }),
        },
        yaw: 0,
        pitch: 0,
      },
      entities: {},
      players: {
        TestBot: { username: "TestBot", ping: 0 },
        Alice: {
          username: "Alice",
          ping: 35,
          entity: {
            position: {
              x: 105,
              y: 64,
              z: -195,
              distanceTo: vi.fn(() => 7.07),
            },
          },
        },
        Bob: {
          username: "Bob",
          ping: 80,
          entity: null,
        },
      } as Record<string, any>,
      inventory: {
        items: vi.fn(() => [
          { name: "diamond_pickaxe", count: 1, slot: 0 },
          { name: "cobblestone", count: 64, slot: 1 },
        ]),
        slots: {
          5: { name: "iron_helmet", count: 1, slot: 5 },
        } as Record<number, any>,
        emptySlotCount: vi.fn(() => 28),
        on: vi.fn((event: string, cb: Function) => {
          const listeners = eventListeners.get(event) ?? [];
          listeners.push(cb);
          eventListeners.set(event, listeners);
        }),
      },
      heldItem: { name: "diamond_pickaxe", count: 1, slot: 0 },
      time: { age: 6000, timeOfDay: 6000 },
      isRaining: false,
      on: vi.fn((event: string, cb: Function) => {
        const listeners = eventListeners.get(event) ?? [];
        listeners.push(cb);
        eventListeners.set(event, listeners);
      }),
    },
    getObservation: vi.fn(),
    getInventoryItems: vi.fn(() => [
      { name: "diamond_pickaxe", count: 1, slot: 0 },
      { name: "cobblestone", count: 64, slot: 1 },
    ]),
    getNearbyBlocks: vi.fn(() => []),
    getNearbyEntities: vi.fn(() => []),
    getMovements: vi.fn(() => ({ allowSprinting: true })),
    Goals: {},
    lastSleepTick: -1,
    isNight: false,
    currentWeather: "clear" as const,
    // Helper to fire events in tests
    _eventListeners: eventListeners,
  } as any;
}

describe("MCP Resources", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
    registerResources(server as any, bot);
  });

  it("registers all 6 resources", () => {
    expect(server.resource).toHaveBeenCalledTimes(6);
    const uris = server.resource.mock.calls.map((c: any) => c[1]);
    expect(uris).toContain("minecraft://status");
    expect(uris).toContain("minecraft://inventory");
    expect(uris).toContain("minecraft://position");
    expect(uris).toContain("minecraft://nearby-players");
    expect(uris).toContain("minecraft://time-weather");
    expect(uris).toContain("minecraft://events");
  });

  describe("minecraft://status", () => {
    it("returns connection status and game info", async () => {
      const read = server.getResource("minecraft://status");
      const result = await read(new URL("minecraft://status"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.connected).toBe(true);
      expect(data.username).toBe("TestBot");
      expect(data.health).toBe(18);
      expect(data.food).toBe(16);
      expect(data.gameMode).toBe("survival");
      expect(data.difficulty).toBe("normal");
    });

    it("returns disconnected status when not connected", async () => {
      bot.isConnected = false;
      const read = server.getResource("minecraft://status");
      const result = await read(new URL("minecraft://status"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.connected).toBe(false);
    });
  });

  describe("minecraft://inventory", () => {
    it("returns items, armor, held item, and empty slots", async () => {
      const read = server.getResource("minecraft://inventory");
      const result = await read(new URL("minecraft://inventory"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.items).toHaveLength(2);
      expect(data.items[0].name).toBe("diamond_pickaxe");
      expect(data.armor).toHaveLength(1);
      expect(data.armor[0].name).toBe("iron_helmet");
      expect(data.heldItem.name).toBe("diamond_pickaxe");
      expect(data.emptySlots).toBe(28);
    });
  });

  describe("minecraft://position", () => {
    it("returns block coords, exact coords, and facing", async () => {
      const read = server.getResource("minecraft://position");
      const result = await read(new URL("minecraft://position"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.x).toBe(100);
      expect(data.y).toBe(64);
      expect(data.z).toBe(-201);
      expect(data.exactX).toBe(100.5);
      expect(data.facing).toBeDefined();
    });
  });

  describe("minecraft://nearby-players", () => {
    it("returns other players with position and distance", async () => {
      const read = server.getResource("minecraft://nearby-players");
      const result = await read(new URL("minecraft://nearby-players"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.count).toBe(2); // Alice and Bob, excluding TestBot
      const alice = data.players.find((p: any) => p.username === "Alice");
      expect(alice).toBeDefined();
      expect(alice.ping).toBe(35);
      expect(alice.position).toBeDefined();
      expect(alice.distance).toBe(7.1);

      const bob = data.players.find((p: any) => p.username === "Bob");
      expect(bob.position).toBeNull(); // entity is null
    });
  });

  describe("minecraft://events", () => {
    it("returns recent events from the event manager", async () => {
      bot.events.push({
        tick: 100,
        type: "chat",
        data: { username: "Alice", message: "hello" },
        summary: "Alice: hello",
      });

      const read = server.getResource("minecraft://events");
      const result = await read(new URL("minecraft://events"));
      const data = JSON.parse(result.contents[0].text);

      expect(data.events).toHaveLength(1);
      expect(data.events[0].type).toBe("chat");
    });
  });
});

describe("Resource Update Notifications", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    server = createMockServer();
    bot = createMockBot();
    wireResourceNotifications(server as any, bot);
  });

  it("wires up event listeners on the bot", () => {
    // bot.bot.on should be called for move, playerJoined, playerLeft, health, chat, entityHurt, death
    expect(bot.bot.on).toHaveBeenCalled();
    const events = bot.bot.on.mock.calls.map((c: any) => c[0]);
    expect(events).toContain("move");
    expect(events).toContain("playerJoined");
    expect(events).toContain("playerLeft");
    expect(events).toContain("health");
    expect(events).toContain("chat");
    expect(events).toContain("death");
  });

  it("wires inventory updateSlot listener", () => {
    expect(bot.bot.inventory.on).toHaveBeenCalledWith(
      "updateSlot",
      expect.any(Function)
    );
  });
});
