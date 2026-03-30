import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, ItemStack } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerTransferItems(server: McpServer, bot: BotManager): void {
  server.tool(
    "transfer_items",
    "Move items between inventory and a container (chest, furnace, etc.).",
    {
      containerX: z.number().describe("Container block X coordinate"),
      containerY: z.number().describe("Container block Y coordinate"),
      containerZ: z.number().describe("Container block Z coordinate"),
      items: z.array(
        z.object({
          name: z.string().describe("Item name"),
          count: z.number().describe("Number to transfer"),
        })
      ).describe("Items to transfer"),
      direction: z.enum(["deposit", "withdraw"]).describe("Direction of transfer"),
    },
    async ({ containerX, containerY, containerZ, items, direction }) => {
      try {
        const { Vec3 } = (await import("vec3")).default;
        const block = bot.bot.blockAt(new Vec3(containerX, containerY, containerZ));

        if (!block || block.name === "air") {
          const wrapped = errorResponse("No block at that position", bot.events);
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Open the container
        const window = await bot.bot.openContainer(block);
        const transferred: ItemStack[] = [];

        for (const { name, count } of items) {
          try {
            if (direction === "deposit") {
              // Find item in bot inventory
              const item = (window as any).items().find(
                (i: any) => i.name === name
              );
              if (item) {
                const transferCount = Math.min(count, item.count);
                await (window as any).deposit(item.type, null, transferCount);
                transferred.push({ name, count: transferCount, slot: item.slot });
              }
            } else {
              // Find item in container
              const item = (window as any).containerItems().find(
                (i: any) => i.name === name
              );
              if (item) {
                const transferCount = Math.min(count, item.count);
                await (window as any).withdraw(item.type, null, transferCount);
                transferred.push({ name, count: transferCount, slot: item.slot });
              }
            }
          } catch {
            // Skip items that fail to transfer
          }
        }

        (window as any).close();

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, transferred, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Transfer failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
