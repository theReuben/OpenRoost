import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetDeathHistory(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_death_history",
    "Get recent death locations. Use this to navigate back and recover dropped items.",
    {
      limit: z.number().default(5).describe("Number of recent deaths to return"),
    },
    async ({ limit }) => {
      const deaths = bot.deathHistory.slice(0, limit).map((d) => ({
        position: d.position,
        gameTime: d.gameTime,
        timestamp: new Date(d.timestamp).toISOString(),
        message: d.message,
      }));

      const wrapped = wrapResponse(
        {
          deaths,
          totalDeaths: bot.deathHistory.length,
          lastDeath: deaths[0] ?? null,
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
