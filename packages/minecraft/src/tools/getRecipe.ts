import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";
import minecraftData from "minecraft-data";

export function registerGetRecipe(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "get_recipe",
    {
      title: "Get Recipe",
      description:
        "Look up the crafting recipe for an item.",
      inputSchema:
      {
        item: z.string().describe('Item name, e.g. "diamond_pickaxe"'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ item }) => {
      try {
        const mcData = minecraftData(bot.bot.version);
        const itemInfo = mcData.itemsByName[item];
        if (!itemInfo) {
          const wrapped = errorResponse(
            `Unknown item: ${item}`,
            bot.events
          );
          return toolResult(wrapped);
        }

        const recipes = mcData.recipes[itemInfo.id];
        if (!recipes || recipes.length === 0) {
          const wrapped = errorResponse(
            `No crafting recipes found for ${item}`,
            bot.events
          );
          return toolResult(wrapped);
        }

        const formattedRecipes = recipes.map((recipe: any) => {
          const ingredients: Record<string, number> = {};

          if (recipe.ingredients) {
            // Shapeless recipe
            for (const id of recipe.ingredients) {
              const ingredientItem = mcData.items[id];
              const name = ingredientItem?.name ?? `id:${id}`;
              ingredients[name] = (ingredients[name] ?? 0) + 1;
            }
          } else if (recipe.inShape) {
            // Shaped recipe
            for (const row of recipe.inShape) {
              for (const id of row) {
                if (id === null || id === -1) continue;
                const ingredientItem = mcData.items[id];
                const name = ingredientItem?.name ?? `id:${id}`;
                ingredients[name] = (ingredients[name] ?? 0) + 1;
              }
            }
          }

          return {
            ingredients,
            resultCount: recipe.result?.count ?? 1,
          };
        });

        const wrapped = wrapResponse({ recipes: formattedRecipes }, bot.events);
        return toolResult(wrapped);
      } catch (err) {
        const wrapped = errorResponse(
          `Recipe lookup failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return toolResult(wrapped);
      }
    }
  );
}
