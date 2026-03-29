import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, BlockInfo } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerScanArea(server: McpServer, bot: BotManager): void {
  server.tool(
    "scan_area",
    "Scan a larger area for specific block types or a general survey.",
    {
      radius: z.number().min(4).max(32).describe("Scan radius (4-32 blocks)"),
      blockTypes: z
        .array(z.string())
        .optional()
        .describe("Optional list of block names to filter for"),
    },
    async ({ radius, blockTypes }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const pos = bot.bot.entity.position;

        const blocks: BlockInfo[] = [];
        const counts = new Map<string, number>();

        if (blockTypes && blockTypes.length > 0) {
          // Use findBlocks for efficient targeted scanning
          for (const blockType of blockTypes) {
            const matching = bot.bot.findBlocks({
              point: pos,
              maxDistance: radius,
              count: 1000,
              matching: (block: any) => block.name === blockType,
            });
            for (const p of matching) {
              const block = bot.bot.blockAt(new Vec3(p.x, p.y, p.z));
              if (block) {
                blocks.push({
                  name: block.name,
                  position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
                });
                counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
              }
            }
          }
        } else {
          // General survey: scan all non-air blocks
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dz = -radius; dz <= radius; dz++) {
                const bp = pos.offset(dx, dy, dz);
                const block = bot.bot.blockAt(bp);
                if (block && block.name !== "air" && block.name !== "cave_air") {
                  blocks.push({
                    name: block.name,
                    position: { x: Math.floor(bp.x), y: Math.floor(bp.y), z: Math.floor(bp.z) },
                  });
                  counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
                }
              }
            }
          }
        }

        const summaryParts = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `${name}: ${count}`);
        const summary = `Found ${blocks.length} blocks in radius ${radius}. ${summaryParts.join(", ")}`;

        const wrapped = wrapResponse({ blocks, summary }, bot.events);
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Scan failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
