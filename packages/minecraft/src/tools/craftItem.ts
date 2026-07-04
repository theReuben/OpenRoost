import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerCraftItem(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "craft_item",
    {
      title: "Craft Item",
      description:
        "Craft an item using materials in inventory.",
      inputSchema:
      {
        item: z.string().describe("Item name to craft"),
        count: z.number().default(1).describe("Number of times to craft"),
        useCraftingTable: z
          .boolean()
          .default(false)
          .describe("Whether to use a nearby crafting table"),
      },
      annotations: { destructiveHint: false },
    },
    async ({ item, count, useCraftingTable }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const mcData = (await import("minecraft-data")).default(bot.bot.version);

        const itemInfo = mcData.itemsByName[item];
        if (!itemInfo) {
          const wrapped = errorResponse(`Unknown item: ${item}`, bot.events);
          return toolResult(wrapped);
        }

        const availableRecipes = bot.bot.recipesFor(itemInfo.id, null, 1, useCraftingTable ? null : false);
        if (!availableRecipes || availableRecipes.length === 0) {
          const wrapped = errorResponse(
            `No available recipe for ${item}. Check inventory or try useCraftingTable: true`,
            bot.events
          );
          return toolResult(wrapped);
        }

        let craftingTable = null;
        if (useCraftingTable) {
          const craftingTableBlock = mcData.blocksByName["crafting_table"];
          if (craftingTableBlock) {
            const tablePositions = bot.bot.findBlocks({
              point: bot.bot.entity.position,
              maxDistance: 4,
              count: 1,
              matching: craftingTableBlock.id,
            });
            if (tablePositions.length > 0) {
              const tp = tablePositions[0];
              craftingTable = bot.bot.blockAt(new Vec3(tp.x, tp.y, tp.z));
            }
          }

          if (!craftingTable) {
            const wrapped = errorResponse(
              "No crafting table found within 4 blocks",
              bot.events
            );
            return toolResult(wrapped);
          }
        }

        const recipe = availableRecipes[0];
        let craftTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bot.bot.craft(recipe, count, craftingTable ?? undefined),
            new Promise<never>((_, reject) => {
              craftTimer = setTimeout(
                () => reject(new Error("craft timed out after 15s")),
                15_000
              );
            }),
          ]);
        } finally {
          clearTimeout(craftTimer);
        }

        // Find the crafted item in inventory
        const inventoryItem = bot.bot.inventory.items().find((i: any) => i.name === item);
        const crafted = inventoryItem
          ? { name: inventoryItem.name, count: inventoryItem.count, slot: inventoryItem.slot }
          : { name: item, count, slot: -1 };

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, crafted, observation },
          bot.events
        );
        return toolResult(wrapped);
      } catch (err) {
        const wrapped = errorResponse(
          `Crafting failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return toolResult(wrapped);
      }
    }
  );
}
