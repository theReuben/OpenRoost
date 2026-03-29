import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetPlayerInfo(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_player_info",
    "Get information about a specific online player.",
    {
      playerName: z.string().describe("Player to look up"),
    },
    async ({ playerName }) => {
      try {
        const player = bot.bot.players[playerName];
        if (!player) {
          const wrapped = wrapResponse(
            { online: false },
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        const result: Record<string, unknown> = {
          online: true,
          ping: player.ping,
        };

        if (player.entity) {
          const pos = player.entity.position;
          const dist = pos.distanceTo(bot.bot.entity.position);
          result.position = {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z),
          };
          result.distance = Math.round(dist * 10) / 10;
          // Player health is only visible at close range
          if (dist <= 6) {
            result.health = (player.entity as any).health ?? undefined;
          }
        }

        const wrapped = wrapResponse(result, bot.events);
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Player info failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
