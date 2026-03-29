import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSmeltItem(server: McpServer, bot: BotManager): void {
  server.tool(
    "smelt_item",
    "Place items in a nearby furnace for smelting. Returns a task ID (smelting takes time).",
    {
      item: z.string().describe("Item to smelt"),
      fuel: z.string().describe('Fuel to use (e.g. "coal")'),
      count: z.number().default(1).describe("Number of items to smelt"),
      furnaceX: z.number().describe("Furnace X coordinate"),
      furnaceY: z.number().describe("Furnace Y coordinate"),
      furnaceZ: z.number().describe("Furnace Z coordinate"),
    },
    async ({ item, fuel, count, furnaceX, furnaceY, furnaceZ }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const block = bot.bot.blockAt(new Vec3(furnaceX, furnaceY, furnaceZ));

        if (!block || !block.name.includes("furnace")) {
          const wrapped = errorResponse(
            "No furnace at that position",
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        const furnace = await (bot.bot as any).openFurnace(block);

        // Find the items in inventory
        const itemToSmelt = bot.bot.inventory.items().find(
          (i) => i.name === item
        );
        const fuelItem = bot.bot.inventory.items().find(
          (i) => i.name === fuel
        );

        if (!itemToSmelt) {
          furnace.close();
          const wrapped = errorResponse(
            `Item "${item}" not found in inventory`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        if (!fuelItem) {
          furnace.close();
          const wrapped = errorResponse(
            `Fuel "${fuel}" not found in inventory`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Put fuel and input
        await furnace.putFuel(fuelItem.type, null, Math.ceil(count / 8) || 1);
        await furnace.putInput(itemToSmelt.type, null, count);

        // Create async task to wait for smelting
        const taskId = bot.tasks.create(`Smelt ${count}x ${item}`, () => {
          furnace.close();
        });

        // Monitor smelting progress
        const checkInterval = setInterval(async () => {
          try {
            const output = furnace.outputItem();
            if (output && output.count >= count) {
              await furnace.takeOutput();
              furnace.close();
              clearInterval(checkInterval);
              bot.tasks.complete(taskId, {
                smelted: item,
                count: output.count,
              });
            }
          } catch {
            clearInterval(checkInterval);
            furnace.close();
            bot.tasks.fail(taskId, "Smelting interrupted");
          }
        }, 2000);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          const task = bot.tasks.get(taskId);
          if (task?.status === "running") {
            try {
              furnace.takeOutput();
              furnace.close();
            } catch { /* ignore */ }
            bot.tasks.complete(taskId, { reason: "timeout", partial: true });
          }
        }, 5 * 60 * 1000);

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, taskId, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Smelt failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
