import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerUseItem(server: McpServer, bot: BotManager): void {
  server.tool(
    "use_item",
    "Use the specified item (eat food, throw ender pearl, etc.). Optionally target a position or entity.",
    {
      itemName: z.string().describe("Name of the item to use"),
      target: z
        .union([
          z.object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
          }),
          z.string(),
        ])
        .optional()
        .describe("Target position {x,y,z} or entity name string"),
    },
    async ({ itemName, target }) => {
      try {
        // Find the item in inventory
        const item = bot.bot.inventory.items().find(
          (i) => i.name.toLowerCase() === itemName.toLowerCase()
        );

        if (!item) {
          const wrapped = errorResponse(
            `Item "${itemName}" not found in inventory`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Equip the item
        await bot.bot.equip(item, "hand");

        if (target && typeof target === "object") {
          // Target is a position — look at it first
          const { Vec3 } = (await import("vec3")).default;
          await bot.bot.lookAt(new Vec3(target.x, target.y, target.z));
          bot.bot.activateItem();
        } else if (target && typeof target === "string") {
          // Target is an entity name — find and interact
          const entity = Object.values(bot.bot.entities).find((e) => {
            if (e === bot.bot.entity) return false;
            return (
              e.name?.toLowerCase() === target.toLowerCase() ||
              (e as any).username?.toLowerCase() === target.toLowerCase()
            );
          });

          if (entity) {
            await bot.bot.activateEntity(entity);
          } else {
            const wrapped = errorResponse(
              `Target entity "${target}" not found nearby`,
              bot.events
            );
            return {
              content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
            };
          }
        } else {
          // No target — just activate the item
          bot.bot.activateItem();
        }

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, itemUsed: itemName, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Use item failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
