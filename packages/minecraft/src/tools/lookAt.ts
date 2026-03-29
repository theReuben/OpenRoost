import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, BlockInfo, EntityInfo } from "@openroost/core";
import { BotManager } from "../BotManager.js";

const DIRECTION_VECTORS: Record<string, { x: number; y: number; z: number }> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

export function registerLookAt(server: McpServer, bot: BotManager): void {
  server.tool(
    "look_at",
    "Look in a direction or at a position and describe what's visible.",
    {
      target: z
        .union([
          z.object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
          }),
          z.enum(["north", "south", "east", "west", "up", "down"]),
        ])
        .describe("Position {x,y,z} or cardinal direction to look at"),
    },
    async ({ target }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        let lookPos: InstanceType<typeof Vec3>;

        if (typeof target === "string") {
          const dir = DIRECTION_VECTORS[target];
          const pos = bot.bot.entity.position;
          lookPos = new Vec3(
            pos.x + dir.x * 16,
            pos.y + dir.y * 16 + 1.6, // eye height
            pos.z + dir.z * 16
          );
        } else {
          lookPos = new Vec3(target.x, target.y, target.z);
        }

        await bot.bot.lookAt(lookPos);

        // Gather visible blocks and entities in that direction
        const blocks = bot.getNearbyBlocks(8);
        const entities = bot.getNearbyEntities(16);

        const dirLabel = typeof target === "string" ? target : `${target.x}, ${target.y}, ${target.z}`;
        const blockSummary = summarizeBlocks(blocks);
        const entitySummary = entities.length > 0
          ? entities.map((e) => `${e.name} (${e.distance}m)`).join(", ")
          : "none";

        const description = `Looking ${dirLabel}. Blocks: ${blockSummary}. Entities: ${entitySummary}.`;

        const wrapped = wrapResponse(
          { blocks, entities, description },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Look failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}

function summarizeBlocks(blocks: BlockInfo[]): string {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}(${count})`)
    .join(", ") || "none";
}
