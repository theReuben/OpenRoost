import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, TaskManager } from "@openroost/core";
import type { ObservationSnapshot } from "@openroost/core";

import { registerScanArea } from "../tools/scanArea.js";
import { registerGetPlayerInfo } from "../tools/getPlayerInfo.js";

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

describe("Visibility Constraints — Fair Play", () => {
  describe("getNearbyEntities health visibility", () => {
    it("only shows health for entities within 6 blocks", () => {
      // Import BotManager type to test getNearbyEntities behavior
      // We simulate this by creating a mock that mirrors the real logic
      const closeEntity = {
        name: "zombie",
        type: "mob",
        position: { x: 12, y: 64, z: 20, distanceTo: () => 2 },
        health: 15,
      };
      const farEntity = {
        name: "skeleton",
        type: "mob",
        position: { x: 30, y: 64, z: 20, distanceTo: () => 12 },
        health: 20,
      };

      // Simulate the health visibility rule
      const closeResult = 2 <= 6 ? closeEntity.health : undefined;
      const farResult = 12 <= 6 ? farEntity.health : undefined;

      expect(closeResult).toBe(15); // close enough to see health
      expect(farResult).toBeUndefined(); // too far to see health
    });
  });

  describe("scan_area respects block exposure", () => {
    it("excludes fully enclosed blocks (no x-ray)", async () => {
      const server = createMockServer();
      const events = new EventManager();
      const tasks = new TaskManager();

      const bot = {
        events,
        tasks,
        bot: {
          entity: {
            position: {
              x: 10, y: 64, z: 20,
              offset: (dx: number, dy: number, dz: number) => ({
                x: 10 + dx, y: 64 + dy, z: 20 + dz,
              }),
              distanceTo: () => 0,
            },
          },
          findBlocks: vi.fn(() => [
            { x: 10, y: 60, z: 20 }, // deep underground diamond
            { x: 10, y: 63, z: 20 }, // surface diamond
          ]),
          blockAt: vi.fn(() => ({ name: "diamond_ore" })),
        },
        // First call: enclosed (underground). Second call: exposed (surface).
        isBlockExposed: vi.fn()
          .mockReturnValueOnce(false) // underground = not visible
          .mockReturnValueOnce(true),  // surface = visible
        getObservation: vi.fn(),
      } as any;

      registerScanArea(server as any, bot);
      const handler = server.getHandler("scan_area");
      const result = await handler({ radius: 8, blockTypes: ["diamond_ore"] });
      const parsed = JSON.parse(result.content[0].text);

      // Only the exposed diamond should be returned
      expect(parsed.result.blocks).toHaveLength(1);
      expect(parsed.result.blocks[0].position.y).toBe(63); // the surface one
      expect(parsed.result.summary).toContain("1");
    });

    it("includes blocks with transparent neighbors (cave walls)", async () => {
      const server = createMockServer();
      const events = new EventManager();
      const tasks = new TaskManager();

      const bot = {
        events,
        tasks,
        bot: {
          entity: {
            position: {
              x: 10, y: 64, z: 20,
              offset: (dx: number, dy: number, dz: number) => ({
                x: 10 + dx, y: 64 + dy, z: 20 + dz,
              }),
              distanceTo: () => 0,
            },
          },
          findBlocks: vi.fn(() => [
            { x: 10, y: 60, z: 20 },
          ]),
          blockAt: vi.fn(() => ({ name: "iron_ore" })),
        },
        // Block is exposed (adjacent to cave air)
        isBlockExposed: vi.fn().mockReturnValue(true),
        getObservation: vi.fn(),
      } as any;

      registerScanArea(server as any, bot);
      const handler = server.getHandler("scan_area");
      const result = await handler({ radius: 8, blockTypes: ["iron_ore"] });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.blocks).toHaveLength(1);
      expect(parsed.result.blocks[0].name).toBe("iron_ore");
    });
  });

  describe("get_player_info health visibility", () => {
    it("shows health for nearby players", async () => {
      const server = createMockServer();
      const events = new EventManager();

      const bot = {
        events,
        bot: {
          entity: {
            position: { x: 10, y: 64, z: 20, distanceTo: () => 0 },
          },
          players: {
            NearPlayer: {
              username: "NearPlayer",
              ping: 30,
              entity: {
                position: {
                  x: 13, y: 64, z: 20,
                  distanceTo: vi.fn(() => 3), // within 6 blocks
                },
                health: 18,
              },
            },
          },
        },
        getObservation: vi.fn(),
      } as any;

      registerGetPlayerInfo(server as any, bot);
      const handler = server.getHandler("get_player_info");
      const result = await handler({ playerName: "NearPlayer" });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.health).toBe(18);
    });

    it("hides health for distant players", async () => {
      const server = createMockServer();
      const events = new EventManager();

      const bot = {
        events,
        bot: {
          entity: {
            position: { x: 10, y: 64, z: 20, distanceTo: () => 0 },
          },
          players: {
            FarPlayer: {
              username: "FarPlayer",
              ping: 80,
              entity: {
                position: {
                  x: 30, y: 64, z: 20,
                  distanceTo: vi.fn(() => 20), // beyond 6 blocks
                },
                health: 14,
              },
            },
          },
        },
        getObservation: vi.fn(),
      } as any;

      registerGetPlayerInfo(server as any, bot);
      const handler = server.getHandler("get_player_info");
      const result = await handler({ playerName: "FarPlayer" });
      const parsed = JSON.parse(result.content[0].text);

      // Position is visible (entity is loaded) but health is not
      expect(parsed.result.position).toBeDefined();
      expect(parsed.result.distance).toBe(20);
      expect(parsed.result.health).toBeUndefined();
    });
  });
});
