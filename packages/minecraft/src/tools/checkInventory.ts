import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, ItemStack, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerCheckInventory(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "check_inventory",
    {
      title: "Check Inventory",
      description:
        "List all items in inventory, including equipped armor and held item",
      inputSchema:
      {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const items = bot.getInventoryItems();

      const armorSlots = [5, 6, 7, 8]; // head, chest, legs, feet
      const armor: ItemStack[] = [];
      for (const slot of armorSlots) {
        const item = bot.bot.inventory.slots[slot];
        if (item) {
          armor.push({ name: item.name, count: item.count, slot: item.slot });
        }
      }

      const heldItem = bot.bot.heldItem;
      const held = heldItem
        ? { name: heldItem.name, count: heldItem.count, slot: heldItem.slot }
        : null;

      const emptySlots = bot.bot.inventory.emptySlotCount();

      const result = { items, armor, heldItem: held, emptySlots };
      const wrapped = wrapResponse(result, bot.events);
      return toolResult(wrapped);
    }
  );
}
