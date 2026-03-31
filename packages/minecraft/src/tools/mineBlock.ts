import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, ItemStack } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerMineBlock(server: McpServer, bot: BotManager): void {
  server.tool(
    "mine_block",
    "Mine/break the block at a specific position. Auto-selects the best tool from inventory.",
    {
      x: z.number().describe("Block X coordinate"),
      y: z.number().describe("Block Y coordinate"),
      z: z.number().describe("Block Z coordinate"),
    },
    async ({ x, y, z: zCoord }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const block = bot.bot.blockAt(new Vec3(x, y, zCoord));
        if (!block || block.name === "air") {
          const wrapped = errorResponse("No block at that position", bot.events);
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        const blockName = block.name;

        // Fail fast if the block is out of reach rather than letting dig() hang.
        // Standard arm reach is 4.5 blocks; use 5 for a small tolerance.
        const reach = bot.bot.entity.position.distanceTo(block.position);
        if (reach > 5) {
          const wrapped = errorResponse(
            `Block ${blockName} at (${x}, ${y}, ${zCoord}) is ${Math.round(reach * 10) / 10} blocks away — move closer before mining (max reach: 4.5 blocks)`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Auto-equip best tool for the block
        const bestTool = bot.bot.pathfinder.bestHarvestTool(block);
        if (bestTool) {
          await bot.bot.equip(bestTool, "hand");
        }

        // Collect items picked up during mining
        const itemsBefore = bot.getInventoryItems();

        // Dig with a timeout so a hung dig (adventure mode, protected block, etc.)
        // sends a proper cancel to the server instead of leaving the break sequence
        // open for 30 s and triggering a server-side kick.
        // The timer must be cleared on success so stopDigging() is never called
        // on a clean connection after the block is already mined.
        const DIG_TIMEOUT_MS = 15_000;
        let digTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bot.bot.dig(block),
            new Promise<never>((_, reject) => {
              digTimer = setTimeout(() => {
                try { bot.bot.stopDigging(); } catch { /* already done */ }
                reject(new Error(`dig timed out after ${DIG_TIMEOUT_MS / 1000}s — block may be protected (spawn protection, adventure mode, or land claim)`));
              }, DIG_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(digTimer);
        }

        // Brief wait for item pickup
        await new Promise((r) => setTimeout(r, 500));

        const itemsAfter = bot.getInventoryItems();
        const collected = diffInventory(itemsBefore, itemsAfter);
        const observation = bot.getObservation();

        const wrapped = wrapResponse(
          {
            success: true,
            blockMined: blockName,
            itemsCollected: collected,
            observation,
          },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Mining failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}

function diffInventory(before: ItemStack[], after: ItemStack[]): ItemStack[] {
  const beforeMap = new Map<string, number>();
  for (const item of before) {
    beforeMap.set(item.name, (beforeMap.get(item.name) ?? 0) + item.count);
  }

  const collected: ItemStack[] = [];
  for (const item of after) {
    const prevCount = beforeMap.get(item.name) ?? 0;
    const totalAfter = after
      .filter((i) => i.name === item.name)
      .reduce((sum, i) => sum + i.count, 0);
    if (totalAfter > prevCount) {
      const existing = collected.find((c) => c.name === item.name);
      if (!existing) {
        collected.push({ name: item.name, count: totalAfter - prevCount, slot: item.slot });
      }
    }
  }
  return collected;
}
