import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, ItemStack } from "@openroost/core";
import { BotManager } from "../BotManager.js";

type ArmorSlot = "head" | "chest" | "legs" | "feet";

const ARMOR_TIERS = ["diamond", "iron", "chainmail", "gold", "leather"] as const;

const SLOT_CONFIG: Record<ArmorSlot, { destination: string; patterns: string[] }> = {
  head: {
    destination: "head",
    patterns: ARMOR_TIERS.map((t) => `${t}_helmet`),
  },
  chest: {
    destination: "torso",
    patterns: ARMOR_TIERS.map((t) => `${t}_chestplate`),
  },
  legs: {
    destination: "legs",
    patterns: ARMOR_TIERS.map((t) => `${t}_leggings`),
  },
  feet: {
    destination: "feet",
    patterns: ARMOR_TIERS.map((t) => `${t}_boots`),
  },
};

export function registerEquipArmor(server: McpServer, bot: BotManager): void {
  server.tool(
    "equip_armor",
    "Equip the best available armor from inventory. Optionally target a specific slot.",
    {
      slot: z
        .enum(["head", "chest", "legs", "feet"])
        .optional()
        .describe("Specific armor slot to equip. Omit to equip all slots."),
    },
    async ({ slot }) => {
      try {
        const slotsToEquip: ArmorSlot[] = slot
          ? [slot]
          : ["head", "chest", "legs", "feet"];

        const equipped: ItemStack[] = [];

        for (const armorSlot of slotsToEquip) {
          const config = SLOT_CONFIG[armorSlot];
          const items = bot.bot.inventory.items();

          // Find best armor piece for this slot (ordered by tier priority)
          let bestItem: any = null;
          for (const pattern of config.patterns) {
            bestItem = items.find((item) => item.name === pattern);
            if (bestItem) break;
          }

          if (bestItem) {
            await bot.bot.equip(bestItem, config.destination as any);
            equipped.push({
              name: bestItem.name,
              count: 1,
              slot: bestItem.slot,
            });
          }
        }

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, equipped, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Equip armor failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
