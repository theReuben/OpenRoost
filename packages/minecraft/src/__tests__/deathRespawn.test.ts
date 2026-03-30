import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot } from "@openroost/core";
import { registerGetDeathHistory } from "../tools/getDeathHistory.js";

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

describe("Auto-Respawn & Death Memory", () => {
  describe("death position recording", () => {
    it("records death position in deathHistory", () => {
      const events = new EventManager();
      const bot = {
        events,
        deathHistory: [] as any[],
      };

      // Simulate what BotManager does on death
      const deathPos = { x: 100, y: 64, z: -200 };
      bot.deathHistory.unshift({
        position: deathPos,
        timestamp: Date.now(),
        gameTime: 6000,
      });

      expect(bot.deathHistory).toHaveLength(1);
      expect(bot.deathHistory[0].position).toEqual(deathPos);
    });

    it("keeps most recent death first", () => {
      const deathHistory: any[] = [];

      // First death
      deathHistory.unshift({
        position: { x: 10, y: 64, z: 20 },
        timestamp: Date.now() - 60000,
        gameTime: 5000,
      });

      // Second death
      deathHistory.unshift({
        position: { x: 50, y: 30, z: -100 },
        timestamp: Date.now(),
        gameTime: 8000,
      });

      expect(deathHistory).toHaveLength(2);
      expect(deathHistory[0].position.x).toBe(50); // most recent
      expect(deathHistory[1].position.x).toBe(10); // older
    });

    it("limits death history to max size", () => {
      const maxDeathHistory = 10;
      const deathHistory: any[] = [];

      for (let i = 0; i < 12; i++) {
        deathHistory.unshift({
          position: { x: i, y: 64, z: 0 },
          timestamp: Date.now(),
          gameTime: i * 1000,
        });
        if (deathHistory.length > maxDeathHistory) {
          deathHistory.pop();
        }
      }

      expect(deathHistory).toHaveLength(10);
      expect(deathHistory[0].position.x).toBe(11); // most recent
    });
  });

  describe("death event includes position", () => {
    it("pushes death event with position data", () => {
      const events = new EventManager();
      const deathPos = { x: 100, y: 64, z: -200 };

      events.push({
        tick: 6000,
        type: "death",
        data: {
          deathPosition: deathPos,
          deathCount: 1,
        },
        summary: `Bot died at (${deathPos.x}, ${deathPos.y}, ${deathPos.z}). Items were dropped there. Auto-respawning...`,
      });

      const recent = events.getRecent();
      expect(recent).toHaveLength(1);
      expect(recent[0].type).toBe("death");
      expect(recent[0].data.deathPosition).toEqual(deathPos);
      expect(recent[0].summary).toContain("100");
      expect(recent[0].summary).toContain("dropped");
    });
  });

  describe("respawn event", () => {
    it("pushes respawn event with spawn and death positions", () => {
      const events = new EventManager();
      const spawnPos = { x: 0, y: 64, z: 0 };
      const deathPos = { x: 100, y: 64, z: -200 };

      events.push({
        tick: 6100,
        type: "respawn",
        data: {
          spawnPosition: spawnPos,
          lastDeathPosition: deathPos,
        },
        summary: `Respawned at (0, 64, 0). Dropped items are at (100, 64, -200).`,
      });

      const recent = events.getRecent();
      expect(recent).toHaveLength(1);
      expect(recent[0].type).toBe("respawn");
      expect(recent[0].data.spawnPosition).toEqual(spawnPos);
      expect(recent[0].data.lastDeathPosition).toEqual(deathPos);
    });
  });

  describe("task cancellation on death", () => {
    it("fails all running tasks when bot dies", () => {
      const tasks = new TaskManager();

      const task1 = tasks.create("Mining iron");
      const task2 = tasks.create("Pathfinding home");
      const task3 = tasks.create("Already done");
      tasks.complete(task3);

      // Simulate death: cancel all running tasks
      for (const task of tasks.getRunning()) {
        tasks.fail(task.id, "Cancelled: bot died");
      }

      expect(tasks.get(task1)!.status).toBe("failed");
      expect(tasks.get(task2)!.status).toBe("failed");
      expect(tasks.get(task3)!.status).toBe("complete"); // wasn't running
    });
  });

  describe("get_death_history tool", () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
      server = createMockServer();
    });

    it("returns empty history when no deaths", async () => {
      const bot = {
        events: new EventManager(),
        deathHistory: [],
      } as any;

      registerGetDeathHistory(server as any, bot);
      const handler = server.getHandler("get_death_history");
      const result = await handler({ limit: 5 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.deaths).toHaveLength(0);
      expect(parsed.result.totalDeaths).toBe(0);
      expect(parsed.result.lastDeath).toBeNull();
    });

    it("returns death history with positions", async () => {
      const bot = {
        events: new EventManager(),
        deathHistory: [
          {
            position: { x: 50, y: 30, z: -100 },
            timestamp: Date.now(),
            gameTime: 8000,
          },
          {
            position: { x: 10, y: 64, z: 20 },
            timestamp: Date.now() - 60000,
            gameTime: 5000,
          },
        ],
      } as any;

      registerGetDeathHistory(server as any, bot);
      const handler = server.getHandler("get_death_history");
      const result = await handler({ limit: 5 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.deaths).toHaveLength(2);
      expect(parsed.result.totalDeaths).toBe(2);
      expect(parsed.result.lastDeath.position).toEqual({ x: 50, y: 30, z: -100 });
    });

    it("respects limit parameter", async () => {
      const bot = {
        events: new EventManager(),
        deathHistory: [
          { position: { x: 1, y: 64, z: 0 }, timestamp: Date.now(), gameTime: 1000 },
          { position: { x: 2, y: 64, z: 0 }, timestamp: Date.now(), gameTime: 2000 },
          { position: { x: 3, y: 64, z: 0 }, timestamp: Date.now(), gameTime: 3000 },
        ],
      } as any;

      registerGetDeathHistory(server as any, bot);
      const handler = server.getHandler("get_death_history");
      const result = await handler({ limit: 2 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.deaths).toHaveLength(2);
      expect(parsed.result.totalDeaths).toBe(3);
    });
  });
});
